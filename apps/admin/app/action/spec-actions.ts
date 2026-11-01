"use server"

import { revalidatePath } from "next/cache"
import {
    SpecDefinitionService,
    SpecDefinitionError,
    type SpecDefinitionInput,
} from "@/lib/services/spec-definition-service"
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import type { ActionResult } from "@/app/action/catalog-actions"

async function run(fn: () => Promise<string>): Promise<ActionResult> {
    try {
        const message = await fn()
        revalidatePath("/admin/specs")
        return { ok: true, message }
    } catch (error) {
        if (error instanceof UnauthenticatedError) return { ok: false, error: "You are signed out. Sign in again." }
        if (error instanceof ForbiddenError) return { ok: false, error: "Your role does not allow this." }
        if (error instanceof SpecDefinitionError) return { ok: false, error: error.message }
        logger.error({ err: error }, "spec action failed")
        return { ok: false, error: "Something went wrong. Try again, and tell an administrator if it keeps happening." }
    }
}

export async function createSpec(input: SpecDefinitionInput): Promise<ActionResult> {
    return run(async () => {
        await SpecDefinitionService.create(input)
        return `${input.labelEn} created.`
    })
}

export async function updateSpec(key: string, input: Omit<SpecDefinitionInput, "key">): Promise<ActionResult> {
    return run(async () => {
        await SpecDefinitionService.update(key, input)
        return "Saved."
    })
}

export async function deleteSpec(key: string): Promise<ActionResult> {
    return run(async () => {
        await SpecDefinitionService.remove(key)
        return "Deleted."
    })
}

export async function setSubCategorySpecs(
    subCategoryId: string,
    specs: Array<{ specKey: string; required: boolean; order: number }>
): Promise<ActionResult> {
    return run(async () => {
        await SpecDefinitionService.setForSubCategory(subCategoryId, specs)
        revalidatePath(`/admin/taxonomy/sub-category/${subCategoryId}`)
        return `${specs.length} specification(s) assigned.`
    })
}
