import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { __setTransportForTesting, MailTransportError, type MailInput, type MailTransport } from "../index"
import { dispatchOutbox, drainOutbox, queueMail, sendOrQueue, MAX_ATTEMPTS } from "../outbox"
import type { Prisma, PrismaClient } from "@repo/database"
import type { OrderConfirmationPayload } from "../templates/payloads"

let db: TestDatabase

function recordingTransport(behaviour: "ok" | "retryable" | "permanent") {
    const sent: MailInput[] = []
    const transport: MailTransport = {
        name: `test-${behaviour}`,
        async send(input) {
            sent.push(input)
            if (behaviour === "retryable") throw new MailTransportError("503 upstream", 503, true)
            if (behaviour === "permanent") throw new MailTransportError("422 bad address", 422, false)
            return { id: `msg-${sent.length}`, provider: "test" }
        },
    }
    return { transport, sent }
}

const PAYLOAD: OrderConfirmationPayload = {
    orderNumber: "NL-1",
    items: [{ name: "x", quantity: 1, price: "10.00" }],
    subtotal: "10.00", shippingCost: "0.00", total: "10.00", currency: "EGP",
    address: { fullName: "a", phone: "b", addressLine1: "c", city: "d", country: "e" },
    orderUrl: "https://x.invalid",
}

beforeAll(async () => { db = await createTestDatabase() })
afterAll(async () => { __setTransportForTesting(null); await db?.drop() })
beforeEach(async () => { await db.prisma.emailOutbox.deleteMany() })

describe("queueing inside the business transaction", () => {
    it("commits the row with the event, and rolls it back with the event", async () => {
        const user = await db.prisma.user.create({
            data: { email: `a${Date.now()}@x.invalid`, name: "A" },
        })

        await expect(
            db.prisma.$transaction(async (tx) => {
                await queueMail(tx, { template: "contact-acknowledgement", to: user.email, locale: "ar", payload: { fullName: "A" } })
                throw new Error("business event failed")
            })
        ).rejects.toThrow("business event failed")
        expect(await db.prisma.emailOutbox.count()).toBe(0)

        await db.prisma.$transaction(async (tx) => {
            await queueMail(tx, { template: "contact-acknowledgement", to: user.email, locale: "ar", payload: { fullName: "A" } })
        })
        expect(await db.prisma.emailOutbox.count()).toBe(1)
    })

    it("queues one email per dedupeKey however many times the event retries", async () => {
        for (let i = 0; i < 3; i++) {
            await db.prisma.$transaction((tx) =>
                queueMail(tx, {
                    template: "order-confirmation", to: "a@x.invalid", locale: "en",
                    payload: PAYLOAD, dedupeKey: "order-confirmation:o-1",
                })
            )
        }
        expect(await db.prisma.emailOutbox.count()).toBe(1)
    })

    it("does not deduplicate mail that is legitimately repeatable", async () => {
        for (let i = 0; i < 2; i++) {
            await db.prisma.$transaction((tx) =>
                queueMail(tx, {
                    template: "password-reset", to: "a@x.invalid", locale: "en",
                    payload: { resetUrl: "https://x.invalid", expiresInMinutes: 60 },
                })
            )
        }
        expect(await db.prisma.emailOutbox.count()).toBe(2)
    })
})

