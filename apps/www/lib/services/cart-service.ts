import { activeDiscounts } from "@/lib/discounts"
import {
    Cart,
    CartItem,
    ProductColorTemp,
    availableQuantity,
    multiplyMoney,
    prisma,
    resolveEffectivePrice,
    serializeMoney,
    subtractMoney,
    sumMoney,
    type Locale,
    type SerializedMoney,
} from "@repo/database"

export type CartWithItems = NonNullable<Awaited<ReturnType<typeof CartService.getCartWithItems>>>
export type CartItemWithProduct = CartWithItems["items"][number]

export class CartService {
    static async getOrCreateCart(userId: string): Promise<Cart> {
        let cart = await prisma.cart.findUnique({
            where: { userId },
        })

        if (!cart) {
            cart = await prisma.cart.create({
                data: { userId },
            })
        }

        return cart
    }

    static async getCartWithItems(
        userId: string,
        locale: Locale = "ar"
    ) {
        const cart = await prisma.cart.findUnique({
            where: { userId },
            include: {
                items: {
                    include: {
                        product: {
                            include: {
                                translations: {
                                    where: { locale },
                                    take: 1,
                                },
                                images: { orderBy: { order: "asc" as const }, take: 1 },
                                availableColors: { include: { color: true }, orderBy: { order: "asc" as const } },
                                subCategory: {
                                    include: {
                                        translations: {
                                            where: { locale },
                                            take: 1,
                                        },
                                        category: {
                                            include: {
                                                translations: {
                                                    where: { locale },
                                                    take: 1,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })

        return cart
    }

    static async addToCart(params: {
        userId: string
        productId: string
        quantity: number
        selectedColorTemp?: ProductColorTemp
        selectedColorKey?: string
    }): Promise<{ success: boolean; cartItem: CartItem }> {
        const { userId, productId, quantity, selectedColorTemp, selectedColorKey } = params

        return await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({
                where: { productId },
            })

            if (!product) {
                throw new Error("PRODUCT_NOT_FOUND")
            }

            let cart = await tx.cart.findUnique({
                where: { userId },
            })

            if (!cart) {
                cart = await tx.cart.create({
                    data: { userId },
                })
            }

            const existingItem = await tx.cartItem.findFirst({
                where: {
                    cartId: cart.id,
                    productId: product.id,
                    selectedColorTemp: selectedColorTemp ?? null,
                    selectedColorKey: selectedColorKey || null,
                },
            })

            const available = await availableQuantity(tx, product.id)
            const requested = (existingItem?.quantity ?? 0) + quantity

            if (requested > available) {
                throw new Error("INSUFFICIENT_STOCK")
            }

            let cartItem: CartItem

            if (existingItem) {
                cartItem = await tx.cartItem.update({
                    where: { id: existingItem.id },
                    data: { quantity: existingItem.quantity + quantity },
                })
            } else {
                cartItem = await tx.cartItem.create({
                    data: {
                        cartId: cart.id,
                        productId: product.id,
                        quantity,
                        selectedColorTemp: selectedColorTemp ?? null,
                        selectedColorKey: selectedColorKey || null,
                    },
                })
            }

            return { success: true, cartItem }
        })
    }

    static async updateItemQuantity(params: {
        userId: string
        itemId: string
        quantity: number
    }): Promise<{ success: boolean; cartItem: CartItem }> {
        const { userId, itemId, quantity } = params

        if (quantity < 1) {
            throw new Error("INVALID_QUANTITY")
        }

        const cartItem = await prisma.cartItem.findFirst({
            where: {
                id: itemId,
                cart: { userId },
            },
        })

        if (!cartItem) {
            throw new Error("CART_ITEM_NOT_FOUND")
        }

        const available = await availableQuantity(prisma, cartItem.productId)
        if (quantity > available) {
            throw new Error("INSUFFICIENT_STOCK")
        }

        const updatedItem = await prisma.cartItem.update({
            where: { id: itemId },
            data: { quantity },
        })

        return { success: true, cartItem: updatedItem }
    }

    static async removeItem(params: {
        userId: string
        itemId: string
    }): Promise<{ success: boolean }> {
        const { userId, itemId } = params

        const cartItem = await prisma.cartItem.findFirst({
            where: {
                id: itemId,
                cart: { userId },
            },
        })

        if (!cartItem) {
            throw new Error("CART_ITEM_NOT_FOUND")
        }

        await prisma.cartItem.delete({
            where: { id: itemId },
        })

        return { success: true }
    }

    static async clearCart(userId: string): Promise<{ success: boolean }> {
        const cart = await prisma.cart.findUnique({
            where: { userId },
        })

        if (!cart) {
            return { success: true }
        }

        await prisma.cartItem.deleteMany({
            where: { cartId: cart.id },
        })

        return { success: true }
    }

    static async getCartItemCount(userId: string): Promise<number> {
        const cart = await prisma.cart.findUnique({
            where: { userId },
            include: {
                items: true,
            },
        })

        if (!cart) {
            return 0
        }

        return cart.items.reduce((sum, item) => sum + item.quantity, 0)
    }

    static async calculateCartTotal(userId: string): Promise<{
        subtotal: SerializedMoney
        discount: SerializedMoney
        total: SerializedMoney
    }> {
        const cart = await prisma.cart.findUnique({
            where: { userId },
            include: {
                items: {
                    include: {
                        product: true,
                    },
                },
            },
        })

        if (!cart) {
            return { subtotal: "0.00", discount: "0.00", total: "0.00" }
        }

        const discounts = await activeDiscounts()
        const priced = cart.items.map((item) => ({
            quantity: item.quantity,
            ...resolveEffectivePrice(item.product.price, item.product, discounts),
        }))

        const baseSubtotal = sumMoney(priced.map((line) => multiplyMoney(line.base, line.quantity)))
        const total = sumMoney(priced.map((line) => multiplyMoney(line.effective, line.quantity)))

        return {
            subtotal: serializeMoney(baseSubtotal),
            discount: serializeMoney(subtractMoney(baseSubtotal, total)),
            total: serializeMoney(total),
        }
    }
}