"use server"

import { revalidatePath } from "next/cache"
import type { Locale } from "@repo/database"
import { CatalogService, CatalogError } from "@/lib/services/catalog-service"
import { TranslationService, type TranslationFields } from "@/lib/services/translation-service"
import { InventoryService, InventoryError } from "@/lib/services/inventory-service"
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"

const GENERIC_ERROR = "Something went wrong. Try again, and tell an administrator if it keeps happening."

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
    try {
        const message = await fn()
        return { ok: true, message: message ?? undefined }
    } catch (error) {
        if (error instanceof UnauthenticatedError) return { ok: false, error: "You are signed out. Sign in again." }
        if (error instanceof ForbiddenError) return { ok: false, error: "Your role does not allow this." }
        if (error instanceof CatalogError || error instanceof InventoryError) return { ok: false, error: error.message }
        logger.error({ err: error }, "catalog action failed")
        return { ok: false, error: GENERIC_ERROR }
    }
}

export async function saveTranslations(
    productId: string,
    input: Record<Locale, TranslationFields>
): Promise<ActionResult> {
    return run(async () => {
        await TranslationService.saveProduct(productId, input)
        revalidatePath(`/admin/products/${productId}`)
        return "Both languages saved."
    })
}

export async function renameProduct(productId: string, slug: string): Promise<ActionResult> {
    return run(async () => {
        const result = await CatalogService.rename(productId, slug)
        revalidatePath(`/admin/products/${productId}`)
        return result.changed ? `Slug is now ${result.slug}; the old URL redirects.` : "Slug unchanged."
    })
}

export async function softDeleteProduct(productId: string): Promise<ActionResult> {
    return run(async () => {
        await CatalogService.softDelete(productId)
        revalidatePath("/admin/products")
        revalidatePath(`/admin/products/${productId}`)
        return "Archived. Orders that mention it still read correctly, and it can be restored."
    })
}

export async function restoreProduct(productId: string): Promise<ActionResult> {
    return run(async () => {
        await CatalogService.restore(productId)
        revalidatePath("/admin/products")
        revalidatePath(`/admin/products/${productId}`)
        return "Restored. It is still inactive until you activate it."
    })
}

export async function setProductActive(productId: string, isActive: boolean): Promise<ActionResult> {
    return run(async () => {
        await CatalogService.setActive(productId, isActive)
        revalidatePath("/admin/products")
        revalidatePath(`/admin/products/${productId}`)
        return isActive ? "Visible on the storefront." : "Hidden from the storefront."
    })
}

export async function hardDeleteProduct(productId: string): Promise<ActionResult> {
    return run(async () => {
        await CatalogService.hardDelete(productId)
        revalidatePath("/admin/products")
        return "Permanently deleted."
    })
}

export async function adjustStock(productId: string, quantity: number, reason: string): Promise<ActionResult> {
    return run(async () => {
        if (!Number.isInteger(quantity) || quantity === 0) throw new CatalogError("Enter a whole number that is not zero.")
        await InventoryService.adjust({ productId, quantity, reason })
        revalidatePath(`/admin/products/${productId}`)
        return `Ledger entry written: ${quantity > 0 ? "+" : ""}${quantity}.`
    })
}

export async function recordDamage(productId: string, quantity: number, reason: string): Promise<ActionResult> {
    return run(async () => {
        if (!Number.isInteger(quantity) || quantity <= 0) throw new CatalogError("Enter how many units were lost.")
        await InventoryService.recordDamage({ productId, quantity, reason })
        revalidatePath(`/admin/products/${productId}`)
        return `Damage recorded: −${quantity}.`
    })
}

export async function receiveStock(
    productId: string,
    quantity: number,
    unitCost: string | null,
    reason: string
): Promise<ActionResult> {
    return run(async () => {
        await InventoryService.receivePurchase({
            productId,
            quantity,
            unitCost: unitCost && unitCost.trim() !== "" ? unitCost.trim() : null,
            reason: reason.trim() || "purchase receipt",
        })
        revalidatePath(`/admin/products/${productId}`)
        return unitCost ? `Received ${quantity}; average cost updated.` : `Received ${quantity}; no cost recorded.`
    })
}

export async function bulkReceiveStock(
    rows: Array<{ productId: string; quantity: number; unitCost: string | null }>
): Promise<ActionResult> {
    return run(async () => {
        const failures: string[] = []
        let received = 0

        for (const row of rows) {
            try {
                await InventoryService.receivePurchase({
                    productId: row.productId,
                    quantity: row.quantity,
                    unitCost: row.unitCost && row.unitCost.trim() !== "" ? row.unitCost.trim() : null,
                    reason: "bulk receipt",
                })
                received += 1
            } catch (error) {
                // Only a domain error has a message meant for the admin; anything else is logged.
                if (!(error instanceof InventoryError)) logger.error({ err: error, productId: row.productId }, "bulk receipt row failed")
                failures.push(`${row.productId}: ${error instanceof InventoryError ? error.message : "failed"}`)
            }
        }

        if (failures.length > 0) {
            throw new CatalogError(`${received} received, ${failures.length} failed — ${failures.slice(0, 3).join("; ")}`)
        }
        return `${received} receipt(s) recorded.`
    })
}

export async function completeOpeningStocktake(): Promise<ActionResult> {
    return run(async () => {
        await InventoryService.completeOpeningStocktake()
        revalidatePath("/admin/inventory")
        return "Opening count closed. Valuation and margin reports will now produce numbers."
    })
}

export async function setProductPrice(productId: string, amount: string): Promise<ActionResult> {
    return run(async () => {
        const { PricingService } = await import("@/lib/services/pricing-service")
        const result = await PricingService.setPrice(productId, amount)
        revalidatePath(`/admin/products/${productId}`)
        revalidatePath("/admin/products")
        return result.changed ? `Price is now ${result.price}.` : "Price unchanged."
    })
}

export async function saveProductSpecs(
    productId: string,
    specs: Array<{ key: string; valueEn: string | null; valueAr: string | null }>
): Promise<ActionResult> {
    return run(async () => {
        const { SpecService } = await import("@/lib/services/spec-service")
        const result = await SpecService.save(productId, specs)
        revalidatePath(`/admin/products/${productId}`)
        return result.changed === 0 ? "No changes." : `${result.changed} specification(s) saved.`
    })
}

export async function createProductAction(
    input: import("@/lib/services/catalog-service").NewProductInput
): Promise<ActionResult & { productId?: string }> {
    try {
        const { createProduct } = await import("@/lib/services/catalog-service")
        const product = await createProduct(input)
        revalidatePath("/admin/products")
        return { ok: true, message: `${product.productId} created. Add a photo, then activate it.`, productId: product.id }
    } catch (error) {
        const { CatalogCreationError } = await import("@/lib/services/catalog-service")
        if (error instanceof UnauthenticatedError) return { ok: false, error: "You are signed out. Sign in again." }
        if (error instanceof ForbiddenError) return { ok: false, error: "Your role does not allow this." }
        if (error instanceof CatalogCreationError) return { ok: false, error: error.message }
        logger.error({ err: error }, "product creation failed")
        return { ok: false, error: GENERIC_ERROR }
    }
}
