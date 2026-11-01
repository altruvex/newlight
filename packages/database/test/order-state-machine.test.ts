import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ActorType, OrderStatus } from "../generated/prisma/client"
import { createTestDatabase, type TestDatabase } from "./harness"
import { seedFixture, seedStock, LOCATION_ID, type Fixture } from "./fixtures"
import { release, reserve, RESERVATION_EXPIRED_ACTION, sweepExpiredReservations } from "../inventory"
import { canTransition, IllegalTransitionError, transitionOrder, TRANSITIONS } from "../order-state-machine"

let db: TestDatabase
let fixture: Fixture

const STATUSES: OrderStatus[] = ["awaiting_shipment", "shipped", "delivered", "cancelled"]
const ACTORS: ActorType[] = ["CUSTOMER", "ADMIN", "SYSTEM", "WEBHOOK"]

beforeAll(async () => {
    db = await createTestDatabase()
    fixture = await seedFixture(db.prisma)
    await seedStock(db.prisma, fixture.products.small, 500)
    await seedStock(db.prisma, fixture.products.large, 500)
})
afterAll(async () => db?.drop())

let counter = 0
async function makeOrder(productId: string, quantity = 2) {
    counter++
    return db.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
            data: {
                userId: fixture.userId,
                orderNumber: `T-${counter}-${Date.now()}`,
                idempotencyKey: `t-${counter}-${Date.now()}`,
                subtotal: "100.00",
                shippingCost: "0.00",
                total: "100.00",
                items: {
                    create: { productId, productName: "t", productImage: "", price: "100.00", quantity },
                },
            },
            select: { id: true },
        })
        await reserve(tx, productId, quantity)
        return order
    })
}

async function level(productId: string) {
    const row = await db.prisma.stockLevel.findUniqueOrThrow({
        where: { productId_locationId: { productId, locationId: LOCATION_ID } },
        select: { onHand: true, reserved: true },
    })
    return row
}

describe("the transition table (F2)", () => {
    it("rejects every combination it does not declare", async () => {
        const declared = new Set(
            TRANSITIONS.flatMap((t) => t.actors.map((actor) => `${t.from}|${t.to}|${actor}`))
        )
        const checked: string[] = []

        for (const from of STATUSES) {
            for (const to of STATUSES) {
                for (const actor of ACTORS) {
                    const key = `${from}|${to}|${actor}`
                    expect(canTransition(from, to, actor)).toBe(declared.has(key))
                    checked.push(key)
                }
            }
        }
        expect(checked).toHaveLength(64)
        expect(declared.size).toBe(11)
    })

    it("lets a CUSTOMER do exactly one thing: cancel before shipping", () => {
        const customerCan = TRANSITIONS.filter((t) => t.actors.includes("CUSTOMER"))
        expect(customerCan).toHaveLength(1)
        expect(customerCan[0]).toMatchObject({ from: "awaiting_shipment", to: "cancelled" })
    })

    it("never lets a CUSTOMER reach delivered — the §12 vulnerability", () => {
        for (const from of STATUSES) {
            expect(canTransition(from, "delivered", "CUSTOMER")).toBe(false)
        }
    })

    it("includes WEBHOOK before anything emits one (F2)", () => {
        expect(canTransition("shipped", "delivered", "WEBHOOK")).toBe(true)
    })
})

