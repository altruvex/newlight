import { Prisma } from "@repo/database"

// Postgres aborts one of two SERIALIZABLE transactions that would not serialise with
// SQLSTATE 40001; Prisma surfaces it as P2034 ("write conflict or deadlock"), and the pg driver
// adapter sometimes leaves the SQLSTATE only in `meta`. Either way the right response is to run
// the whole transaction again, which is what the caller does.
export function isSerializationFailure(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2034") return true
        const meta = (error.meta ?? {}) as Record<string, unknown>
        const driver = meta.driverAdapterError as { cause?: { code?: unknown } } | undefined
        return meta.code === "40001" || driver?.cause?.code === "40001"
    }
    if (error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Error) {
        return /40001|could not serialize access|deadlock detected/i.test(error.message)
    }
    return false
}

export function isUniqueViolationOn(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false
    const target = (error.meta as { target?: unknown } | undefined)?.target
    if (Array.isArray(target)) return target.some((entry) => String(entry).includes(field))
    return typeof target === "string" ? target.includes(field) : false
}

export interface RetryOptions {
    attempts?: number
    /** Upper bound of the random pause before a retry, in milliseconds; grows with the attempt. */
    jitterMs?: number
    onRetry?: (attempt: number, error: unknown) => void
}

export async function withSerializableRetry<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const attempts = Math.max(1, options.attempts ?? 3)
    const jitterMs = options.jitterMs ?? 60

    for (let attempt = 1; ; attempt++) {
        try {
            return await run()
        } catch (error) {
            if (attempt >= attempts || !isSerializationFailure(error)) throw error
            options.onRetry?.(attempt, error)
            await new Promise((resolve) => setTimeout(resolve, Math.round(Math.random() * jitterMs * attempt)))
        }
    }
}
