import {
    IllegalTransitionError,
    prisma,
    resolveLocale,
    transitionOrder,
    type Actor,
    type OrderStatus,
    type Prisma,
} from "@repo/database"
import { queueMail } from "@repo/mail/outbox"
import { logger } from "@/lib/logger"

export type TransitionFailure = "not_found" | "illegal_transition" | "unknown"

export interface TransitionOutcome {
    success: boolean
    message?: string
    error?: string
    code?: TransitionFailure
    alreadyApplied?: boolean
}

// The link in the customer's mail must be absolute: the mail is opened far away from any origin.
// NEXT_PUBLIC_APP_URL is the storefront's public address; STOREFRONT_URL is the Vercel service
// binding (vercel.json), which always exists in a deployment but may be a deployment-bound host,
// so the public one wins when both are set.
function storefrontOrderUrl(locale: string, orderId: string): string | null {
    const base = process.env.NEXT_PUBLIC_APP_URL || process.env.STOREFRONT_URL
    if (!base) return null
    try {
        return new URL(`/${locale}/orders/${orderId}`, base).toString()
    } catch {
        return null
    }
}

// The storefront's transitionOrderWithNotification does the same thing for customer-initiated
// moves. Every status change the admin makes is one the customer is told about — the shipping
// dialog and the cancel dialog both promise it — so the mail is queued inside the same
// transaction as the transition, deduplicated per (order, status) like the storefront's.
async function mailCustomer(tx: Prisma.TransactionClient, orderId: string, to: OrderStatus) {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
            orderNumber: true,
            trackingNumber: true,
            user: { select: { email: true, preferredLanguage: true } },
        },
    })
    if (!order?.user?.email) return

    const locale = resolveLocale(order.user.preferredLanguage)
    const orderUrl = storefrontOrderUrl(locale, orderId)
    if (!orderUrl) {
        // A relative href is a dead link in a mail client. The template requires one, so the
        // mail is skipped rather than sent broken; the transition itself still commits.
        logger.error(
            { orderId, to },
            "neither NEXT_PUBLIC_APP_URL nor STOREFRONT_URL is set; customer was not mailed about the status change"
        )
        return
    }

    await queueMail(tx, {
        template: "order-status-change",
        to: order.user.email,
        locale,
        payload: {
            orderNumber: order.orderNumber,
            status: to,
            orderUrl,
            trackingNumber: order.trackingNumber ?? undefined,
        },
        dedupeKey: `order-status:${orderId}:${to}`,
    })
}

async function run(orderId: string, to: OrderStatus, actor: Actor, extra?: { trackingNumber?: string; reason?: string }): Promise<TransitionOutcome> {
    try {
        // transitionOrder reports a missing order with a plain Error that carries the id; the
        // existence check up front lets callers map "not found" without parsing messages.
        const exists = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } })
        if (!exists) return { success: false, code: "not_found", error: "Order not found." }

        const result = await transitionOrder(
            prisma,
            {
                orderId,
                to,
                actor,
                trackingNumber: extra?.trackingNumber ?? null,
                reason: extra?.reason ?? null,
            },
            async (tx, outcome) => {
                if (outcome.alreadyApplied) return
                await mailCustomer(tx, outcome.orderId, outcome.to)
            }
        )
        return {
            success: true,
            alreadyApplied: result.alreadyApplied,
            message: result.alreadyApplied ? `Order was already ${to}.` : `Order moved to ${to}.`,
        }
    } catch (error) {
        if (error instanceof IllegalTransitionError) {
            return { success: false, code: "illegal_transition", error: error.message }
        }
        logger.error({ err: error, orderId, to }, "order transition failed")
        return { success: false, code: "unknown", error: "Transition failed. Try again, and tell an administrator if it keeps happening." }
    }
}

export class OrderService {
    static cancelOrder(orderId: string, actor: Actor, reason?: string) {
        return run(orderId, "cancelled", actor, { reason })
    }

    static shipOrder(orderId: string, actor: Actor, trackingNumber?: string) {
        return run(orderId, "shipped", actor, { trackingNumber })
    }

    static confirmDelivery(orderId: string, actor: Actor) {
        return run(orderId, "delivered", actor)
    }

    static returnOrder(orderId: string, actor: Actor, reason?: string) {
        return run(orderId, "cancelled", actor, { reason: reason ?? "returned" })
    }
}
