"use server"

import type { ProductColorTemp } from "@repo/database"
import { CartService } from "@/lib/services/cart-service"
import { UserService } from "@/lib/services/user-service"
import { currentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { addToCartSchema } from "@/lib/validation/schema"

export async function addToCart(
  productId: string,
  quantity = 1,
  selectedColorTemp?: ProductColorTemp,
  selectedColorKey?: string
) {
  try {
    const userId = await currentUserId()

    if (!userId) {
      return {
        success: false,
        error: "Authentication required",
      }
    }

    const parsed = addToCartSchema.safeParse({ productId, quantity, selectedColorTemp, selectedColorKey })
    if (!parsed.success) {
      return {
        success: false,
        error: "INVALID_QUANTITY",
      }
    }

    const result = await CartService.addToCart({
      userId,
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      selectedColorTemp,
      selectedColorKey,
    })

    revalidatePath("/cart")

    return {
      success: true,
      message: "Product added to cart",
      cartItem: result.cartItem,
    }

  } catch (error) {
    console.error("Failed to add item to cart:", error)

    if (error instanceof Error) {
      if (error.message === "PRODUCT_NOT_FOUND") {
        return {
          success: false,
          error: "Product not found",
        }
      }

      if (error.message === "INSUFFICIENT_STOCK") {
        return {
          success: false,
          error: "INSUFFICIENT_STOCK",
        }
      }
    }

    return {
      success: false,
      error: "Failed to add product to cart",
    }
  }
}

export async function updateCartItemQuantity(itemId: string, quantity: number) {
  try {
    const userId = await currentUserId()

    if (!userId) {
      return {
        success: false,
        error: "Authentication required",
      }
    }

    const result = await CartService.updateItemQuantity({
      userId,
      itemId,
      quantity,
    })

    revalidatePath("/cart")

    return {
      success: true,
      message: "Cart updated",
      cartItem: result.cartItem,
    }

  } catch (error) {
    console.error("Failed to update cart item:", error)

    if (error instanceof Error) {
      if (error.message === "CART_ITEM_NOT_FOUND") {
        return {
          success: false,
          error: "Cart item not found",
        }
      }

      if (error.message === "INVALID_QUANTITY") {
        return {
          success: false,
          error: "Invalid quantity",
        }
      }

      if (error.message === "INSUFFICIENT_STOCK") {
        return {
          success: false,
          error: "INSUFFICIENT_STOCK",
        }
      }
    }

    return {
      success: false,
      error: "Failed to update cart",
    }
  }
}

export async function removeFromCart(itemId: string) {
  try {
    const userId = await currentUserId()

    if (!userId) {
      return {
        success: false,
        error: "Authentication required",
      }
    }

    await CartService.removeItem({
      userId,
      itemId,
    })

    revalidatePath("/cart")

    return {
      success: true,
      message: "Item removed from cart",
    }

  } catch (error) {
    console.error("Failed to remove item from cart:", error)

    if (error instanceof Error && error.message === "CART_ITEM_NOT_FOUND") {
      return {
        success: false,
        error: "Cart item not found",
      }
    }

    return {
      success: false,
      error: "Failed to remove item",
    }
  }
}

export async function clearCart() {
  try {
    const userId = await currentUserId()

    if (!userId) {
      return {
        success: false,
        error: "Authentication required",
      }
    }

    await CartService.clearCart(userId)

    revalidatePath("/cart")

    return {
      success: true,
      message: "Cart cleared",
    }

  } catch (error) {
    console.error("Failed to clear cart:", error)

    return {
      success: false,
      error: "Failed to clear cart",
    }
  }
}

export async function getCartItemCount() {
  try {
    const userId = await currentUserId()

    if (!userId) {
      return 0
    }

    const count = await CartService.getCartItemCount(userId)
    return count

  } catch (error) {
    console.error("Failed to get cart count:", error)
    return 0
  }
}

export async function getCartTotal() {
  try {
    const userId = await currentUserId()

    if (!userId) {
      return { subtotal: 0, discount: 0, total: 0 }
    }

    const totals = await CartService.calculateCartTotal(userId)
    return totals

  } catch (error) {
    console.error("Failed to get cart total:", error)
    return { subtotal: 0, discount: 0, total: 0 }
  }
}