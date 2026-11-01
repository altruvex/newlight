"use server"

import {
    allowedTransitionsFrom,
    IllegalTransitionError,
    prisma,
    resolveLocale,
    SHIPPING_OPTIONS,
} from "@repo/database"
import { revalidatePath } from "next/cache"
import { getTranslations } from "next-intl/server"
import { z } from "zod"

import { currentIdentity, currentUserId } from "@/lib/auth"
import { generateIdempotencyKey } from "@/lib/idempotency"
import { logger } from "@/lib/logger"
import { claimConfiguration, findAccessibleConfiguration } from "@/lib/services/configuration-access"
import { type OrderErrorCode } from "@/lib/services/order-errors"
import { OrderService } from "@/lib/services/order-service"
import { transitionOrderWithNotification } from "@/lib/services/order-transitions"
import { ProductService } from "@/lib/services/product-service"
import { UserService } from "@/lib/services/user-service"
import { getShippingSchema } from "@/lib/validation/shipping"
import type { OrderWithDetails } from "@/types"

export type OrderActionFailure = {
    success: false
    code: OrderErrorCode
    /** Field-level validation messages, present only for INVALID_INPUT. */
    errors?: Record<string, string>
}

export type CreateOrderActionResult =
    | { success: true; order: { id: string }; orderNumber: string; isDuplicate: boolean }
    | OrderActionFailure

export type SaveShippingAddressResult = { success: true } | OrderActionFailure

export type CancelOrderActionResult =
    | { success: true; alreadyApplied: boolean }
    | (OrderActionFailure & { error?: string })

const createOrderInput = z.object({
    configId: z.string().min(1).max(64),
    shippingOption: z.enum(SHIPPING_OPTIONS),
})

/** The configuration the current visitor may see: their own, or one nobody has claimed yet. */
export async function getConfigurationDetails(configId: string) {
    try {
        return await findAccessibleConfiguration(configId, await currentUserId())
    } catch (error) {
        logger.error({ err: error, configId }, "failed to load configuration details")
        return null
    }
}

export async function getProductWithDetails(sku: string, locale: string) {
    try {
        return await ProductService.getProductBySku(sku, resolveLocale(locale))
    } catch (error) {
        logger.error({ err: error, sku }, "failed to load product details")
        return null
    }
}

/**
 * The signed-in customer's shipping address. The optional argument is accepted for callers
 * that still pass one; it is only ever compared against the session, never trusted.
 */
export async function getUserShippingAddress(expectedUserId?: string) {
    try {
        const userId = await currentUserId()
        if (!userId || (expectedUserId && expectedUserId !== userId)) return null
        return await UserService.getShippingAddress(userId)
    } catch (error) {
        logger.error({ err: error }, "failed to load shipping address")
        return null
    }
}

export async function saveShippingAddress(locale: string, input: unknown): Promise<SaveShippingAddressResult> {
    const userId = await currentUserId()
    if (!userId) return { success: false, code: "UNAUTHENTICATED" }

    const parsed = getShippingSchema(locale).safeParse(input)
    if (!parsed.success) {
        const errors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
            const field = String(issue.path[0] ?? "form")
            if (!errors[field]) errors[field] = issue.message
        }
        return { success: false, code: "INVALID_INPUT", errors }
    }

    try {
        await UserService.saveShippingAddress(userId, parsed.data)
        revalidatePath("/checkout")
        return { success: true }
    } catch (error) {
        logger.error({ err: error }, "failed to save shipping address")
        return { success: false, code: "FAILED" }
    }
}

