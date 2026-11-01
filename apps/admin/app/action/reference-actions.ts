"use server"

import { revalidatePath } from "next/cache"
import { ColorService, FamilyService, LocationService, ReferenceError_ } from "@/lib/services/reference-service"
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import type { ActionResult } from "@/app/action/catalog-actions"

function describe(error: unknown): string {
    if (error instanceof UnauthenticatedError) return "You are signed out. Sign in again."
    if (error instanceof ForbiddenError) return "Your role does not allow this."
    if (error instanceof ReferenceError_) return error.message
    logger.error({ err: error }, "reference action failed")
    return "Something went wrong. Try again, and tell an administrator if it keeps happening."
}

async function run(fn: () => Promise<string>): Promise<ActionResult> {
    try {
        const message = await fn()
        revalidatePath("/admin/reference")
        return { ok: true, message }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function createFamily(input: {
    subCategoryId: string
    slug: string
    variantType: string | null
    nameEn: string
    nameAr: string
    order: number
}): Promise<ActionResult> {
    return run(async () => {
        await FamilyService.create(input)
        return `${input.slug} created.`
    })
}

export async function updateFamily(
    id: string,
    input: { variantType: string | null; nameEn: string; nameAr: string; order: number }
): Promise<ActionResult> {
    return run(async () => {
        await FamilyService.update(id, input)
        return "Saved."
    })
}

export async function archiveFamily(id: string): Promise<ActionResult> {
    return run(async () => {
        const { scattered } = await FamilyService.archive(id)
        revalidatePath("/admin/products")
        return scattered > 0
            ? `Archived. ${scattered} product(s) are now standalone.`
            : "Archived."
    })
}

export async function setProductFamily(
    productId: string,
    familyId: string | null,
    variantValue: string | null
): Promise<ActionResult> {
    return run(async () => {
        await FamilyService.setProductFamily(productId, familyId, variantValue)
        revalidatePath(`/admin/products/${productId}`)
        return familyId ? "Moved into that family." : "Now a standalone product."
    })
}

export async function createColor(input: {
    key: string
    hex: string
    nameEn: string
    nameAr: string
    order: number
}): Promise<ActionResult> {
    return run(async () => {
        await ColorService.create(input)
        return `${input.nameEn} added.`
    })
}

export async function updateColor(
    id: string,
    input: { hex: string; nameEn: string; nameAr: string; order: number; isActive: boolean }
): Promise<ActionResult> {
    return run(async () => {
        await ColorService.update(id, input)
        return "Saved."
    })
}

export async function deleteColor(id: string): Promise<ActionResult> {
    return run(async () => {
        await ColorService.remove(id)
        return "Deleted."
    })
}

export async function setProductColors(productId: string, colorIds: string[]): Promise<ActionResult> {
    return run(async () => {
        await ColorService.setForProduct(productId, colorIds)
        revalidatePath(`/admin/products/${productId}`)
        return `${colorIds.length} colour(s) offered.`
    })
}

export async function createLocation(name: string): Promise<ActionResult> {
    return run(async () => {
        await LocationService.create(name)
        return `${name} added.`
    })
}

export async function renameLocation(id: string, name: string): Promise<ActionResult> {
    return run(async () => {
        await LocationService.rename(id, name)
        return "Renamed."
    })
}

export async function setDefaultLocation(id: string): Promise<ActionResult> {
    return run(async () => {
        await LocationService.setDefault(id)
        return "This is now where stock moves by default."
    })
}

export async function deleteLocation(id: string): Promise<ActionResult> {
    return run(async () => {
        await LocationService.remove(id)
        return "Deleted."
    })
}
