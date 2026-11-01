"use server"

import { revalidatePath } from "next/cache"
import { ADMIN_ROLES, type AdminRole } from "@repo/database"
import { z } from "zod"
import { AdminUserService, AdminUserError } from "@/lib/services/admin-user-service"
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth"
import { logger } from "@/lib/logger"
import type { ActionResult } from "@/app/action/catalog-actions"

const roleSchema = z.enum([...ADMIN_ROLES, "CUSTOMER"])

function describe(error: unknown): string {
    if (error instanceof UnauthenticatedError) return "You are signed out. Sign in again."
    if (error instanceof ForbiddenError) return "Only a SUPER_ADMIN can manage administrators."
    if (error instanceof AdminUserError) return error.message
    logger.error({ err: error }, "admin user action failed")
    return "Something went wrong. Try again, and tell an administrator if it keeps happening."
}

export async function createAdmin(input: {
    email: string
    name: string
    role: AdminRole
}): Promise<ActionResult & { password?: string; email?: string }> {
    try {
        const result = await AdminUserService.create(input)
        revalidatePath("/admin/team")
        return { ok: true, message: "Administrator created.", password: result.password, email: result.email }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function setAdminRole(userId: string, input: AdminRole | "CUSTOMER"): Promise<ActionResult> {
    try {
        const parsed = roleSchema.safeParse(input)
        if (!parsed.success) throw new AdminUserError("That is not a role.")
        const role = parsed.data
        const { demoted } = await AdminUserService.setRole(userId, role)
        revalidatePath("/admin/team")
        return {
            ok: true,
            message: demoted ? "Changed, and every session signed out." : `Now ${role}.`,
        }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}

export async function revokeAdminSessions(userId: string): Promise<ActionResult> {
    try {
        const { count } = await AdminUserService.revokeSessions(userId)
        revalidatePath("/admin/team")
        return { ok: true, message: `Signed out of ${count} session(s).` }
    } catch (error) {
        return { ok: false, error: describe(error) }
    }
}