export async function createOrderFromConfiguration(
    configId: string,
    shippingOption: string = "StandardShipping"
): Promise<CreateOrderActionResult> {
    const userId = await currentUserId()
    if (!userId) return { success: false, code: "UNAUTHENTICATED" }

    const input = createOrderInput.safeParse({ configId, shippingOption })
    if (!input.success) return { success: false, code: "INVALID_INPUT" }

    try {
        // Claim first: claiming bumps `updatedAt`, and the key below is derived from it so that
        // a refresh or back-button resubmit of the same configuration maps to the same order,
        // while a configuration edited after ordering can be ordered again.
        const configuration = await claimConfiguration(input.data.configId, userId)
        if (!configuration) return { success: false, code: "CONFIG_NOT_FOUND" }

        const idempotencyKey = generateIdempotencyKey(
            userId,
            configuration.id,
            configuration.updatedAt.toISOString()
        )

        const shippingAddress = await UserService.getShippingAddress(userId)
        if (!shippingAddress) return { success: false, code: "SHIPPING_ADDRESS_REQUIRED" }

        const result = await OrderService.createOrder({
            userId,
            configurationId: configuration.id,
            shippingAddressId: shippingAddress.id,
            shippingOption: input.data.shippingOption,
            idempotencyKey,
        })

        if (!result.success) return { success: false, code: result.code }

        revalidatePath("/orders")
        revalidatePath(`/orders/${result.orderId}`)

        return {
            success: true,
            order: { id: result.orderId },
            orderNumber: result.orderNumber,
            isDuplicate: result.isDuplicate,
        }
    } catch (error) {
        logger.error({ err: error, configId }, "order creation failed outside the service")
        return { success: false, code: "FAILED" }
    }
}

export async function getOrderDetails(orderId: string): Promise<OrderWithDetails | null> {
    try {
        const userId = await currentUserId()

        if (!userId) {
            return null
        }

        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId,
            },
            include: {
                items: {
                    include: {
                        product: {
                            include: {
                                translations: true,
                            },
                        },
                        configuration: true,
                    },
                },
                shippingAddress: true,
                configuration: true,
            },
        })

        return order
    } catch (error) {
        logger.error({ err: error, orderId }, "failed to load order details")
        return null
    }
}

export async function cancelOrder(orderId: string): Promise<CancelOrderActionResult> {
    return requestOrderCancellation(orderId)
}

export async function requestOrderCancellation(orderId: string, reason?: string): Promise<CancelOrderActionResult> {
    const identity = await currentIdentity()
    if (!identity) return { success: false, code: "UNAUTHENTICATED" }

    try {
        const order = await prisma.order.findFirst({
            where: { id: orderId, userId: identity.id },
            select: { id: true },
        })
        if (!order) return await cancellationFailure("ORDER_NOT_FOUND")

        const result = await transitionOrderWithNotification({
            orderId,
            to: "cancelled",
            actor: { type: "CUSTOMER", id: identity.id, email: identity.email },
            reason: reason ?? "cancelled by customer",
        })

        revalidatePath("/orders")
        revalidatePath(`/orders/${orderId}`)

        return { success: true, alreadyApplied: result.alreadyApplied }
    } catch (error) {
        if (error instanceof IllegalTransitionError) {
            logger.warn({ orderId, from: error.from, to: error.to }, "customer cancellation refused")
            return await cancellationFailure("ORDER_NOT_CANCELLABLE")
        }
        logger.error({ err: error, orderId }, "order cancellation failed")
        return await cancellationFailure("FAILED")
    }
}

// The cancel button renders `error` when present; give it the translated message for the code
// rather than the raw cause.
async function cancellationFailure(code: OrderErrorCode): Promise<CancelOrderActionResult> {
    try {
        const t = await getTranslations("confirm.errors")
        return { success: false, code, error: t(code) }
    } catch {
        return { success: false, code }
    }
}

export async function canCancelOrder(orderId: string): Promise<boolean> {
    try {
        const userId = await currentUserId()

        if (!userId) return false

        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                userId,
            },
            select: { status: true },
        })

        if (!order) return false

        return allowedTransitionsFrom(order.status, "CUSTOMER").includes("cancelled")
    } catch (error) {
        logger.error({ err: error, orderId }, "failed to check cancellability")
        return false
    }
}