describe("the lifecycle (§8.3)", () => {
    it("reserves on create and writes no movement", async () => {
        const before = await level(fixture.products.small)
        await makeOrder(fixture.products.small, 3)
        const after = await level(fixture.products.small)
        expect(after.reserved).toBe(before.reserved + 3)
        expect(after.onHand).toBe(before.onHand)
    })

    it("ships: releases the reservation and writes a SALE", async () => {
        const before = await level(fixture.products.small)
        const order = await makeOrder(fixture.products.small, 4)
        const result = await transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "ADMIN" }, trackingNumber: "TRK" })

        const after = await level(fixture.products.small)
        expect(result.movements).toBe(1)
        expect(after.reserved).toBe(before.reserved)
        expect(after.onHand).toBe(before.onHand - 4)

        const row = await db.prisma.order.findUniqueOrThrow({ where: { id: order.id } })
        expect(row.shippedAt).not.toBeNull()
        expect(row.trackingNumber).toBe("TRK")
        expect(row.paymentStatus).toBe("PENDING")
    })

    it("delivers: settles payment, and writes no movement", async () => {
        const order = await makeOrder(fixture.products.large, 1)
        await transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "ADMIN" } })
        const before = await level(fixture.products.large)

        const result = await transitionOrder(db.prisma, { orderId: order.id, to: "delivered", actor: { type: "ADMIN" } })
        const row = await db.prisma.order.findUniqueOrThrow({ where: { id: order.id } })

        expect(result.paymentSettled).toBe(true)
        expect(result.movements).toBe(0)
        expect(row.paymentStatus).toBe("PAID")
        expect(row.paidAt).not.toBeNull()
        expect(row.deliveredAt).not.toBeNull()
        expect((await level(fixture.products.large)).onHand).toBe(before.onHand)
    })

    it("applies a double delivery confirmation exactly once (F5)", async () => {
        const order = await makeOrder(fixture.products.large, 1)
        await transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "ADMIN" } })
        await transitionOrder(db.prisma, { orderId: order.id, to: "delivered", actor: { type: "ADMIN" } })
        const first = await db.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paidAt: true } })

        const again = await transitionOrder(db.prisma, { orderId: order.id, to: "delivered", actor: { type: "WEBHOOK" } })
        const second = await db.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paidAt: true } })

        expect(again.alreadyApplied).toBe(true)
        expect(again.movements).toBe(0)
        expect(second.paidAt?.getTime()).toBe(first.paidAt?.getTime())
    })

    it("cancels before shipping: releases, and writes no movement", async () => {
        const before = await level(fixture.products.small)
        const order = await makeOrder(fixture.products.small, 5)
        const result = await transitionOrder(db.prisma, { orderId: order.id, to: "cancelled", actor: { type: "CUSTOMER" } })

        const after = await level(fixture.products.small)
        expect(result.movements).toBe(0)
        expect(after.reserved).toBe(before.reserved)
        expect(after.onHand).toBe(before.onHand)
    })

    it("returns after shipping: a RETURN movement, and it stays unpaid", async () => {
        const before = await level(fixture.products.small)
        const order = await makeOrder(fixture.products.small, 6)
        await transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "ADMIN" } })
        const result = await transitionOrder(db.prisma, { orderId: order.id, to: "cancelled", actor: { type: "ADMIN" }, reason: "refused" })

        const row = await db.prisma.order.findUniqueOrThrow({ where: { id: order.id } })
        expect(result.movements).toBe(1)
        expect((await level(fixture.products.small)).onHand).toBe(before.onHand)
        expect(row.paymentStatus).toBe("PENDING")
    })

    it("refunds a return after delivery, rather than editing history", async () => {
        const order = await makeOrder(fixture.products.large, 2)
        await transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "ADMIN" } })
        await transitionOrder(db.prisma, { orderId: order.id, to: "delivered", actor: { type: "ADMIN" } })
        const result = await transitionOrder(db.prisma, { orderId: order.id, to: "cancelled", actor: { type: "ADMIN" }, reason: "returned" })

        const row = await db.prisma.order.findUniqueOrThrow({ where: { id: order.id } })
        expect(row.paymentStatus).toBe("REFUNDED")
        const movements = await db.prisma.stockMovement.findMany({ where: { referenceId: order.id }, select: { type: true } })
        expect(movements.map((m) => m.type).sort()).toEqual(["RETURN", "SALE"])
        expect(result.movements).toBe(1)
    })
})

describe("refusals", () => {
    it("refuses a customer trying to ship", async () => {
        const order = await makeOrder(fixture.products.small, 1)
        await expect(
            transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "CUSTOMER" } })
        ).rejects.toThrow(IllegalTransitionError)
    })

    it("refuses a customer trying to mark their own order delivered", async () => {
        const order = await makeOrder(fixture.products.small, 1)
        await transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "ADMIN" } })
        await expect(
            transitionOrder(db.prisma, { orderId: order.id, to: "delivered", actor: { type: "CUSTOMER" } })
        ).rejects.toThrow(IllegalTransitionError)
    })

    it("leaves stock untouched when it refuses", async () => {
        const order = await makeOrder(fixture.products.small, 2)
        const before = await level(fixture.products.small)
        await expect(
            transitionOrder(db.prisma, { orderId: order.id, to: "delivered", actor: { type: "CUSTOMER" } })
        ).rejects.toThrow()
        expect(await level(fixture.products.small)).toEqual(before)
    })
})

describe("attribution (F1)", () => {
    it("records who caused every transition", async () => {
        const order = await makeOrder(fixture.products.small, 1)
        await transitionOrder(db.prisma, {
            orderId: order.id,
            to: "shipped",
            actor: { type: "ADMIN", id: "admin-7", email: "a@newlight.invalid" },
        })

        const audit = await db.prisma.adminAuditLog.findFirstOrThrow({
            where: { entity: "Order", entityId: order.id },
        })
        expect(audit.actorType).toBe("ADMIN")
        expect(audit.actorId).toBe("admin-7")
        expect(audit.actorEmail).toBe("a@newlight.invalid")
        expect(audit.action).toBe("order.awaiting_shipment->shipped")
    })

    it("writes nothing when a transition is refused", async () => {
        const order = await makeOrder(fixture.products.small, 1)
        await expect(
            transitionOrder(db.prisma, { orderId: order.id, to: "delivered", actor: { type: "CUSTOMER" } })
        ).rejects.toThrow()
        expect(await db.prisma.adminAuditLog.count({ where: { entityId: order.id } })).toBe(0)
    })
})