describe("dispatch", () => {
    it("sends, marks SENT, and does not send again", async () => {
        const { transport, sent } = recordingTransport("ok")
        __setTransportForTesting(transport)

        await db.prisma.$transaction((tx) =>
            queueMail(tx, { template: "order-confirmation", to: "a@x.invalid", locale: "ar", payload: PAYLOAD })
        )

        const first = await dispatchOutbox(db.prisma)
        expect(first).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
        expect(sent).toHaveLength(1)
        // The row asked for Arabic; every message goes out in English (SENDING_LOCALE).
        expect(sent[0]!.subject).not.toMatch(/[؀-ۿ]/)
        expect(sent[0]!.subject).toBe("Order NL-1 confirmed")

        const row = await db.prisma.emailOutbox.findFirstOrThrow()
        expect(row.locale).toBe("ar")
        expect(row.status).toBe("SENT")
        expect(row.sentAt).not.toBeNull()

        expect(await dispatchOutbox(db.prisma)).toMatchObject({ claimed: 0 })
        expect(sent).toHaveLength(1)
    })

    it("backs off a retryable failure instead of hammering", async () => {
        __setTransportForTesting(recordingTransport("retryable").transport)
        await db.prisma.$transaction((tx) =>
            queueMail(tx, { template: "order-confirmation", to: "a@x.invalid", locale: "en", payload: PAYLOAD })
        )

        const result = await dispatchOutbox(db.prisma)
        expect(result).toMatchObject({ sent: 0, retrying: 1, failed: 0 })

        const row = await db.prisma.emailOutbox.findFirstOrThrow()
        expect(row.status).toBe("PENDING")
        expect(row.attempts).toBe(1)
        expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
        expect(row.lastError).toContain("503")

        expect(await dispatchOutbox(db.prisma)).toMatchObject({ claimed: 0 })
    })

    it("gives up on a permanent failure rather than scheduling six identical ones", async () => {
        __setTransportForTesting(recordingTransport("permanent").transport)
        await db.prisma.$transaction((tx) =>
            queueMail(tx, { template: "order-confirmation", to: "not-an-address", locale: "en", payload: PAYLOAD })
        )

        expect(await dispatchOutbox(db.prisma)).toMatchObject({ sent: 0, retrying: 0, failed: 1 })
        const row = await db.prisma.emailOutbox.findFirstOrThrow()
        expect(row.status).toBe("FAILED")
        expect(row.attempts).toBe(1)
        expect(row.attempts).toBeLessThan(MAX_ATTEMPTS)
    })

    it("treats an unrenderable template as permanent, not retryable", async () => {
        __setTransportForTesting(recordingTransport("ok").transport)
        await db.prisma.emailOutbox.create({
            data: { template: "no-such-template", to: "a@x.invalid", locale: "en", payload: {} },
        })
        expect(await dispatchOutbox(db.prisma)).toMatchObject({ failed: 1, retrying: 0 })
    })
})

describe("sendOrQueue", () => {
    it("sends immediately and stores nothing when the transport is healthy", async () => {
        const { transport, sent } = recordingTransport("ok")
        __setTransportForTesting(transport)

        const result = await sendOrQueue(db.prisma, {
            template: "email-verification", to: "a@x.invalid", locale: "ar",
            payload: { verifyUrl: "https://x.invalid", expiresInMinutes: 60 },
        })

        expect(result).toEqual({ delivered: true, queued: false })
        expect(sent).toHaveLength(1)
        expect(await db.prisma.emailOutbox.count()).toBe(0)
    })

    it("falls back to the outbox on a retryable failure", async () => {
        __setTransportForTesting(recordingTransport("retryable").transport)
        const result = await sendOrQueue(db.prisma, {
            template: "email-verification", to: "a@x.invalid", locale: "en",
            payload: { verifyUrl: "https://x.invalid", expiresInMinutes: 60 },
        })
        expect(result).toEqual({ delivered: false, queued: true })
        expect(await db.prisma.emailOutbox.count()).toBe(1)
    })

    it("does not queue a permanent failure", async () => {
        __setTransportForTesting(recordingTransport("permanent").transport)
        const result = await sendOrQueue(db.prisma, {
            template: "email-verification", to: "bad", locale: "en",
            payload: { verifyUrl: "https://x.invalid", expiresInMinutes: 60 },
        })
        expect(result).toEqual({ delivered: false, queued: false })
        expect(await db.prisma.emailOutbox.count()).toBe(0)
    })
})

describe("a failing transport never fails the business event (§16)", () => {
    it("commits the order even when every send throws", async () => {
        __setTransportForTesting(recordingTransport("retryable").transport)
        const user = await db.prisma.user.create({ data: { email: `b${Date.now()}@x.invalid`, name: "B" } })

        const order = await db.prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
                data: {
                    userId: user.id, orderNumber: `O-${Date.now()}`, idempotencyKey: `k-${Date.now()}`,
                    subtotal: "10.00", shippingCost: "0.00", total: "10.00",
                },
                select: { id: true },
            })
            await queueMail(tx, {
                template: "order-confirmation", to: user.email, locale: "ar",
                payload: PAYLOAD, dedupeKey: `order-confirmation:${created.id}`,
            })
            return created
        })

        await dispatchOutbox(db.prisma)
        expect(await db.prisma.order.count({ where: { id: order.id } })).toBe(1)
        expect(await db.prisma.emailOutbox.count({ where: { status: "PENDING" } })).toBe(1)
    })
})

// For rows created directly (not through queueMail), which takes Prisma's JSON type.
const RAW_PAYLOAD = PAYLOAD as unknown as Prisma.InputJsonValue

