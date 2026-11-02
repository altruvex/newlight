import { NextResponse, type NextRequest } from "next/server"
import { prisma, sweepExpiredReservations, sweepRateLimits } from "@repo/database"
import { dispatchOutbox } from "@repo/mail/outbox"
import { dispatchPush, isPushConfigured } from "@repo/notifications"

import { authorizeCron } from "@/lib/cron-auth"
import { refreshShopStock } from "@/lib/refresh-shop"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const RESERVATION_SWEEP_INTERVAL_MS = 60 * 60 * 1000
const LAST_RUN_SETTING = "cron.reservation_sweep_last_run"

type Outcome =
    | ({ ok: true; skipped?: string } & Record<string, unknown>)
    | { ok: false; error: string }

async function attempt(label: string, work: () => Promise<Record<string, unknown>>): Promise<Outcome> {
    try {
        return { ok: true, ...(await work()) }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[cron:sweep] ${label} failed: ${message}`)
        return { ok: false, error: message }
    }
}

async function claimReservationSweep(now: Date): Promise<boolean> {
    const row = await prisma.systemSetting.findUnique({ where: { key: LAST_RUN_SETTING } })
    const last = row ? Date.parse(row.value) : Number.NaN
    if (Number.isFinite(last) && now.getTime() - last < RESERVATION_SWEEP_INTERVAL_MS) return false

    const value = now.toISOString()
    await prisma.systemSetting.upsert({
        where: { key: LAST_RUN_SETTING },
        create: { key: LAST_RUN_SETTING, value },
        update: { value },
    })
    return true
}

export async function GET(request: NextRequest) {
    const denied = authorizeCron(request, "CRON_SECRET", "cron:sweep")
    if (denied) return denied

    const startedAt = Date.now()
    const now = new Date()

    const reservations = await attempt("reservations", async () => {
        if (!(await claimReservationSweep(now))) {
            return { skipped: "not due; runs hourly" }
        }
        const summary = await sweepExpiredReservations(prisma, now)
        const rateLimitsDeleted = await sweepRateLimits(prisma)
        if (summary.ordersReleased > 0) {
            console.warn(
                `[cron:sweep] released reservations on ${summary.ordersReleased} order(s) past ${summary.windowHours}h: ` +
                    summary.released.map((o) => o.orderNumber).join(", ")
            )
            // Released reservations put stock back on sale, or the shop keeps showing
            // those items as sold out.
            refreshShopStock()
        }
        return { ...summary, rateLimitsDeleted }
    })

    const mail = await attempt("mail", async () => {
        const summary = await dispatchOutbox(prisma)
        if (summary.failed > 0) {
            console.error(`[cron:sweep] ${summary.failed} message(s) exhausted their retries and are now FAILED.`)
        }
        return { ...summary }
    })

    const push = await attempt("push", async () => {
        const summary = await dispatchPush(prisma)
        if (!isPushConfigured()) {
            console.warn("[cron:sweep] VAPID is not configured; notifications are written but never pushed.")
        }
        if (summary.pruned > 0) {
            console.warn(`[cron:sweep] pruned ${summary.pruned} dead subscription(s).`)
        }
        return { ...summary, configured: isPushConfigured() }
    })

    const body = { reservations, mail, push, durationMs: Date.now() - startedAt }

    const failed = [reservations, mail, push].some((outcome) => !outcome.ok)
    return NextResponse.json({ ok: !failed, ...body }, { status: failed ? 500 : 200 })
}
