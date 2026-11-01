import type { Prisma, PrismaClient } from "@repo/database"
import { renderTemplate } from "./templates/index"
import type { PayloadByTemplate } from "./templates/payloads"
import { sendMail, type SendOutcome } from "./index"
import { SENDING_LOCALE, type MailLocale, type MailTemplate } from "./types"

const BACKOFF_MINUTES = [1, 5, 15, 60, 360]
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1

/**
 * A row left in SENDING this long was claimed by a dispatch that died mid-batch (a function
 * timeout, a crash between the send and the bookkeeping). It goes back to PENDING and is
 * re-sent; Resend's Idempotency-Key (`outbox-<id>`) makes a repeat of a delivered one a no-op.
 */
export const STUCK_SENDING_MINUTES = 10

export interface QueueMailInput<T extends MailTemplate> {
    template: T
    to: string
    locale: MailLocale
    payload: PayloadByTemplate[T]
    dedupeKey?: string
}

export async function queueMail<T extends MailTemplate>(
    tx: Prisma.TransactionClient,
    input: QueueMailInput<T>
): Promise<{ id: string; deduplicated: boolean }> {
    if (input.dedupeKey) {
        const existing = await tx.emailOutbox.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } })
        if (existing) return { id: existing.id, deduplicated: true }
    }

    const row = await tx.emailOutbox.create({
        data: {
            template: input.template,
            to: input.to,
            locale: input.locale,
            payload: input.payload as unknown as Prisma.InputJsonValue,
            dedupeKey: input.dedupeKey ?? null,
        },
        select: { id: true },
    })
    return { id: row.id, deduplicated: false }
}

export interface DispatchSummary {
    claimed: number
    sent: number
    retrying: number
    failed: number
    /** SENDING rows older than STUCK_SENDING_MINUTES that were put back in the queue. */
    requeued: number
    /** Rows whose email went out (or failed) but whose bookkeeping write failed; they stay SENDING and are requeued later. */
    deferred: number
    batches: number
}

export interface DispatchOptions {
    /** Rows claimed per batch. Default 25. */
    limit?: number
    /** Batches to run before returning, as long as each claimed something. Default 1. */
    maxBatches?: number
    /** Stop starting new batches once this much wall time has passed. A batch in flight finishes. */
    deadlineMs?: number
}

const DEFAULT_LIMIT = 25

interface ClaimedRow {
    id: string
    template: string
    to: string
    locale: string
    payload: unknown
    attempts: number
}

export async function dispatchOutbox(
    prisma: PrismaClient,
    options: number | DispatchOptions = {}
): Promise<DispatchSummary> {
    const resolved: DispatchOptions = typeof options === "number" ? { limit: options } : options
    const limit = resolved.limit ?? DEFAULT_LIMIT
    const maxBatches = resolved.maxBatches ?? 1
    const deadline = resolved.deadlineMs === undefined ? Infinity : Date.now() + resolved.deadlineMs

    const summary: DispatchSummary = { claimed: 0, sent: 0, retrying: 0, failed: 0, requeued: 0, deferred: 0, batches: 0 }

    summary.requeued = await requeueStuck(prisma)

    while (summary.batches < maxBatches && Date.now() < deadline) {
        const claimed = await claim(prisma, limit)
        if (claimed.length === 0) break
        summary.batches++
        summary.claimed += claimed.length

        for (const row of claimed) {
            const outcome = await attemptSend(row)
            // Bookkeeping is isolated per row: a database hiccup here must not turn a delivered
            // email into a FAILED row, and must not take the rest of the batch down with it.
            try {
                if (outcome.ok) {
                    await prisma.emailOutbox.update({
                        where: { id: row.id },
                        data: { status: "SENT", sentAt: new Date(), lastError: null, nextAttemptAt: null },
                    })
                    summary.sent++
                } else {
                    await recordFailure(prisma, row.id, row.attempts, outcome.error, outcome.retryable, summary)
                }
            } catch (error) {
                summary.deferred++
                console.error(
                    `[mail] could not record the outcome of outbox row ${row.id} (${outcome.ok ? "sent" : "failed"}); ` +
                        `it stays SENDING and is requeued after ${STUCK_SENDING_MINUTES} minutes:`,
                    error
                )
            }
        }
    }

    return summary
}

