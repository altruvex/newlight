import { Prisma, type ActorType, type MovementType, type PrismaClient } from "./generated/prisma/client"

export const DEFAULT_LOCATION_ID = "location_main"

export const MIGRATED_OPENING_REASON = "migrated placeholder — not a physical count"

export const OPENING_COUNT_PENDING_KEY = "inventory.opening_count_pending"

export type InventoryTx = Prisma.TransactionClient

const DIRECTION: Record<MovementType, "in" | "out" | "either"> = {
    INITIAL: "in",
    PURCHASE_RECEIPT: "in",
    RETURN: "in",
    TRANSFER_IN: "in",
    SALE: "out",
    TRANSFER_OUT: "out",
    DAMAGE: "out",
    ADJUSTMENT: "either",
}

export interface MovementInput {
    productId: string
    locationId?: string
    type: MovementType
    quantity: number
    unitCost?: Prisma.Decimal | string | null
    reason?: string | null
    referenceType?: string | null
    referenceId?: string | null
    actorType?: ActorType | null
    actorId?: string | null
}

export interface MovementResult {
    movementId: string
    onHand: number
    deduplicated: boolean
}

export async function recordMovement(tx: InventoryTx, input: MovementInput): Promise<MovementResult> {
    const locationId = input.locationId ?? DEFAULT_LOCATION_ID
    assertDirection(input.type, input.quantity)

    if (input.unitCost !== undefined && input.unitCost !== null) {
        const cost = new Prisma.Decimal(input.unitCost)
        if (cost.isNegative()) {
            throw new RangeError(`recordMovement(): unitCost may not be negative (${cost.toString()})`)
        }
    }

    if (input.referenceType && input.referenceId) {
        const existing = await tx.stockMovement.findFirst({
            where: {
                type: input.type,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                productId: input.productId,
                locationId,
            },
            select: { id: true },
        })
        if (existing) {
            const level = await tx.stockLevel.findUnique({
                where: { productId_locationId: { productId: input.productId, locationId } },
                select: { onHand: true },
            })
            return { movementId: existing.id, onHand: level?.onHand ?? 0, deduplicated: true }
        }
    }

    const movement = await tx.stockMovement.create({
        data: {
            productId: input.productId,
            locationId,
            type: input.type,
            quantity: input.quantity,
            unitCost: input.unitCost ?? null,
            reason: input.reason ?? null,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            actorType: input.actorType ?? null,
            actorId: input.actorId ?? null,
        },
        select: { id: true },
    })

    await tx.stockLevel.upsert({
        where: { productId_locationId: { productId: input.productId, locationId } },
        create: { productId: input.productId, locationId, onHand: 0, reserved: 0 },
        update: {},
        select: { productId: true },
    })

    const level = await tx.stockLevel.update({
        where: { productId_locationId: { productId: input.productId, locationId } },
        data: { onHand: { increment: input.quantity } },
        select: { onHand: true },
    })

    return { movementId: movement.id, onHand: level.onHand, deduplicated: false }
}

export async function reserve(
    tx: InventoryTx,
    productId: string,
    quantity: number,
    locationId: string = DEFAULT_LOCATION_ID
): Promise<void> {
    assertPositive(quantity, "reserve")
    const level = await tx.stockLevel.findUnique({
        where: { productId_locationId: { productId, locationId } },
        select: { onHand: true, reserved: true },
    })
    const available = (level?.onHand ?? 0) - (level?.reserved ?? 0)
    if (available < quantity) {
        throw new InsufficientStockError(productId, locationId, quantity, available)
    }
    await tx.stockLevel.update({
        where: { productId_locationId: { productId, locationId } },
        data: { reserved: { increment: quantity } },
    })
}

export async function release(
    tx: InventoryTx,
    productId: string,
    quantity: number,
    locationId: string = DEFAULT_LOCATION_ID
): Promise<void> {
    assertPositive(quantity, "release")
    const level = await tx.stockLevel.findUnique({
        where: { productId_locationId: { productId, locationId } },
        select: { reserved: true },
    })
    const decrement = Math.min(quantity, level?.reserved ?? 0)
    if (decrement === 0) return
    await tx.stockLevel.update({
        where: { productId_locationId: { productId, locationId } },
        data: { reserved: { decrement } },
    })
}

