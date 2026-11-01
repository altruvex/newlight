"use server"

import { revalidatePath } from "next/cache"
import { MediaService, MediaError } from "@/lib/services/media-service"
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import type { ActionResult } from "@/app/action/catalog-actions"

function describe(error: unknown): string {
    if (error instanceof UnauthenticatedError) return "You are signed out. Sign in again."
    if (error instanceof ForbiddenError) return "Your role does not allow this."
    if (error instanceof MediaError) return error.message
    logger.error({ err: error }, "media action failed")
    return "Something went wrong. Try again, and tell an administrator if it keeps happening."
}

export async function uploadProductImage(formData: FormData): Promise<ActionResult> {
    try {
        const productId = String(formData.get("productId") ?? "")
        const colorId = String(formData.get("colorId") ?? "") || null
        const file = formData.get("file")

        if (!productId) return { ok: false, error: "No product." }
        if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image first." }

        await MediaService.upload(productId, file, colorId)
        revalidatePath(`/admin/products/${productId}`)
        return { ok: true, message: "Uploaded." }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function reorderProductImages(productId: string, orderedIds: string[]): Promise<ActionResult> {
    try {
        await MediaService.reorder(productId, orderedIds)
        revalidatePath(`/admin/products/${productId}`)
        revalidatePath("/admin/products")
        return { ok: true, message: "Order saved. The first image is what listings show." }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function setImageColor(productId: string, imageId: string, colorId: string | null): Promise<ActionResult> {
    try {
        await MediaService.setColor(imageId, colorId)
        revalidatePath(`/admin/products/${productId}`)
        return { ok: true, message: colorId ? "Linked to that colour." : "Colour link removed." }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function setImageAlt(
    productId: string,
    imageId: string,
    altEn: string | null,
    altAr: string | null
): Promise<ActionResult> {
    try {
        await MediaService.setAlt(imageId, altEn, altAr)
        revalidatePath(`/admin/products/${productId}`)
        return { ok: true, message: "Alt text saved." }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function deleteProductImage(productId: string, imageId: string): Promise<ActionResult> {
    try {
        const result = await MediaService.remove(imageId)
        revalidatePath(`/admin/products/${productId}`)
        revalidatePath("/admin/products")
        return {
            ok: true,
            message: result.assetKept
                ? "Removed from this product. The file stays — another product uses it."
                : "Removed, and the file was deleted from Cloudinary.",
        }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}
