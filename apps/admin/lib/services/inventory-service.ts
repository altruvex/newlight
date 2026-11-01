import {
    codRefusalRate,
    countLowStock,
    deadStock,
    DEFAULT_LOCATION_ID,
    grossMargin,
    listLowStock,
    listStockLevels,
    movementHistory,
    prisma,
    recordMovement,
    sellThrough,
    stocktakeVariance,
    stockValuation,
    type StockLevelFilter,
    type StockLevelPage,
    type StockLevelRow,
    type StockLevelSort,
} from "@repo/database"

export type StockRow = StockLevelRow
import { requireCurrentAdmin } from "@/lib/auth"

export const STOCK_FILTERS = ["all", "in_stock", "low", "reserved", "out", "negative"] as const

export const STOCK_SORT_COLUMNS = ["sku", "name", "onHand", "reserved", "available"] as const

export class InventoryError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "InventoryError"
    }
}

const DECIMAL = /^\d+(\.\d{1,4})?$/

// unitCost arrives as the string the admin typed; Number("abc") is NaN, which the old `<= 0`
// check let through to the ledger. Only a plain positive decimal is a cost.
function assertUnitCost(unitCost: string | null): void {
    if (unitCost === null) return
    if (!DECIMAL.test(unitCost) || Number(unitCost) <= 0) {
        throw new InventoryError("Unit cost must be a positive amount such as 12.50, or left empty when it is not recorded.")
    }
}

function assertPositiveInteger(quantity: number, what: string): void {
    if (!Number.isInteger(quantity) || quantity <= 0) throw new InventoryError(`${what} must be a whole number above zero.`)
}

export class InventoryService {
    static async adjust(input: {
        productId: string
        quantity: number
        reason: string
        locationId?: string
    }) {
        const admin = await requireCurrentAdmin()
        if (!Number.isInteger(input.quantity) || input.quantity === 0) throw new InventoryError("Enter a whole number that is not zero.")
        if (!input.reason.trim()) throw new InventoryError("An adjustment needs a reason.")

        return prisma.$transaction((tx) =>
            recordMovement(tx, {
                productId: input.productId,
                locationId: input.locationId ?? DEFAULT_LOCATION_ID,
                type: "ADJUSTMENT",
                quantity: input.quantity,
                reason: input.reason.trim(),
                referenceType: "manual",
                referenceId: `${admin.id}:${Date.now()}`,
                actorType: "ADMIN",
                actorId: admin.id,
            })
        )
    }

    static async recordDamage(input: { productId: string; quantity: number; reason: string; locationId?: string }) {
        const admin = await requireCurrentAdmin()
        assertPositiveInteger(input.quantity, "The number of damaged units")
        if (!input.reason.trim()) throw new InventoryError("Damage needs a reason.")

        return prisma.$transaction((tx) =>
            recordMovement(tx, {
                productId: input.productId,
                locationId: input.locationId ?? DEFAULT_LOCATION_ID,
                type: "DAMAGE",
                quantity: -Math.abs(input.quantity),
                reason: input.reason.trim(),
                referenceType: "manual",
                referenceId: `${admin.id}:${Date.now()}`,
                actorType: "ADMIN",
                actorId: admin.id,
            })
        )
    }

    static async receivePurchase(input: {
        productId: string
        quantity: number
        unitCost: string | null
        reason?: string
        locationId?: string
    }) {
        const admin = await requireCurrentAdmin()
        assertPositiveInteger(input.quantity, "A receipt quantity")
        assertUnitCost(input.unitCost)

        return prisma.$transaction(async (tx) => {
            const movement = await recordMovement(tx, {
                productId: input.productId,
                locationId: input.locationId ?? DEFAULT_LOCATION_ID,
                type: "PURCHASE_RECEIPT",
                quantity: input.quantity,
                unitCost: input.unitCost,
                reason: input.reason ?? "purchase receipt",
                referenceType: "manual",
                referenceId: `${admin.id}:${Date.now()}`,
                actorType: "ADMIN",
                actorId: admin.id,
            })

            if (input.unitCost !== null) {
                const rows = await tx.$queryRaw<Array<{ avg: string | null }>>`
                    SELECT (sum("unitCost" * quantity) / NULLIF(sum(quantity), 0))::text AS avg
                      FROM stock_movements
                     WHERE "productId" = ${input.productId}
                       AND type = 'PURCHASE_RECEIPT'
                       AND "unitCost" IS NOT NULL`
                const average = rows[0]?.avg
                if (average) {
                    await tx.product.update({ where: { id: input.productId }, data: { averageCost: average } })
                }
            }

            return movement
        })
    }

    static async lowStock(threshold = 10) {
        await requireCurrentAdmin()
        return listLowStock(prisma, threshold)
    }

    static async lowStockCount(threshold = 10) {
        await requireCurrentAdmin()
        return countLowStock(prisma, threshold)
    }

    static async stockLevels(input: {
        search?: string
        filter?: string
        status?: string
        cost?: string
        sort?: string | null
        dir?: "asc" | "desc"
        skip?: number
        take?: number
        threshold?: number
    }): Promise<StockLevelPage> {
        await requireCurrentAdmin()

        const filter = (STOCK_FILTERS as readonly string[]).includes(input.filter ?? "")
            ? (input.filter as StockLevelFilter)
            : "all"
        const sort = (STOCK_SORT_COLUMNS as readonly string[]).includes(input.sort ?? "")
            ? (input.sort as StockLevelSort)
            : "available"

        return listStockLevels(prisma, {
            search: input.search,
            filter,
            status: input.status,
            cost: input.cost,
            sort,
            dir: input.dir ?? "asc",
            skip: input.skip,
            take: input.take,
            threshold: input.threshold,
        })
    }

    static async history(productId: string, limit = 100) {
        await requireCurrentAdmin()
        return movementHistory(prisma, productId, limit)
    }

    static async reports(since: Date) {
        await requireCurrentAdmin()
        const [valuation, variance, sold, dead, margin, refusals] = await Promise.all([
            stockValuation(prisma),
            stocktakeVariance(prisma),
            sellThrough(prisma, since),
            deadStock(prisma, since),
            grossMargin(prisma, since),
            codRefusalRate(prisma, since),
        ])
        return { valuation, variance, sold, dead, margin, refusals }
    }

    static async reportsForLastDays(days: number) {
        return this.reports(new Date(Date.now() - days * 86_400_000))
    }

    static async completeOpeningStocktake() {
        const admin = await requireCurrentAdmin()
        await prisma.$transaction(async (tx) => {
            await tx.systemSetting.updateMany({
                where: { key: "inventory.opening_count_pending" },
                data: { value: "false" },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "inventory.opening_stocktake_completed",
                    entity: "SystemSetting",
                    entityId: "inventory.opening_count_pending",
                    diff: { from: "true", to: "false" },
                },
            })
        })
    }
}