export async function availableQuantity(
    tx: InventoryTx,
    productId: string,
    locationId: string = DEFAULT_LOCATION_ID
): Promise<number> {
    const level = await tx.stockLevel.findUnique({
        where: { productId_locationId: { productId, locationId } },
        select: { onHand: true, reserved: true },
    })
    return Math.max(0, (level?.onHand ?? 0) - (level?.reserved ?? 0))
}

export async function reconcile(
    tx: InventoryTx,
    locationId: string = DEFAULT_LOCATION_ID
): Promise<Array<{ productId: string; ledger: number; stored: number }>> {
    const ledger = await tx.stockMovement.groupBy({
        by: ["productId"],
        where: { locationId },
        _sum: { quantity: true },
    })
    const stored = await tx.stockLevel.findMany({
        where: { locationId },
        select: { productId: true, onHand: true },
    })
    const storedBy = new Map(stored.map((row) => [row.productId, row.onHand]))
    const drift: Array<{ productId: string; ledger: number; stored: number }> = []

    for (const row of ledger) {
        const sum = row._sum.quantity ?? 0
        const onHand = storedBy.get(row.productId) ?? 0
        if (sum !== onHand) drift.push({ productId: row.productId, ledger: sum, stored: onHand })
        storedBy.delete(row.productId)
    }
    for (const [productId, onHand] of storedBy) {
        if (onHand !== 0) drift.push({ productId, ledger: 0, stored: onHand })
    }
    return drift
}

export class InsufficientStockError extends Error {
    constructor(
        readonly productId: string,
        readonly locationId: string,
        readonly requested: number,
        readonly available: number
    ) {
        super(`insufficient stock for ${productId} at ${locationId}: requested ${requested}, available ${available}`)
        this.name = "InsufficientStockError"
    }
}

function assertDirection(type: MovementType, quantity: number): void {
    if (!Number.isInteger(quantity)) {
        throw new RangeError(`recordMovement(): quantity must be an integer, got ${quantity}`)
    }
    const direction = DIRECTION[type]
    if (direction === "in" && quantity < 0) {
        throw new RangeError(`recordMovement(): ${type} adds stock; quantity may not be negative (${quantity})`)
    }
    if (direction === "out" && quantity >= 0) {
        throw new RangeError(`recordMovement(): ${type} removes stock; quantity must be negative (${quantity})`)
    }
    if (direction === "either" && quantity === 0) {
        throw new RangeError(`recordMovement(): ADJUSTMENT of 0 records nothing`)
    }
}

function assertPositive(quantity: number, fn: string): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new RangeError(`${fn}(): quantity must be a positive integer, got ${quantity}`)
    }
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 10

export async function countLowStock(
    prisma: PrismaClient,
    threshold = DEFAULT_LOW_STOCK_THRESHOLD,
    locationId: string = DEFAULT_LOCATION_ID
): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n
          FROM products p
          LEFT JOIN stock_levels l
            ON l."productId" = p.id AND l."locationId" = ${locationId}
         WHERE p."isActive" AND p."deletedAt" IS NULL
           AND COALESCE(l."onHand", 0) - COALESCE(l."reserved", 0) < ${threshold}`
    return Number(rows[0]?.n ?? 0)
}

export async function listLowStock(
    prisma: PrismaClient,
    threshold = DEFAULT_LOW_STOCK_THRESHOLD,
    locationId: string = DEFAULT_LOCATION_ID
): Promise<Array<{ productId: string; sku: string; onHand: number; reserved: number; available: number }>> {
    const rows = await prisma.$queryRaw<
        Array<{ productId: string; sku: string; onHand: number; reserved: number; available: number }>
    >`
        SELECT p.id AS "productId", p."productId" AS sku,
               COALESCE(l."onHand", 0) AS "onHand",
               COALESCE(l."reserved", 0) AS reserved,
               COALESCE(l."onHand", 0) - COALESCE(l."reserved", 0) AS available
          FROM products p
          LEFT JOIN stock_levels l
            ON l."productId" = p.id AND l."locationId" = ${locationId}
         WHERE p."isActive" AND p."deletedAt" IS NULL
           AND COALESCE(l."onHand", 0) - COALESCE(l."reserved", 0) < ${threshold}
         ORDER BY available ASC, sku ASC`
    return rows
}

export const RESERVATION_TTL_SETTING = "inventory.reservation_ttl_hours"
export const DEFAULT_RESERVATION_TTL_HOURS = 72

/**
 * The audit-log action the sweep writes when it releases an order's reservation without
 * cancelling the order. `transitionOrder` reads it: an order that carries this row no longer
 * holds a reservation, so shipping or cancelling it must not call `release()` again —
 * `release()` clamps to the current `reserved`, and a second release would silently take
 * another order's reservation.
 */
export const RESERVATION_EXPIRED_ACTION = "inventory.reservation_expired"

export async function reservationExpired(tx: InventoryTx, orderId: string): Promise<boolean> {
    const row = await tx.adminAuditLog.findFirst({
        where: { entity: "Order", entityId: orderId, action: RESERVATION_EXPIRED_ACTION },
        select: { id: true },
    })
    return row !== null
}

/**
 * Locks the order row for the rest of `tx`. Every writer that moves an order or touches its
 * reservation (`transitionOrder`, the expiry sweep) takes this lock first and re-reads the
 * status afterwards, so two concurrent writers serialize instead of both acting on the same
 * stale `awaiting_shipment`.
 */
export async function lockOrderRow(tx: InventoryTx, orderId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "orders" WHERE id = ${orderId} FOR UPDATE`
}

