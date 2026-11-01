"use server"

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { AuditService } from "@/lib/services/audit-service"

export type AuditDiffResult = { ok: true; diff: unknown } | { ok: false; error: string }

export async function getAuditDiff(id: string): Promise<AuditDiffResult> {
    try {
        if (typeof id !== "string" || id.length === 0 || id.length > 64) return { ok: false, error: "Unknown entry." }
        return { ok: true, diff: await AuditService.diffById(id) }
    } catch (error) {
        if (error instanceof UnauthenticatedError) return { ok: false, error: "You are signed out. Sign in again." }
        if (error instanceof ForbiddenError) return { ok: false, error: "Your role does not allow this." }
        logger.error({ err: error }, "audit diff load failed")
        return { ok: false, error: "Could not load the details. Try again." }
    }
}