describe("recovery and budgets", () => {
    async function queueMany(n: number) {
        for (let i = 0; i < n; i++) {
            await db.prisma.$transaction((tx) =>
                queueMail(tx, { template: "order-confirmation", to: `a${i}@x.invalid`, locale: "en", payload: PAYLOAD })
            )
        }
    }

    it("runs one batch by default, and drains batch after batch when given a budget", async () => {
        const { transport, sent } = recordingTransport("ok")
        __setTransportForTesting(transport)
        await queueMany(3)

        expect(await dispatchOutbox(db.prisma, { limit: 1 })).toMatchObject({ claimed: 1, sent: 1, batches: 1 })
        expect(await dispatchOutbox(db.prisma, { limit: 1, maxBatches: 10 })).toMatchObject({ claimed: 2, sent: 2, batches: 2 })
        expect(sent).toHaveLength(3)
        expect(await db.prisma.emailOutbox.count({ where: { status: "SENT" } })).toBe(3)
    })

    it("stops starting batches once the deadline has passed", async () => {
        __setTransportForTesting(recordingTransport("ok").transport)
        await queueMany(3)

        const summary = await drainOutbox(db.prisma, { limit: 1, deadlineMs: 0 })
        expect(summary.batches).toBe(0)
        expect(await db.prisma.emailOutbox.count({ where: { status: "PENDING" } })).toBe(3)
    })

    it("requeues a row stuck in SENDING for more than ten minutes, and leaves a fresh one alone", async () => {
        const { transport, sent } = recordingTransport("ok")
        __setTransportForTesting(transport)
        const eleven = new Date(Date.now() - 11 * 60_000)
        const stuck = await db.prisma.emailOutbox.create({
            data: { template: "order-confirmation", to: "stuck@x.invalid", locale: "en", payload: RAW_PAYLOAD, status: "SENDING", attempts: 1, updatedAt: eleven },
        })
        const inFlight = await db.prisma.emailOutbox.create({
            data: { template: "order-confirmation", to: "flight@x.invalid", locale: "en", payload: RAW_PAYLOAD, status: "SENDING", attempts: 1 },
        })

        const summary = await dispatchOutbox(db.prisma)
        expect(summary).toMatchObject({ requeued: 1, claimed: 1, sent: 1 })
        expect(sent.map((m) => m.to)).toEqual(["stuck@x.invalid"])

        expect((await db.prisma.emailOutbox.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe("SENT")
        expect((await db.prisma.emailOutbox.findUniqueOrThrow({ where: { id: inFlight.id } })).status).toBe("SENDING")
    })

    it("fails a stuck row that had already used its last attempt", async () => {
        __setTransportForTesting(recordingTransport("ok").transport)
        const row = await db.prisma.emailOutbox.create({
            data: {
                template: "order-confirmation", to: "stuck@x.invalid", locale: "en", payload: RAW_PAYLOAD,
                status: "SENDING", attempts: MAX_ATTEMPTS, updatedAt: new Date(Date.now() - 11 * 60_000),
            },
        })

        expect(await dispatchOutbox(db.prisma)).toMatchObject({ requeued: 0, claimed: 0 })
        const after = await db.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })
        expect(after.status).toBe("FAILED")
        expect(after.lastError).toBe("dispatch died while sending")
    })

    it("keeps a delivered email out of FAILED when its bookkeeping write fails, and finishes the batch", async () => {
        const { transport, sent } = recordingTransport("ok")
        __setTransportForTesting(transport)
        await queueMany(2)

        let failures = 1
        const flaky = flakyUpdateClient(db.prisma, () => {
            if (failures === 0) return false
            failures--
            return true
        })

        const summary = await dispatchOutbox(flaky)
        expect(sent).toHaveLength(2)
        expect(summary).toMatchObject({ claimed: 2, sent: 1, failed: 0, deferred: 1 })

        const rows = await db.prisma.emailOutbox.findMany({ orderBy: { createdAt: "asc" } })
        expect(rows.map((r) => r.status).sort()).toEqual(["SENDING", "SENT"])
        expect(rows.some((r) => r.status === "FAILED")).toBe(false)
    })
})

// A client whose emailOutbox.update throws while `shouldFail()` says so; everything else is real.
function flakyUpdateClient(real: PrismaClient, shouldFail: () => boolean): PrismaClient {
    const outbox = new Proxy(real.emailOutbox, {
        get(target, prop, receiver) {
            if (prop === "update") {
                return async (args: Parameters<typeof real.emailOutbox.update>[0]) => {
                    if (shouldFail()) throw new Error("connection reset by peer")
                    return target.update(args)
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
    return new Proxy(real, {
        get(target, prop, receiver) {
            if (prop === "emailOutbox") return outbox
            const value = Reflect.get(target, prop, receiver)
            return typeof value === "function" ? value.bind(target) : value
        },
    })
}