export interface SweepSummary {
    windowHours: number
    ordersConsidered: number
    ordersReleased: number
    itemsReleased: number
    released: Array<{ orderId: string; orderNumber: string; ageHours: number }>
}

export async function sweepExpiredReservations(
    prisma: PrismaClient,
    now: Date = new Date()
): Promise<SweepSummary> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: RESERVATION_TTL_SETTING } })
    const parsed = Number(setting?.value)
    const windowHours = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESERVATION_TTL_HOURS
    const cutoff = new Date(now.getTime() - windowHours * 3_600_000)

    // Only a candidate list: everything that decides whether to release happens under the
    // order's row lock inside the per-order transaction below.
    const candidates = await prisma.order.findMany({
        where: { status: "awaiting_shipment", createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
    })

    const summary: SweepSummary = {
        windowHours,
        ordersConsidered: candidates.length,
        ordersReleased: 0,
        itemsReleased: 0,
        released: [],
    }

    for (const candidate of candidates) {
        const released = await prisma.$transaction(async (tx) => {
            await lockOrderRow(tx, candidate.id)

            // Re-read under the lock: a transition that committed between the candidate read
            // and here has already released (cancelled) or consumed (shipped) the reservation.
            const order = await tx.order.findUnique({
                where: { id: candidate.id },
                select: {
                    id: true,
                    status: true,
                    orderNumber: true,
                    createdAt: true,
                    items: { select: { productId: true, quantity: true } },
                },
            })
            if (!order || order.status !== "awaiting_shipment") return null
            if (await reservationExpired(tx, order.id)) return null

            let itemsReleased = 0
            for (const item of order.items) {
                await release(tx, item.productId, item.quantity)
                itemsReleased += item.quantity
            }

            await tx.adminAuditLog.create({
                data: {
                    actorType: "SYSTEM",
                    action: RESERVATION_EXPIRED_ACTION,
                    entity: "Order",
                    entityId: order.id,
                    diff: {
                        orderNumber: order.orderNumber,
                        windowHours,
                        items: order.items.length,
                        note: "reservation released; the order was NOT cancelled",
                    },
                },
            })

            // Direct writes, not @repo/notifications: importing it here would close a
            // dependency cycle (notifications depends on database). The push sweep picks these
            // rows up like any other.
            const admins = await tx.user.findMany({
                where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
                select: { id: true },
            })
            if (admins.length > 0) {
                await tx.notification.createMany({
                    data: admins.map((admin) => ({
                        userId: admin.id,
                        type: "LOW_INVENTORY" as const,
                        priority: "HIGH" as const,
                        title: `Reservation expired: ${order.orderNumber}`,
                        message:
                            `Order ${order.orderNumber} has been awaiting shipment for over ${windowHours} hours. ` +
                            `Its stock reservation has been released so other customers can buy. ` +
                            `The order is still open — cancel or ship it.`,
                        actionUrl: `/admin/orders/${order.id}`,
                        metadata: { orderId: order.id, windowHours },
                    })),
                })
            }

            return { orderNumber: order.orderNumber, createdAt: order.createdAt, itemsReleased }
        })

        if (!released) continue
        summary.ordersReleased++
        summary.itemsReleased += released.itemsReleased
        summary.released.push({
            orderId: candidate.id,
            orderNumber: released.orderNumber,
            ageHours: Math.floor((now.getTime() - released.createdAt.getTime()) / 3_600_000),
        })
    }

    return summary
}

