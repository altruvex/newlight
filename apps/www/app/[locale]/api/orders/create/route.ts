import { requestOrderCancellation } from "@/actions/order"
import type { OrderErrorCode } from "@/lib/services/order-errors"
import { logger } from "@/lib/logger"
import { OrderService } from "@/lib/services/order-service"
import { currentUserId } from "@/lib/auth"
import { NextResponse } from "next/server"

const STATUS_BY_CODE: Partial<Record<OrderErrorCode, number>> = {
    UNAUTHENTICATED: 401,
    ORDER_NOT_FOUND: 404,
    ORDER_NOT_CANCELLABLE: 409,
    INVALID_INPUT: 400,
    FAILED: 500,
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ locale: string }> }
) {
    const userId = await currentUserId()

    if (!userId) {
        logger.warn({ action: 'cancel_order' }, 'Unauthenticated attempt')
        return NextResponse.json(
            { error: "Authentication required" },
            { status: 401 }
        )
    }

    try {
        const body = await request.json()
        const { orderId } = body

        if (!orderId) {
            logger.warn({ action: 'cancel_order' }, 'Missing orderId')
            return NextResponse.json(
                { error: "Order ID is required" },
                { status: 400 }
            )
        }

        logger.info({ action: 'cancel_order' }, 'Cancellation initiated')

        const result = await requestOrderCancellation(orderId)

        if (!result.success) {
            logger.warn({ action: 'cancel_order', code: result.code }, 'Cancellation failed')

            const status = STATUS_BY_CODE[result.code] ?? 400
            return NextResponse.json(
                { error: result.error ?? "Failed to cancel order", code: result.code },
                { status }
            )
        }

        logger.info({ action: 'cancel_order' }, 'Order cancelled successfully')

        return NextResponse.json({
            success: true,
            message: "Order cancelled successfully",
        }, { status: 200 })

    } catch (error) {
        logger.error({
            action: 'cancel_order',
            err: error
        }, 'Unexpected error')

        return NextResponse.json(
            { error: "An unexpected error occurred while cancelling the order" },
            { status: 500 }
        )
    }
}
