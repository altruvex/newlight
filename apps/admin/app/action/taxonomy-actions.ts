"use server"

import { revalidatePath } from "next/cache"
import { TaxonomyService, TaxonomyError, type TaxonomyInput } from "@/lib/services/taxonomy-service"
import { MediaError } from "@/lib/cloudinary"
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import type { ActionResult } from "@/app/action/catalog-actions"

function describe(error: unknown): string {
    if (error instanceof UnauthenticatedError) return "You are signed out. Sign in again."
    if (error instanceof ForbiddenError) return "Your role does not allow this."
    if (error instanceof TaxonomyError) return error.message
    if (error instanceof MediaError) return error.message
    logger.error({ err: error }, "taxonomy action failed")
    return "Something went wrong. Try again, and tell an administrator if it keeps happening."
}

type Result = ActionResult & { id?: string }

async function run(fn: () => Promise<string | { id: string; message: string }>): Promise<Result> {
    try {
        const outcome = await fn()
        revalidatePath("/admin/taxonomy")
        return typeof outcome === "string"
            ? { ok: true, message: outcome }
            : { ok: true, message: outcome.message, id: outcome.id }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function createCategory(input: TaxonomyInput): Promise<Result> {
    return run(async () => {
        const created = await TaxonomyService.createCategory(input)
        return { id: created.id, message: "Category created." }
    })
}

export async function updateCategory(id: string, input: TaxonomyInput): Promise<Result> {
    return run(async () => {
        const { renamed } = await TaxonomyService.updateCategory(id, input)
        return renamed.length > 0
            ? `Saved. ${renamed.length} URL(s) changed — the old ones redirect.`
            : "Saved."
    })
}

export async function createSubCategory(categoryId: string, input: TaxonomyInput): Promise<Result> {
    return run(async () => {
        const created = await TaxonomyService.createSubCategory(categoryId, input)
        return { id: created.id, message: "Sub-category created." }
    })
}

export async function updateSubCategory(id: string, categoryId: string, input: TaxonomyInput): Promise<Result> {
    return run(async () => {
        const { renamed } = await TaxonomyService.updateSubCategory(id, categoryId, input)
        return renamed.length > 0
            ? `Saved. ${renamed.length} URL(s) changed — the old ones redirect.`
            : "Saved."
    })
}

export async function archiveCategory(id: string): Promise<Result> {
    return run(async () => {
        await TaxonomyService.archiveCategory(id)
        return "Archived. It can be restored."
    })
}

export async function archiveSubCategory(id: string): Promise<Result> {
    return run(async () => {
        await TaxonomyService.archiveSubCategory(id)
        return "Archived. It can be restored."
    })
}

export async function restoreTaxonomy(kind: "category" | "subCategory", id: string): Promise<Result> {
    return run(async () => {
        await TaxonomyService.restore(kind, id)
        return "Restored. It is still hidden until you activate it."
    })
}

type ImageResult = ActionResult & { url?: string }

function editPath(kind: "category" | "subCategory", id: string): string {
    return kind === "category" ? `/admin/taxonomy/category/${id}` : `/admin/taxonomy/sub-category/${id}`
}

async function uploadTaxonomyImage(kind: "category" | "subCategory", id: string, formData: FormData): Promise<ImageResult> {
    try {
        const file = formData.get("file")
        if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image first." }

        const url = await TaxonomyService.uploadImage(kind, id, file)
        revalidatePath(editPath(kind, id))
        revalidatePath("/admin/taxonomy")
        return { ok: true, message: "Uploaded.", url }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

async function removeTaxonomyImage(kind: "category" | "subCategory", id: string): Promise<ActionResult> {
    try {
        await TaxonomyService.removeImage(kind, id)
        revalidatePath(editPath(kind, id))
        revalidatePath("/admin/taxonomy")
        return { ok: true, message: "Image removed." }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function uploadCategoryImage(categoryId: string, formData: FormData): Promise<ImageResult> {
    return uploadTaxonomyImage("category", categoryId, formData)
}

export async function uploadSubCategoryImage(subCategoryId: string, formData: FormData): Promise<ImageResult> {
    return uploadTaxonomyImage("subCategory", subCategoryId, formData)
}

export async function removeCategoryImage(categoryId: string): Promise<ActionResult> {
    return removeTaxonomyImage("category", categoryId)
}

export async function removeSubCategoryImage(subCategoryId: string): Promise<ActionResult> {
    return removeTaxonomyImage("subCategory", subCategoryId)
}
