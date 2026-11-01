import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { prisma, resolveLocale, type Locale } from "@repo/database"
import { sendOrQueue } from "@repo/mail/outbox"

const VERIFICATION_TTL_MINUTES = 60

function requiredEnv(name: string): string {
    const value = process.env[name]
    if (!value) {
        throw new Error(`${name} is not set. Authentication cannot start without it.`)
    }
    return value
}

function localeOf(user: { preferredLanguage?: string | null }): Locale {
    return resolveLocale(user.preferredLanguage)
}

export const auth = betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    // The custom domain plus every *.vercel.app address this deployment answers on; see the
    // same helper in apps/admin/lib/auth.ts for why.
    trustedOrigins: [
        process.env.BETTER_AUTH_URL,
        process.env.NEXT_PUBLIC_APP_URL,
        ...[process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL].map((host) =>
            host ? `https://${host}` : undefined
        ),
        ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim()),
    ].filter((value): value is string => Boolean(value)),

    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        minPasswordLength: 10,
        sendResetPassword: async ({ user, url }) => {
            await sendOrQueue(prisma, {
                template: "password-reset",
                to: user.email,
                locale: localeOf(user as { preferredLanguage?: string | null }),
                payload: { name: user.name, resetUrl: url, expiresInMinutes: VERIFICATION_TTL_MINUTES },
            })
        },
    },

    emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => {
            await sendOrQueue(prisma, {
                template: "email-verification",
                to: user.email,
                locale: localeOf(user as { preferredLanguage?: string | null }),
                payload: { name: user.name, verifyUrl: url, expiresInMinutes: VERIFICATION_TTL_MINUTES },
            })
        },
    },

    user: {
        additionalFields: {
            role: { type: "string", required: false, defaultValue: "CUSTOMER", input: false },
            phoneNumber: { type: "string", required: false, input: true },
            preferredLanguage: { type: "string", required: false, defaultValue: "ar", input: true },
            preferredCurrency: { type: "string", required: false, defaultValue: "EGP", input: false },
        },
    },

    session: {
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
        // A signed copy of the session in a cookie, so getSession() skips the database for 5
        // minutes after each check. sign-out deletes this cookie with the session one. The cost:
        // a session revoked elsewhere, or a role change, can take up to 5 minutes to show here.
        cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    plugins: [nextCookies()],
})

export type Identity = {
    id: string
    email: string
    name: string
    role: string
    emailVerified: boolean
    preferredLanguage: Locale
}

export async function getIdentity(headers: Headers): Promise<Identity | null> {
    const session = await auth.api.getSession({ headers })
    if (!session?.user) return null
    const user = session.user as typeof session.user & {
        role?: string | null
        preferredLanguage?: string | null
    }
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role ?? "CUSTOMER",
        emailVerified: user.emailVerified,
        preferredLanguage: resolveLocale(user.preferredLanguage),
    }
}

export class UnauthenticatedError extends Error {
    constructor() {
        super("authentication required")
        this.name = "UnauthenticatedError"
    }
}

export async function requireIdentity(headers: Headers): Promise<Identity> {
    const identity = await getIdentity(headers)
    if (!identity) throw new UnauthenticatedError()
    return identity
}

export async function currentIdentity(): Promise<Identity | null> {
    const { headers } = await import("next/headers")
    return getIdentity(await headers())
}

export async function currentUserId(): Promise<string | null> {
    return (await currentIdentity())?.id ?? null
}
