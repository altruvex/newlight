import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"

import { dispatchPush, dispatchPushNow, notifyUser, saveSubscription } from "../index"
import { __resetPushTransportForTesting, PUSH_TIMEOUT_MS } from "../push"

// A push service under test control: the status it answers with, or a delivery.
const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }))
vi.mock("web-push", () => ({
    default: { setVapidDetails: vi.fn(), sendNotification },
}))

class FakeWebPushError extends Error {
    constructor(readonly statusCode: number) {
        super(`push service answered ${statusCode}`)
    }
}

let db: TestDatabase
let counter = 0

const KEYS = {
    p256dh: "BEd3lPRCyIaKoNRxvvBsCB4Zjt5EhOOhP8p6MbcJ7Mrsc9rj1CVzUZLZ2sZlbUwSNoXVo4zGvHMkH3F0ykt2GLo",
    auth: "k8JV6sIkFcXbHV0k4bOtEQ",
}

async function adminWithDevice() {
    const user = await db.prisma.user.create({
        data: { email: `admin${counter++}-${Date.now()}@x.invalid`, name: "Admin", role: "ADMIN" },
    })
    await saveSubscription(db.prisma, { userId: user.id, endpoint: `https://push.invalid/${user.id}`, ...KEYS })
    return user
}

async function notification(userId: string) {
    await db.prisma.$transaction((tx) => notifyUser(tx, userId, { type: "NEW_ORDER", title: "t", message: "m" }))
    return db.prisma.notification.findFirstOrThrow({ where: { userId } })
}

beforeAll(async () => {
    db = await createTestDatabase()
    process.env.VAPID_PUBLIC_KEY = "BEJddNQGs0aTm0kMnpJgR15MuIu46V7Y_5-YwxfkB25X-xLbxGKsG4SzHrbBM4RQP5nRQ2fVOnpZBmCFzFECgWk"
    process.env.VAPID_PRIVATE_KEY = "sJHR7oTaJHYSHXQ7lxbmXWDCqUJqYFeCPDaZQnQFqEo"
    process.env.VAPID_SUBJECT = "mailto:test@x.invalid"
})
afterAll(async () => {
    __resetPushTransportForTesting()
    await db?.drop()
})
beforeEach(async () => {
    sendNotification.mockReset()
    await db.prisma.pushSubscription.deleteMany()
    await db.prisma.notification.deleteMany()
    await db.prisma.user.deleteMany()
})

describe("the push request is bounded", () => {
    it("hands web-push a socket timeout", async () => {
        sendNotification.mockResolvedValue({ statusCode: 201 })
        const user = await adminWithDevice()
        await notification(user.id)

        expect(await dispatchPush(db.prisma)).toMatchObject({ delivered: 1 })
        expect(sendNotification.mock.calls[0]![2]).toMatchObject({ timeout: PUSH_TIMEOUT_MS })
        expect(PUSH_TIMEOUT_MS).toBe(10_000)
    })
})

describe("transient failures are retried, permanent ones are not", () => {
    it("hands a 503 back to the next sweep, which delivers it", async () => {
        const user = await adminWithDevice()
        const row = await notification(user.id)

        sendNotification.mockRejectedValueOnce(new FakeWebPushError(503))
        expect(await dispatchPush(db.prisma)).toMatchObject({ claimed: 1, failed: 1, retried: 1, pruned: 0 })
        expect((await db.prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).pushedAt).toBeNull()

        sendNotification.mockResolvedValueOnce({ statusCode: 201 })
        expect(await dispatchPush(db.prisma)).toMatchObject({ claimed: 1, delivered: 1, retried: 0 })
        expect((await db.prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).pushedAt).not.toBeNull()
        expect(await db.prisma.pushSubscription.count()).toBe(1)
    })

    it("treats no response at all (a timeout) as transient", async () => {
        const user = await adminWithDevice()
        await notification(user.id)

        sendNotification.mockRejectedValueOnce(new Error("socket hang up"))
        expect(await dispatchPush(db.prisma)).toMatchObject({ failed: 1, retried: 1 })
        expect(await db.prisma.notification.count({ where: { pushedAt: null } })).toBe(1)
    })

    it("does not retry a 400 — the same payload fails the same way every time", async () => {
        const user = await adminWithDevice()
        await notification(user.id)

        sendNotification.mockRejectedValueOnce(new FakeWebPushError(400))
        expect(await dispatchPush(db.prisma)).toMatchObject({ failed: 1, retried: 0 })
        expect(await db.prisma.notification.count({ where: { pushedAt: null } })).toBe(0)
        expect(await dispatchPush(db.prisma)).toMatchObject({ claimed: 0 })
    })

    it("prunes a 410 and does not retry the notification", async () => {
        const user = await adminWithDevice()
        await notification(user.id)

        sendNotification.mockRejectedValueOnce(new FakeWebPushError(410))
        expect(await dispatchPush(db.prisma)).toMatchObject({ failed: 1, pruned: 1, retried: 0 })
        expect(await db.prisma.notification.count({ where: { pushedAt: null } })).toBe(0)
    })

    it("does not re-push a notification one of the admin's devices already received", async () => {
        const user = await adminWithDevice()
        await saveSubscription(db.prisma, { userId: user.id, endpoint: `https://push.invalid/second-${user.id}`, ...KEYS })
        await notification(user.id)

        sendNotification.mockResolvedValueOnce({ statusCode: 201 }).mockRejectedValueOnce(new FakeWebPushError(503))
        expect(await dispatchPush(db.prisma)).toMatchObject({ delivered: 1, failed: 1, retried: 0 })
        expect(await db.prisma.notification.count({ where: { pushedAt: null } })).toBe(0)
    })

    it("stops retrying once the row is older than the stale window", async () => {
        const user = await adminWithDevice()
        const row = await notification(user.id)

        sendNotification.mockRejectedValue(new FakeWebPushError(503))
        expect(await dispatchPush(db.prisma)).toMatchObject({ retried: 1 })

        await db.prisma.notification.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 61 * 60_000) } })
        expect(await dispatchPush(db.prisma)).toMatchObject({ skippedStale: 1, claimed: 0 })
        expect(sendNotification).toHaveBeenCalledTimes(1)
    })
})

describe("dispatchPushNow", () => {
    it("is awaitable and resolves to the sweep summary", async () => {
        sendNotification.mockResolvedValue({ statusCode: 201 })
        const user = await adminWithDevice()
        await notification(user.id)

        await expect(dispatchPushNow(db.prisma)).resolves.toMatchObject({ claimed: 1, delivered: 1 })
    })

    it("never rejects, so a push outage cannot fail the request that awaits it", async () => {
        const broken = new Proxy(db.prisma, {
            get(target, prop) {
                if (prop === "$executeRaw") return () => Promise.reject(new Error("database unreachable"))
                const value = Reflect.get(target, prop)
                return typeof value === "function" ? value.bind(target) : value
            },
        })
        await expect(dispatchPushNow(broken)).resolves.toMatchObject({ claimed: 0 })
    })
})
