import { prisma, resolveLocale, transitionOrder, type Actor, type OrderStatus, type TransitionResult } from "@repo/database"
import { queueMail } from "@repo/mail/outbox"
import { adminRecipients, notifyRecipients } from "@repo/notifications"
import { dispatchDeliveriesAfterResponse } from "@/lib/deliveries"

export async function transitionOrderWithNotification(input: {
    orderId: string
    to: OrderStatus
    actor: Actor
    trackingNumber?: string | null
    reason?: string | null
}): Promise<TransitionResult> {
    const notifiable = input.to === "cancelled" && input.actor.type === "CUSTOMER"
    const recipients = notifiable ? await adminRecipients(prisma) : []

    const result = await transitionOrder(prisma, input, async (tx, result) => {
        if (result.alreadyApplied) return

        const order = await tx.order.findUnique({
            where: { id: result.orderId },
            select: {
                orderNumber: true,
                trackingNumber: true,
                user: { select: { name: true, email: true, preferredLanguage: true } },
            },
        })
        if (!order) return

        if (notifiable) {
            await notifyRecipients(tx, recipients, {
                type: "ORDER_CANCELLED",
                title: `Order ${order.orderNumber} cancelled`,
                message: `${order.user?.name ?? "A customer"} cancelled their order.${input.reason ? ` Reason: ${input.reason}` : ""}`,
                actionUrl: `/admin/orders/${result.orderId}`,
                priority: "HIGH",
                metadata: { orderId: result.orderId, orderNumber: order.orderNumber, reason: input.reason ?? null },
            })
        }

        if (!order.user?.email) return

        const locale = resolveLocale(order.user.preferredLanguage)
        await queueMail(tx, {
            template: "order-status-change",
            to: order.user.email,
            locale,
            payload: {
                orderNumber: order.orderNumber,
                status: result.to,
                orderUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${locale}/orders/${result.orderId}`,
                trackingNumber: order.trackingNumber ?? undefined,
            },
            dedupeKey: `order-status:${result.orderId}:${result.to}`,
        })
    })

    dispatchDeliveriesAfterResponse("order-transition")

    return result
}
