import type { Prisma, PrismaClient, NotificationPriority, NotificationType } from "@repo/database"
import { sendPush, isPushConfigured } from "./push"
import type { NotificationInput, PushPayload } from "./types"

export * from "./types"
export { isPushConfigured, publicVapidKey, vapidConfigFromEnv } from "./push"
export type { WebPushTarget, VapidConfig, PushAttempt } from "./push"
export { PUSH_TIMEOUT_MS } from "./push"

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const

const PUSH_STALE_AFTER_MINUTES = 60

const MAX_CONSECUTIVE_FAILURES = 10

export async function adminRecipients(prisma: PrismaClient): Promise<string[]> {
    const admins = await prisma.user.findMany({
        where: { role: { in: [...ADMIN_ROLES] } },
        select: { id: true },
    })
    return admins.map((admin) => admin.id)
}

export async function notifyRecipients(
    tx: Prisma.TransactionClient,
    recipients: readonly string[],
    input: NotificationInput
): Promise<{ created: number }> {
    if (recipients.length === 0) {
        console.warn(`[notifications] no recipients; ${input.type} notification not written.`)
        return { created: 0 }
    }

    await tx.notification.createMany({ data: recipients.map((userId) => rowFor(userId, input)) })
    return { created: recipients.length }
}

export async function notifyUser(
    tx: Prisma.TransactionClient,
    userId: string,
    input: NotificationInput
): Promise<{ created: number }> {
    await tx.notification.create({ data: rowFor(userId, input) })
    return { created: 1 }
}

function rowFor(userId: string, input: NotificationInput) {
    return {
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        actionUrl: input.actionUrl ?? null,
        priority: input.priority ?? ("NORMAL" as NotificationPriority),
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        expiresAt: input.expiresAt ?? null,
    }
}

export interface SaveSubscriptionInput {
    userId: string
    endpoint: string
    p256dh: string
    auth: string
    userAgent?: string | null
}

export async function saveSubscription(
    prisma: PrismaClient,
    input: SaveSubscriptionInput
): Promise<{ id: string }> {
    const row = await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
            userId: input.userId,
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent ?? null,
        },
        update: {
            userId: input.userId,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent ?? null,
            failureCount: 0,
        },
        select: { id: true },
    })
    return row
}

export async function removeSubscription(
    prisma: PrismaClient,
    userId: string,
    endpoint: string
): Promise<{ removed: number }> {
    const result = await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } })
    return { removed: result.count }
}

export async function listSubscriptions(prisma: PrismaClient, userId: string) {
    return prisma.pushSubscription.findMany({
        where: { userId },
        select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastSuccessAt: true },
        orderBy: { createdAt: "desc" },
    })
}

export interface PushSummary {
    claimed: number
    delivered: number
    pruned: number
    failed: number
    skippedStale: number
    /** Notifications no device received because of a transient failure; unclaimed again for the next sweep. */
    retried: number
}

interface ClaimedRow {
    id: string
    userId: string
    type: NotificationType
    title: string
    message: string
    actionUrl: string | null
    priority: NotificationPriority
    createdAt: Date
}