export type StockLevelFilter = "all" | "in_stock" | "low" | "reserved" | "out" | "negative"

export type StockLevelSort = "sku" | "name" | "onHand" | "reserved" | "available"

export interface StockLevelRow {
    productId: string
    sku: string
    name: string | null
    onHand: number
    reserved: number
    available: number
    isActive: boolean
    hasCost: boolean
}

export interface StockLevelPage {
    rows: StockLevelRow[]
    total: number
}

const SORT_SQL: Record<StockLevelSort, string> = {
    sku: `p."productId"`,
    name: `t.name`,
    onHand: `COALESCE(l."onHand", 0)`,
    reserved: `COALESCE(l."reserved", 0)`,
    available: `COALESCE(l."onHand", 0) - COALESCE(l."reserved", 0)`,
}

export async function listStockLevels(
    prisma: PrismaClient,
    options: {
        search?: string
        filter?: StockLevelFilter
        status?: string
        cost?: string
        sort?: StockLevelSort
        dir?: "asc" | "desc"
        skip?: number
        take?: number
        threshold?: number
        locale?: string
        locationId?: string
    } = {}
): Promise<StockLevelPage> {
    const threshold = options.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD
    const locationId = options.locationId ?? DEFAULT_LOCATION_ID
    const locale = options.locale ?? "en"
    const take = Math.min(Math.max(options.take ?? 50, 1), 500)
    const skip = Math.max(options.skip ?? 0, 0)

    const available = Prisma.sql`COALESCE(l."onHand", 0) - COALESCE(l."reserved", 0)`
    const onHand = Prisma.sql`COALESCE(l."onHand", 0)`

    const where: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`]

    const search = options.search?.trim()
    if (search) {
        const pattern = `%${search}%`
        where.push(Prisma.sql`(
            p."productId" ILIKE ${pattern}
         OR p.slug ILIKE ${pattern}
         OR EXISTS (SELECT 1 FROM product_translations tr
                     WHERE tr."productId" = p.id AND tr.name ILIKE ${pattern})
        )`)
    }

    switch (options.filter) {
        case "out":
            where.push(Prisma.sql`${onHand} <= 0`)
            break
        case "reserved":
            where.push(Prisma.sql`${onHand} > 0 AND ${available} <= 0`)
            break
        case "low":
            where.push(Prisma.sql`${available} > 0 AND ${available} < ${threshold}`)
            break
        case "in_stock":
            where.push(Prisma.sql`${available} >= ${threshold}`)
            break
        case "negative":
            where.push(Prisma.sql`(${onHand} < 0 OR COALESCE(l."reserved", 0) < 0)`)
            break
        default:
            break
    }

    if (options.status === "active") where.push(Prisma.sql`p."isActive"`)
    if (options.status === "hidden") where.push(Prisma.sql`NOT p."isActive"`)
    if (options.cost === "missing") where.push(Prisma.sql`p."averageCost" IS NULL`)
    if (options.cost === "recorded") where.push(Prisma.sql`p."averageCost" IS NOT NULL`)

    const predicate = Prisma.join(where, " AND ")
    const level = Prisma.sql`
        LEFT JOIN stock_levels l ON l."productId" = p.id AND l."locationId" = ${locationId}
        LEFT JOIN product_translations t ON t."productId" = p.id AND t.locale = ${locale}`

    const column = SORT_SQL[options.sort ?? "available"] ?? SORT_SQL.available
    const order = Prisma.raw(`${column} ${options.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`)

    const counted = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM products p ${level} WHERE ${predicate}`
    const total = Number(counted[0]?.n ?? 0)
    const offset = Math.min(skip, Math.max(0, (Math.max(1, Math.ceil(total / take)) - 1) * take))

    const rows = await prisma.$queryRaw<
            Array<{
                productId: string
                sku: string
                name: string | null
                onHand: number
                reserved: number
                available: number
                isActive: boolean
                hasCost: boolean
            }>
        >`
            SELECT p.id AS "productId",
                   p."productId" AS sku,
                   t.name AS name,
                   ${onHand} AS "onHand",
                   COALESCE(l."reserved", 0) AS reserved,
                   ${available} AS available,
                   p."isActive" AS "isActive",
                   (p."averageCost" IS NOT NULL) AS "hasCost"
              FROM products p ${level}
             WHERE ${predicate}
             ORDER BY ${order}, p."productId" ASC
             LIMIT ${take} OFFSET ${offset}`

    return { rows, total }
}
