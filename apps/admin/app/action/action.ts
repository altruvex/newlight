"use server"

import { revalidatePath } from "next/cache"
import { OrderStatus, prisma } from "@repo/database"
import { z } from "zod"
import { OrderService, type TransitionOutcome } from "@/lib/services/order-service"
import { ForbiddenError, requireCurrentAdmin, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { revalidateStorefront } from "@/lib/revalidate"

const GENERIC_ERROR = "Something went wrong. Try again, and tell an administrator if it keeps happening."

class OrderActionError extends Error {}

// Every order action answers in the shape the dialogs read: { success, error? }. Only domain
// errors carry their own message; anything else is logged here and reported generically.
async function run<T extends { success: boolean }>(fn: () => Promise<T>): Promise<T | { success: false; error: string }> {
    try {
        return await fn()
    } catch (error) {
        if (error instanceof UnauthenticatedError) return { success: false, error: "You are signed out. Sign in again." }
        if (error instanceof ForbiddenError) return { success: false, error: "Your role does not allow this." }
        if (error instanceof OrderActionError) return { success: false, error: error.message }
        logger.error({ err: error }, "order action failed")
        return { success: false, error: GENERIC_ERROR }
    }
}

const changeOrderStatusSchema = z.object({
    id: z.string().min(1).max(64),
    newStatus: z.enum(OrderStatus),
    trackingNumber: z.string().max(120).optional(),
    reason: z.string().max(500).optional(),
})

export const changeOrderStatus = async (input: {
    id: string
    newStatus: OrderStatus
    trackingNumber?: string
    reason?: string
}): Promise<TransitionOutcome> => {
    return run(async () => {
        const parsed = changeOrderStatusSchema.safeParse(input)
        if (!parsed.success) throw new OrderActionError("That status change is not valid.")
        const { id, newStatus, trackingNumber, reason } = parsed.data

        const admin = await requireCurrentAdmin()
        const actor = { type: "ADMIN" as const, id: admin.id, email: admin.email }

        const result: TransitionOutcome =
            newStatus === "shipped"
                ? await OrderService.shipOrder(id, actor, trackingNumber)
                : newStatus === "delivered"
                  ? await OrderService.confirmDelivery(id, actor)
                  : newStatus === "cancelled"
                    ? await OrderService.cancelOrder(id, actor, reason)
                    : { success: false, code: "illegal_transition", error: `An admin cannot move an order to ${newStatus}.` }

        if (result.success) {
            revalidatePath("/admin/orders")
            revalidatePath(`/admin/orders/${id}`)
            await revalidateStorefront({ kind: "all" })
        }
        return result
    })
}

const trackingNumberSchema = z.string().max(120)

export const setTrackingNumber = async (
    orderId: string,
    trackingNumber: string
): Promise<{ success: true; unchanged: boolean } | { success: false; error: string }> => {
    return run(async () => {
        const admin = await requireCurrentAdmin()
        const parsedValue = trackingNumberSchema.safeParse(trackingNumber)
        if (!parsedValue.success) throw new OrderActionError("That tracking number is too long.")
        const value = parsedValue.data.trim() || null

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { orderNumber: true, status: true, trackingNumber: true },
        })
        if (!order) throw new OrderActionError("Order not found.")

        // The tracking number belongs to a shipment in flight. Before shipping there is nothing
        // to track; after delivery or cancellation the record is history and stays as it was.
        if (order.status !== "shipped") {
            throw new OrderActionError(
                order.status === "awaiting_shipment"
                    ? "This order has not shipped yet. Mark it shipped with its tracking number instead."
                    : `This order is ${order.status.replace(/_/g, " ")}; its tracking number can no longer change.`
            )
        }
        if (order.trackingNumber === value) {
            return { success: true as const, unchanged: true }
        }

        await prisma.$transaction(async (tx) => {
            await tx.order.update({ where: { id: orderId }, data: { trackingNumber: value } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "order.tracking_number",
                    entity: "Order",
                    entityId: orderId,
                    diff: { orderNumber: order.orderNumber, from: order.trackingNumber, to: value },
                },
            })
        })

        revalidatePath("/admin/orders")
        revalidatePath(`/admin/orders/${orderId}`)
        revalidatePath("/admin/shipping")
        return { success: true as const, unchanged: false }
    })
}
