import { NextResponse } from "next/server"
import { ForbiddenError, requireCurrentAdmin, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { OrderService, type TransitionFailure } from "@/lib/services/order-service"

const STATUS_BY_FAILURE: Record<TransitionFailure, number> = {
    not_found: 404,
    illegal_transition: 409,
    unknown: 500,
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ orderId: string }> }
) {
    try {
        const { orderId } = await params

        if (!orderId) {
            return NextResponse.json({ error: "Order ID is required" }, { status: 400 })
        }

        const admin = await requireCurrentAdmin()

        const result = await OrderService.cancelOrder(
            orderId,
            { type: "ADMIN", id: admin.id, email: admin.email },
            "cancelled from the admin panel"
        )

        if (!result.success) {
            const status = STATUS_BY_FAILURE[result.code ?? "unknown"]
            return NextResponse.json({ error: result.error ?? "Failed to cancel order" }, { status })
        }

        logger.info({ orderId, alreadyApplied: result.alreadyApplied }, "order cancelled from the admin panel")

        return NextResponse.json(
            { success: true, message: result.message || "Order cancelled successfully" },
            { status: 200 }
        )
    } catch (error) {
        if (error instanceof UnauthenticatedError) {
            return NextResponse.json({ error: "Sign in to continue." }, { status: 401 })
        }
        if (error instanceof ForbiddenError) {
            return NextResponse.json({ error: "Your account is not an admin." }, { status: 403 })
        }
        logger.error({ err: error }, "cancel route failed")
        return NextResponse.json(
            { error: "An unexpected error occurred while cancelling the order" },
            { status: 500 }
        )
    }
}
