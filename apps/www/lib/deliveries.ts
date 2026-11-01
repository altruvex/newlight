import { after } from "next/server"
import { prisma } from "@repo/database"
import { drainOutbox } from "@repo/mail/outbox"
import { dispatchPushNow } from "@repo/notifications"

import { logger } from "@/lib/logger"

// Mail and push are written to their outboxes inside the transaction that creates the order,
// cancellation or contact form; the scheduled sweep that drains them runs once a day. This
// drains them as soon as the response is sent, so a confirmation arrives in seconds instead of
// hours. Every failure is logged and left to the sweep — nothing here reaches the customer.
const IMMEDIATE_DEADLINE_MS = 10_000

export function dispatchDeliveriesAfterResponse(reason: string): void {
    const run = async () => {
        const [mail, push] = await Promise.allSettled([
            drainOutbox(prisma, { deadlineMs: IMMEDIATE_DEADLINE_MS }),
            dispatchPushNow(prisma),
        ])
        if (mail.status === "rejected") {
            logger.error({ err: mail.reason, reason }, "immediate mail dispatch failed; the cron sweep will retry")
        }
        if (push.status === "rejected") {
            logger.error({ err: push.reason, reason }, "immediate push dispatch failed; the cron sweep will retry")
        }
    }

    try {
        after(run)
    } catch (error) {
        // Outside a request scope (a script, a test) `after` is unavailable; run detached instead.
        logger.warn({ err: error, reason }, "after() unavailable; dispatching deliveries detached")
        void run().catch(() => undefined)
    }
}
