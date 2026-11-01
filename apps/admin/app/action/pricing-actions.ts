"use server"

import { revalidatePath } from "next/cache"
import {
    PricingService,
    PricingError,
    type PricingFormula,
    type PricingPreview,
    type PricingScope,
} from "@/lib/services/pricing-service"
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"

export type PreviewResult = { ok: true; preview: PricingPreview } | { ok: false; error: string }
export type ApplyResult = { ok: true; message: string } | { ok: false; error: string }

function describe(error: unknown): string {
    if (error instanceof UnauthenticatedError) return "You are signed out. Sign in again."
    if (error instanceof ForbiddenError) return "Your role does not allow this."
    if (error instanceof PricingError) return error.message
    logger.error({ err: error }, "pricing action failed")
    return "Something went wrong. Try again, and tell an administrator if it keeps happening."
}

export async function previewPricing(scope: PricingScope, formula: PricingFormula): Promise<PreviewResult> {
    try {
        return { ok: true, preview: await PricingService.preview(scope, formula) }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function applyPricing(
    scope: PricingScope,
    formula: PricingFormula,
    token: string
): Promise<ApplyResult> {
    try {
        const result = await PricingService.apply(scope, formula, token)
        revalidatePath("/admin/products")
        return { ok: true, message: `${result.count} price${result.count === 1 ? "" : "s"} changed.` }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}