/**
 * Drains the queue: batch after batch until nothing is left to claim or `deadlineMs` runs out.
 * The shape an app hands to `after()` right after it queued mail inside a transaction.
 */
export function drainOutbox(
    prisma: PrismaClient,
    options: Omit<DispatchOptions, "maxBatches"> = {}
): Promise<DispatchSummary> {
    return dispatchOutbox(prisma, { limit: DEFAULT_LIMIT, deadlineMs: 20_000, ...options, maxBatches: Infinity })
}

async function claim(prisma: PrismaClient, limit: number): Promise<ClaimedRow[]> {
    return prisma.$queryRaw<ClaimedRow[]>`
        UPDATE "email_outbox"
           SET status = 'SENDING', attempts = attempts + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
         WHERE id IN (
               SELECT id FROM "email_outbox"
                WHERE status = 'PENDING'
                  AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (now() AT TIME ZONE 'UTC'))
                ORDER BY "createdAt"
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
         )
        RETURNING id, template, "to", locale, payload, attempts`
}

async function requeueStuck(prisma: PrismaClient): Promise<number> {
    // The claim already counted this attempt, so a stuck row that has used them all is done.
    await prisma.$executeRaw`
        UPDATE "email_outbox"
           SET status = 'FAILED',
               "lastError" = COALESCE("lastError", 'dispatch died while sending'),
               "nextAttemptAt" = NULL,
               "updatedAt" = (now() AT TIME ZONE 'UTC')
         WHERE status = 'SENDING'
           AND "updatedAt" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${STUCK_SENDING_MINUTES}::int)
           AND attempts >= ${MAX_ATTEMPTS}`
    return prisma.$executeRaw`
        UPDATE "email_outbox"
           SET status = 'PENDING',
               "lastError" = COALESCE("lastError", 'dispatch died while sending'),
               "nextAttemptAt" = NULL,
               "updatedAt" = (now() AT TIME ZONE 'UTC')
         WHERE status = 'SENDING'
           AND "updatedAt" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${STUCK_SENDING_MINUTES}::int)`
}

async function attemptSend(row: ClaimedRow): Promise<SendOutcome> {
    try {
        // The row keeps the customer's locale; the message itself goes out in SENDING_LOCALE.
        const rendered = await renderTemplate(
            row.template as MailTemplate,
            SENDING_LOCALE,
            row.payload as PayloadByTemplate[MailTemplate]
        )
        return await sendMail({
            to: row.to,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            tags: { template: row.template, outboxId: row.id },
        })
    } catch (error) {
        // An unrenderable row (unknown template, bad payload) fails the same way every time.
        return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: false }
    }
}

async function recordFailure(
    prisma: PrismaClient,
    id: string,
    attempts: number,
    error: string,
    retryable: boolean,
    summary: DispatchSummary
): Promise<void> {
    const exhausted = attempts >= MAX_ATTEMPTS
    if (!retryable || exhausted) {
        await prisma.emailOutbox.update({
            where: { id },
            data: { status: "FAILED", lastError: error, nextAttemptAt: null },
        })
        summary.failed++
        return
    }

    const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]!
    await prisma.emailOutbox.update({
        where: { id },
        data: { status: "PENDING", lastError: error, nextAttemptAt: new Date(Date.now() + minutes * 60_000) },
    })
    summary.retrying++
}

export async function sendOrQueue<T extends MailTemplate>(
    prisma: PrismaClient,
    input: QueueMailInput<T>
): Promise<{ delivered: boolean; queued: boolean }> {
    const rendered = await renderTemplate(input.template, SENDING_LOCALE, input.payload)
    const outcome = await sendMail({
        to: input.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: { template: input.template },
    })

    if (outcome.ok) return { delivered: true, queued: false }
    if (!outcome.retryable) {
        console.error(`[mail] permanent failure for ${input.template} to ${input.to}; not queued: ${outcome.error}`)
        return { delivered: false, queued: false }
    }

    await prisma.$transaction((tx) => queueMail(tx, input))
    console.warn(`[mail] ${input.template} to ${input.to} failed and was queued for retry: ${outcome.error}`)
    return { delivered: false, queued: true }
}