export async function dispatchPush(prisma: PrismaClient, limit = 50): Promise<PushSummary> {
    const summary: PushSummary = { claimed: 0, delivered: 0, pruned: 0, failed: 0, skippedStale: 0, retried: 0 }

    if (!isPushConfigured()) return summary

    summary.skippedStale = await prisma.$executeRaw`
        UPDATE "notifications"
           SET "pushedAt" = (now() AT TIME ZONE 'UTC')
         WHERE "pushedAt" IS NULL
           AND "createdAt" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${PUSH_STALE_AFTER_MINUTES}::int)`

    const claimed = await prisma.$queryRaw<ClaimedRow[]>`
        UPDATE "notifications"
           SET "pushedAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
         WHERE id IN (
               SELECT id FROM "notifications"
                WHERE "pushedAt" IS NULL
                ORDER BY "createdAt"
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
         )
        RETURNING id, "userId", type, title, message, "actionUrl", priority, "createdAt"`

    summary.claimed = claimed.length
    if (claimed.length === 0) return summary

    const userIds = [...new Set(claimed.map((row) => row.userId))]
    const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true, failureCount: true },
    })

    const byUser = new Map<string, typeof subscriptions>()
    for (const subscription of subscriptions) {
        const list = byUser.get(subscription.userId)
        if (list) list.push(subscription)
        else byUser.set(subscription.userId, [subscription])
    }

    const doomed: string[] = []
    const retry: string[] = []

    for (const row of claimed) {
        const targets = byUser.get(row.userId)
        if (!targets || targets.length === 0) continue

        let deliveredToSomeone = false
        let transientFailure = false

        const payload: PushPayload = {
            notificationId: row.id,
            type: row.type,
            title: clamp(row.title, 120),
            body: clamp(row.message, 400),
            url: row.actionUrl,
            priority: row.priority,
            at: row.createdAt.getTime(),
        }

        const outcomes = await Promise.all(
            targets.map(async (target) => ({
                target,
                outcome: await sendPush(
                    { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
                    payload
                ),
            }))
        )

        for (const { target, outcome } of outcomes) {
            if (outcome.ok) {
                summary.delivered++
                deliveredToSomeone = true
                await prisma.pushSubscription.updateMany({
                    where: { id: target.id },
                    data: { failureCount: 0, lastSuccessAt: new Date() },
                })
                continue
            }

            summary.failed++
            if (outcome.retryable) transientFailure = true
            if (outcome.gone || target.failureCount + 1 >= MAX_CONSECUTIVE_FAILURES) {
                doomed.push(target.id)
                continue
            }
            await prisma.pushSubscription.updateMany({
                where: { id: target.id },
                data: { failureCount: { increment: 1 } },
            })
            console.warn(`[push] ${row.type} to ${redact(target.endpoint)} failed: ${outcome.error}`)
        }

        // Nobody got it and the failure was transient (timeout, 5xx, 429): hand the row back
        // to the next sweep. Once any device has it the admin has seen it, so a partial failure
        // is not re-pushed — that would duplicate it on the device that worked.
        if (!deliveredToSomeone && transientFailure) retry.push(row.id)
    }

    if (doomed.length > 0) {
        const deleted = await prisma.pushSubscription.deleteMany({ where: { id: { in: doomed } } })
        summary.pruned = deleted.count
    }

    if (retry.length > 0) {
        // There is no attempts column, so the cap is the stale window: a row older than
        // PUSH_STALE_AFTER_MINUTES is stamped without sending at the top of the next sweep,
        // which ends the retries of anything that keeps failing.
        const result = await prisma.notification.updateMany({
            where: { id: { in: retry } },
            data: { pushedAt: null },
        })
        summary.retried = result.count
    }

    return summary
}

/**
 * The awaitable form of the immediate dispatch, for `after()` in a route or server action:
 * `after(() => dispatchPushNow(prisma))`. Never rejects — a push failure is logged and left
 * to the cron sweep, exactly as with `dispatchPushSoon`.
 */
export async function dispatchPushNow(prisma: PrismaClient, limit = 50): Promise<PushSummary> {
    try {
        return await dispatchPush(prisma, limit)
    } catch (error) {
        console.error("[push] immediate dispatch failed; the cron sweep will retry:", error)
        return { claimed: 0, delivered: 0, pruned: 0, failed: 0, skippedStale: 0, retried: 0 }
    }
}

/** Fire-and-forget; prefer `dispatchPushNow` inside `after()` so the platform keeps the function alive. */
export function dispatchPushSoon(prisma: PrismaClient, limit = 50): void {
    void dispatchPushNow(prisma, limit)
}

function clamp(text: string, max: number): string {
    if (text.length <= max) return text
    const cut = text.slice(0, max - 1)
    const space = cut.lastIndexOf(" ")
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function redact(endpoint: string): string {
    return `…${endpoint.slice(-12)}`
}
