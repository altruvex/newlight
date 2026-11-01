import { cache } from "react"
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { consume, isAdminRole, prisma, type AdminRole } from "@repo/database"

function requiredEnv(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`${name} is not set. Authentication cannot start without it.`)
    return value
}

// Every origin this deployment can be reached on. Better Auth refuses a sign-in whose Origin
// header is not the baseURL or one of these, so the *.vercel.app addresses (production alias,
// branch alias, and the per-deployment URL) must be listed alongside the custom domain, or a
// browser on any of them gets INVALID_ORIGIN before the password is even looked at.
function deploymentOrigins(): string[] {
    const explicit = [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_ADMIN_URL]
    const vercel = [
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
        process.env.VERCEL_BRANCH_URL,
        process.env.VERCEL_URL,
    ].map((host) => (host ? `https://${host}` : undefined))
    const extra = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim())
    return [...new Set([...explicit, ...vercel, ...extra].filter((value): value is string => Boolean(value)))]
}

export const auth = betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    baseURL:
        process.env.BETTER_AUTH_URL ??
        process.env.NEXT_PUBLIC_ADMIN_URL ??
        (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
    trustedOrigins: deploymentOrigins(),

    emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        requireEmailVerification: false,
        minPasswordLength: 12,
    },

    user: {
        additionalFields: {
            role: { type: "string", required: false, defaultValue: "ADMIN", input: false },
        },
    },

    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },

    // Better Auth's own "database" storage wants a rateLimit table with a numeric lastRequest
    // column, which the schema does not have. The shared rate_limits table (key/count/windowStart,
    // already used by the storefront's contact form) is driven through the same atomic consume()
    // instead — one row per IP and path, every instance agrees, no migration.
    rateLimit: {
        enabled: process.env.NODE_ENV === "production",
        window: 60,
        max: 60,
        customRules: {
            "/sign-in/email": { window: 60, max: 5 },
        },
        customStorage: {
            async consume(key, rule) {
                const result = await consume(prisma, `auth:${key}`, rule.max, rule.window)
                return { allowed: result.allowed, retryAfter: result.allowed ? null : rule.window }
            },
        },
    },

    plugins: [nextCookies()],
})

export { ADMIN_ROLES, type AdminRole } from "@repo/database"

export interface AdminIdentity {
    id: string
    email: string
    name: string
    role: AdminRole
    image: string | null
}

export class UnauthenticatedError extends Error {
    constructor() {
        super("authentication required")
        this.name = "UnauthenticatedError"
    }
}

export class ForbiddenError extends Error {
    constructor(role: string) {
        super(`role ${role} may not access the admin panel`)
        this.name = "ForbiddenError"
    }
}

type Session = Awaited<ReturnType<typeof auth.api.getSession>>

// Either an identity, or the reason there is none — so one session read answers both the
// nullable (currentAdmin) and the throwing (requireAdmin) callers.
type Resolution = { identity: AdminIdentity } | { identity: null; reason: "unauthenticated" | "forbidden"; role: string }

function resolve(session: Session): Resolution {
    if (!session?.user) return { identity: null, reason: "unauthenticated", role: "" }
    const user = session.user as typeof session.user & { role?: string | null }
    const role = user.role ?? "CUSTOMER"
    if (!isAdminRole(role)) return { identity: null, reason: "forbidden", role }
    return { identity: { id: user.id, email: user.email, name: user.name, role, image: user.image ?? null } }
}

function unwrap(resolution: Resolution): AdminIdentity {
    if (resolution.identity) return resolution.identity
    if (resolution.reason === "forbidden") throw new ForbiddenError(resolution.role)
    throw new UnauthenticatedError()
}

// A page render calls requireCurrentAdmin from the layout, the page and every service it touches.
// React's cache() dedupes that to one session lookup per request; outside a request scope it is
// a plain call. Session cookieCache stays off on purpose — a revoked admin must be out on the
// next request, not after the cache expires.
const currentResolution = cache(async (): Promise<Resolution> => {
    const { headers } = await import("next/headers")
    return resolve(await auth.api.getSession({ headers: await headers() }))
})

export async function getIdentity(headers: Headers): Promise<AdminIdentity | null> {
    return resolve(await auth.api.getSession({ headers })).identity
}

export async function requireAdmin(headers: Headers): Promise<AdminIdentity> {
    return unwrap(resolve(await auth.api.getSession({ headers })))
}

export async function requireSuperAdmin(headers: Headers): Promise<AdminIdentity> {
    const identity = await requireAdmin(headers)
    if (identity.role !== "SUPER_ADMIN") throw new ForbiddenError(identity.role)
    return identity
}

export async function requireCurrentSuperAdmin(): Promise<AdminIdentity> {
    const identity = await requireCurrentAdmin()
    if (identity.role !== "SUPER_ADMIN") throw new ForbiddenError(identity.role)
    return identity
}

export async function currentAdmin(): Promise<AdminIdentity | null> {
    return (await currentResolution()).identity
}

export async function requireCurrentAdmin(): Promise<AdminIdentity> {
    return unwrap(await currentResolution())
}

export async function currentAdminId(): Promise<string | null> {
    return (await currentAdmin())?.id ?? null
}
