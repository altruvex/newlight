import type { ActorType, OrderStatus, Prisma, PrismaClient } from "./generated/prisma/client"
import { DEFAULT_LOCATION_ID, lockOrderRow, recordMovement, release, reservationExpired } from "./inventory"

export interface Transition {
    from: OrderStatus
    to: OrderStatus
    actors: readonly ActorType[]
    description: string
}

export const TRANSITIONS: readonly Transition[] = [
    {
        from: "awaiting_shipment",
        to: "shipped",
        actors: ["ADMIN", "SYSTEM", "WEBHOOK"],
        description: "Stock leaves the warehouse: the reservation becomes a SALE movement.",
    },
    {
        from: "awaiting_shipment",
        to: "cancelled",
        actors: ["CUSTOMER", "ADMIN", "SYSTEM"],
        description: "Cancelled before shipping: the reservation is released, nothing moved.",
    },
    {
        from: "shipped",
        to: "delivered",
        actors: ["ADMIN", "WEBHOOK"],
        description: "Delivery confirmed. Payment settles through settlePaymentForDelivery (F4).",
    },
    {
        from: "shipped",
        to: "cancelled",
        actors: ["ADMIN", "WEBHOOK"],
        description: "Refused or returned after shipping: a RETURN movement, and it stays unpaid.",
    },
    {
        from: "delivered",
        to: "cancelled",
        actors: ["ADMIN"],
        description: "Returned after delivery: a RETURN movement and a refund.",
    },
]

export function allowedTransitionsFrom(status: OrderStatus, actor: ActorType): OrderStatus[] {
    return TRANSITIONS.filter((t) => t.from === status && t.actors.includes(actor)).map((t) => t.to)
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: ActorType): boolean {
    return TRANSITIONS.some((t) => t.from === from && t.to === to && t.actors.includes(actor))
}

export class IllegalTransitionError extends Error {
    constructor(
        readonly from: OrderStatus,
        readonly to: OrderStatus,
        readonly actor: ActorType
    ) {
        const exists = TRANSITIONS.some((t) => t.from === from && t.to === to)
        super(
            exists
                ? `a ${actor} may not move an order from ${from} to ${to}`
                : `${from} -> ${to} is not a legal transition`
        )
        this.name = "IllegalTransitionError"
    }
}

export interface Actor {
    type: ActorType
    id?: string | null
    email?: string | null
}

export interface TransitionInput {
    orderId: string
    to: OrderStatus
    actor: Actor
    trackingNumber?: string | null
    reason?: string | null
}

export interface TransitionResult {
    orderId: string
    from: OrderStatus
    to: OrderStatus
    alreadyApplied: boolean
    movements: number
    paymentSettled: boolean
}

export type AfterTransition = (
    tx: Prisma.TransactionClient,
    result: TransitionResult
) => Promise<void>

export async function settlePaymentForDelivery(
    tx: Prisma.TransactionClient,
    orderId: string
): Promise<boolean> {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { paymentStatus: true, paymentMethod: true, paidAt: true },
    })
    if (!order) return false

    if (order.paymentStatus === "PAID") return false

    if (order.paymentMethod !== "COD") {
        return false
    }

    await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: "PAID", paidAt: new Date() },
    })
    return true
}

export async function transitionOrder(
    prisma: PrismaClient,
    input: TransitionInput,
    afterTransition?: AfterTransition
): Promise<TransitionResult> {
    return prisma.$transaction(
        async (tx) => {
            // Lock first, read second: a concurrent transition (customer cancels while the admin
            // ships) waits here and then sees the committed status instead of a stale one.
            await lockOrderRow(tx, input.orderId)

            const order = await tx.order.findUnique({
                where: { id: input.orderId },
                select: {
                    id: true,
                    status: true,
                    orderNumber: true,
                    items: { select: { id: true, productId: true, quantity: true } },
                },
            })
            if (!order) throw new Error(`order ${input.orderId} not found`)

            if (order.status === input.to) {
                return {
                    orderId: order.id,
                    from: order.status,
                    to: input.to,
                    alreadyApplied: true,
                    movements: 0,
                    paymentSettled: false,
                }
            }

            if (!canTransition(order.status, input.to, input.actor.type)) {
                throw new IllegalTransitionError(order.status, input.to, input.actor.type)
            }

            const from = order.status
            let movements = 0

            // The expiry sweep may already have released this order's reservation (and said so in
            // the audit log). Releasing again would take another order's reservation; the SALE
            // movement still has to happen.
            const holdsReservation = from === "awaiting_shipment" && !(await reservationExpired(tx, order.id))

            if (input.to === "shipped") {
                for (const item of order.items) {
                    if (holdsReservation) await release(tx, item.productId, item.quantity)
                    const result = await recordMovement(tx, {
                        productId: item.productId,
                        locationId: DEFAULT_LOCATION_ID,
                        type: "SALE",
                        quantity: -item.quantity,
                        reason: `order ${order.orderNumber} shipped`,
                        referenceType: "order",
                        referenceId: order.id,
                        actorType: input.actor.type,
                        actorId: input.actor.id ?? null,
                    })
                    if (!result.deduplicated) movements++
                }
            } else if (input.to === "cancelled" && from === "awaiting_shipment") {
                if (holdsReservation) {
                    for (const item of order.items) {
                        await release(tx, item.productId, item.quantity)
                    }
                }
            } else if (input.to === "cancelled" && (from === "shipped" || from === "delivered")) {
                for (const item of order.items) {
                    const result = await recordMovement(tx, {
                        productId: item.productId,
                        locationId: DEFAULT_LOCATION_ID,
                        type: "RETURN",
                        quantity: item.quantity,
                        reason: input.reason ?? `order ${order.orderNumber} returned`,
                        referenceType: "order-return",
                        referenceId: order.id,
                        actorType: input.actor.type,
                        actorId: input.actor.id ?? null,
                    })
                    if (!result.deduplicated) movements++
                }
            }

            const data: Prisma.OrderUpdateInput = { status: input.to }
            if (input.to === "shipped") {
                data.shippedAt = new Date()
                if (input.trackingNumber) data.trackingNumber = input.trackingNumber
            }
            if (input.to === "delivered") data.deliveredAt = new Date()
            if (input.to === "cancelled" && from === "delivered") data.paymentStatus = "REFUNDED"

            await tx.order.update({ where: { id: order.id }, data })

            const paymentSettled = input.to === "delivered" ? await settlePaymentForDelivery(tx, order.id) : false

            await tx.adminAuditLog.create({
                data: {
                    actorType: input.actor.type,
                    actorId: input.actor.id ?? null,
                    actorEmail: input.actor.email ?? null,
                    action: `order.${from}->${input.to}`,
                    entity: "Order",
                    entityId: order.id,
                    diff: {
                        from,
                        to: input.to,
                        movements,
                        paymentSettled,
                        ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
                        ...(input.reason ? { reason: input.reason } : {}),
                    },
                },
            })

            const result: TransitionResult = {
                orderId: order.id,
                from,
                to: input.to,
                alreadyApplied: false,
                movements,
                paymentSettled,
            }

            if (afterTransition) await afterTransition(tx, result)
            return result
        },
        // A 20-line order is ~5 queries per item plus the afterTransition mail enqueue; on a cold
        // Neon connection that outruns Prisma's default 5s and rolls back with P2028. Isolation
        // stays at the default — the row lock above covers the race.
        { timeout: 15_000, maxWait: 5_000 }
    )
}

export const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export function isAdminRole(role: string | null | undefined): role is AdminRole {
    return role != null && (ADMIN_ROLES as readonly string[]).includes(role)
}