describe("the expiry sweep and transitions share one reservation", () => {
    const FOUR_DAYS_AGO = new Date(Date.now() - 4 * 24 * 3_600_000)

    beforeAll(async () => {
        await seedStock(db.prisma, fixture.products.single, 500)
    })

    async function expiredOrder(productId: string, quantity: number) {
        const order = await makeOrder(productId, quantity)
        await db.prisma.order.update({ where: { id: order.id }, data: { createdAt: FOUR_DAYS_AGO } })
        const sweep = await sweepExpiredReservations(db.prisma)
        expect(sweep.released.map((o) => o.orderId)).toContain(order.id)
        return order
    }

    it("shipping an order whose reservation expired does not release another order's", async () => {
        const productId = fixture.products.single
        const before = await level(productId)
        const expired = await expiredOrder(productId, 4)
        const other = await makeOrder(productId, 4)

        const result = await transitionOrder(db.prisma, { orderId: expired.id, to: "shipped", actor: { type: "ADMIN" } })

        const after = await level(productId)
        expect(result.movements).toBe(1)
        expect(after.onHand).toBe(before.onHand - 4)
        // `other` still holds its 4; only the expired order's (already released) 4 are gone.
        expect(after.reserved).toBe(before.reserved + 4)

        await transitionOrder(db.prisma, { orderId: other.id, to: "cancelled", actor: { type: "CUSTOMER" } })
        expect((await level(productId)).reserved).toBe(before.reserved)
    })

    it("cancelling an order whose reservation expired does not release another order's", async () => {
        const productId = fixture.products.single
        const before = await level(productId)
        const expired = await expiredOrder(productId, 3)
        await makeOrder(productId, 3)

        await transitionOrder(db.prisma, { orderId: expired.id, to: "cancelled", actor: { type: "ADMIN" } })

        const after = await level(productId)
        expect(after.onHand).toBe(before.onHand)
        expect(after.reserved).toBe(before.reserved + 3)
    })

    it("applies exactly one of two concurrent transitions", async () => {
        const productId = fixture.products.single
        const order = await makeOrder(productId, 5)
        await makeOrder(productId, 5) // a second reservation a double release would eat into
        const before = await level(productId)

        // Hold the stock row so both transitions get past their reads before either can write.
        let open!: () => void
        const held = new Promise<void>((resolve) => { open = resolve })
        const barrier = db.prisma.$transaction(
            async (tx) => {
                await tx.$queryRaw`SELECT 1 FROM stock_levels WHERE "productId" = ${productId} AND "locationId" = ${LOCATION_ID} FOR UPDATE`
                await held
            },
            { timeout: 20_000 }
        )
        await new Promise((resolve) => setTimeout(resolve, 100))

        const racers = Promise.allSettled([
            transitionOrder(db.prisma, { orderId: order.id, to: "cancelled", actor: { type: "CUSTOMER" } }),
            transitionOrder(db.prisma, { orderId: order.id, to: "shipped", actor: { type: "ADMIN" } }),
        ])
        await new Promise((resolve) => setTimeout(resolve, 400))
        open()
        await barrier
        const outcomes = await racers

        const applied = outcomes.filter((o) => o.status === "fulfilled")
        const refused = outcomes.filter((o) => o.status === "rejected")
        expect(applied).toHaveLength(1)
        expect(refused).toHaveLength(1)
        expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(IllegalTransitionError)

        const row = await db.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } })
        const after = await level(productId)
        expect(after.reserved).toBe(before.reserved - 5)
        expect(after.onHand).toBe(row.status === "shipped" ? before.onHand - 5 : before.onHand)
        expect(await db.prisma.adminAuditLog.count({ where: { entityId: order.id } })).toBe(1)
    })

    it("does not release an order that was cancelled while the sweep was deciding", async () => {
        const productId = fixture.products.single
        const order = await makeOrder(productId, 2)
        await makeOrder(productId, 2)
        await db.prisma.order.update({ where: { id: order.id }, data: { createdAt: FOUR_DAYS_AGO } })
        const before = await level(productId)

        // A cancel that holds the order row while the sweep runs, and commits after it.
        let open!: () => void
        const held = new Promise<void>((resolve) => { open = resolve })
        const cancel = db.prisma.$transaction(
            async (tx) => {
                await tx.$queryRaw`SELECT 1 FROM orders WHERE id = ${order.id} FOR UPDATE`
                await held
                for (const item of await tx.orderItem.findMany({ where: { orderId: order.id } })) {
                    await release(tx, item.productId, item.quantity)
                }
                await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } })
            },
            { timeout: 20_000 }
        )
        await new Promise((resolve) => setTimeout(resolve, 100))

        const sweep = sweepExpiredReservations(db.prisma)
        await new Promise((resolve) => setTimeout(resolve, 400))
        open()
        await cancel
        const summary = await sweep

        expect(summary.released.map((o) => o.orderId)).not.toContain(order.id)
        expect(
            await db.prisma.adminAuditLog.count({ where: { entityId: order.id, action: RESERVATION_EXPIRED_ACTION } })
        ).toBe(0)
        // Released once (by the cancel), not twice.
        expect((await level(productId)).reserved).toBe(before.reserved - 2)
    })
})
