import { currentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { updateCartItemOptionsSchema } from "@/lib/validation/schema"
import { prisma, type Prisma } from "@repo/database"
import { NextResponse } from "next/server"

export async function PATCH(request: Request) {
    const userId = await currentUserId()

    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const body = await request.json().catch(() => null)
        const validation = updateCartItemOptionsSchema.safeParse(body)
        if (!validation.success) {
            return NextResponse.json(
                { error: "Invalid input", details: validation.error.flatten().fieldErrors },
                { status: 400 }
            )
        }
        const { itemId, selectedColorTemp, selectedColorKey } = validation.data

        const cartItem = await prisma.cartItem.findFirst({
            where: {
                id: itemId,
                cart: { userId },
            },
        })

        if (!cartItem) {
            return NextResponse.json({ error: "Cart item not found" }, { status: 404 })
        }

        const updateData: Prisma.CartItemUpdateInput = {}
        if (selectedColorTemp !== undefined) {
            updateData.selectedColorTemp = selectedColorTemp
        }
        if (selectedColorKey !== undefined) {
            updateData.selectedColorKey = selectedColorKey
        }

        const updatedItem = await prisma.cartItem.update({
            where: { id: itemId },
            data: updateData,
        })

        return NextResponse.json({ success: true, item: updatedItem })
    } catch (error) {
        logger.error({ err: error }, "failed to update cart item options")
        return NextResponse.json({ error: "Failed to update cart item options" }, { status: 500 })
    }
}
