import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { seedFixture, type Fixture } from "@repo/database/test-fixtures"

import type { DiscountInput } from "@/lib/services/discount-service"

let db: TestDatabase
let fixture: Fixture

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock("@repo/database", async () => {
    const actual = await vi.importActual<typeof import("@repo/database")>("@repo/database")
    return {
        ...actual,
        get prisma() {
            return holder.client
        },
    }
})

beforeAll(async () => {
    db = await createTestDatabase()
    holder.client = db.prisma
})
afterAll(async () => db?.drop())

beforeEach(async () => {
    await db.prisma.adminAuditLog.deleteMany()
    await db.prisma.discountProduct.deleteMany()
    await db.prisma.discount.deleteMany()
    await db.prisma.productSpec.deleteMany()
    await db.prisma.productImage.deleteMany()
    await db.prisma.productAvailableColor.deleteMany()
    await db.prisma.productSlugHistory.deleteMany()
    await db.prisma.taxonomySlugHistory.deleteMany()
    await db.prisma.product.deleteMany()
    await db.prisma.productFamily.deleteMany()
    await db.prisma.subCategory.deleteMany()
    await db.prisma.category.deleteMany()
    await db.prisma.user.deleteMany()
    fixture = await seedFixture(db.prisma)
})

async function service() {
    return (await import("@/lib/services/discount-service")).DiscountService
}

const HOUR = 3_600_000

function input(over: Partial<DiscountInput> = {}): DiscountInput {
    return {
        name: "Eid sale",
        kind: "PERCENT",
        value: "15",
        scope: { type: "FAMILY", familyId: fixture.familyId },
        startsAt: new Date(Date.now() + HOUR),
        endsAt: new Date(Date.now() + 24 * HOUR),
        ...over,
    }
}

describe("preview", () => {
    it("prices every product in scope without touching a single one", async () => {
        const DiscountService = await service()
        const preview = await DiscountService.preview(input())

        expect(preview.count).toBe(2)
        expect(preview.rows.map((row) => [row.sku, row.basePrice, row.newPrice])).toEqual([
            ["nl-test-10w", "199.50", "169.58"],
            ["nl-test-5w", "150.00", "127.50"],
        ])

        const products = await db.prisma.product.findMany({ orderBy: { productId: "asc" } })
        expect(products.map((product) => product.price.toFixed(2))).toEqual(["1000.00", "199.50", "150.00"])
    })

    it("scopes: a product, a family, a sub-category, a category, everything", async () => {
        const DiscountService = await service()
        const count = async (scope: DiscountInput["scope"]) =>
            (await DiscountService.preview(input({ scope }))).count

        expect(await count({ type: "PRODUCTS", productIds: [fixture.products.single] })).toBe(1)
        expect(await count({ type: "FAMILY", familyId: fixture.familyId })).toBe(2)
        expect(await count({ type: "SUB_CATEGORY", subCategoryId: fixture.subCategoryId })).toBe(3)
        expect(await count({ type: "CATEGORY", categoryId: fixture.categoryId })).toBe(3)
        expect(await count({ type: "ALL" })).toBe(3)
    })

    it("names the products a fixed amount would flatten, before the discount exists", async () => {
        const DiscountService = await service()
        const preview = await DiscountService.preview(
            input({ kind: "AMOUNT", value: "500", scope: { type: "ALL" } })
        )

        expect(preview.clamped.map((row) => row.sku).sort()).toEqual(["nl-test-10w", "nl-test-5w"])
        await expect(
            DiscountService.create(input({ kind: "AMOUNT", value: "500", scope: { type: "ALL" } }))
        ).rejects.toThrow(/cost less than that discount takes off/)
    })

    it("says which products already have a discount that is as good or better", async () => {
        const DiscountService = await service()
        await DiscountService.create(input({ name: "Already running", value: "30", startsAt: new Date(Date.now() - HOUR) }))

        const preview = await DiscountService.preview(input({ name: "Weaker", value: "10" }))
        expect(preview.overlapping).toHaveLength(2)
        expect(preview.overlapping[0]!.supersededBy).toBe("Already running")
    })
})

describe("refusals", () => {
    it("refuses a window that has already passed", async () => {
        const DiscountService = await service()
        await expect(
            DiscountService.preview(
                input({ startsAt: new Date(Date.now() - 48 * HOUR), endsAt: new Date(Date.now() - 24 * HOUR) })
            )
        ).rejects.toThrow(/already passed/)
    })

    it("refuses a window that ends before it starts", async () => {
        const DiscountService = await service()
        await expect(
            DiscountService.preview(input({ endsAt: new Date(Date.now() - HOUR) }))
        ).rejects.toThrow(/end after it starts/)
    })

    it("refuses 100% off and anything above it", async () => {
        const DiscountService = await service()
        await expect(DiscountService.preview(input({ value: "100" }))).rejects.toThrow(/100% off is free/)
    })

    it("refuses a scope with no live products", async () => {
        const DiscountService = await service()
        await db.prisma.product.updateMany({ data: { isActive: false } })
        await expect(DiscountService.preview(input({ scope: { type: "ALL" } }))).rejects.toThrow(/no live products/)
    })

    it("refuses a nameless discount", async () => {
        const DiscountService = await service()
        await expect(DiscountService.preview(input({ name: "   " }))).rejects.toThrow(/give the discount a name/)
    })

    it("refuses a window long enough to be a price rather than a sale", async () => {
        const DiscountService = await service()
        await expect(
            DiscountService.preview(input({ endsAt: new Date(Date.now() + 500 * 24 * HOUR) }))
        ).rejects.toThrow(/not a sale, it is a price/)
    })
})

describe("creating", () => {
    it("stores the window and the scope, and leaves every base price alone", async () => {
        const DiscountService = await service()
        const result = await DiscountService.create(input())
        expect(result.count).toBe(2)

        const discount = await db.prisma.discount.findUniqueOrThrow({ where: { id: result.id } })
        expect(discount.scopeType).toBe("FAMILY")
        expect(discount.familyId).toBe(fixture.familyId)
        expect(discount.value.toFixed(2)).toBe("15.00")
        expect(discount.createdByEmail).toBe("admin@newlight.invalid")

        const products = await db.prisma.product.findMany({ orderBy: { productId: "asc" } })
        expect(products.map((product) => product.price.toFixed(2))).toEqual(["1000.00", "199.50", "150.00"])
    })

    it("records the named SKUs of a product-scoped discount", async () => {
        const DiscountService = await service()
        const { id } = await DiscountService.create(
            input({
                scope: { type: "PRODUCTS", productIds: [fixture.products.small, fixture.products.single] },
            })
        )

        const links = await db.prisma.discountProduct.findMany({ where: { discountId: id } })
        expect(links.map((link) => link.productId).sort()).toEqual(
            [fixture.products.small, fixture.products.single].sort()
        )
    })

    it("links only live, active products even when an archived one was selected", async () => {
        const DiscountService = await service()
        await db.prisma.product.update({ where: { id: fixture.products.large }, data: { deletedAt: new Date(), isActive: false } })

        const { id, count } = await DiscountService.create(
            input({
                scope: { type: "PRODUCTS", productIds: [fixture.products.large, fixture.products.small] },
            })
        )
        expect(count).toBe(1)

        const links = await db.prisma.discountProduct.findMany({ where: { discountId: id } })
        expect(links.map((link) => link.productId)).toEqual([fixture.products.small])
    })

    it("writes an audit row carrying the actor, the scope and the window", async () => {
        const DiscountService = await service()
        await DiscountService.create(input())

        const audit = await db.prisma.adminAuditLog.findFirstOrThrow({ where: { action: "discount.create" } })
        expect(audit.actorId).toBe("test-admin")
        expect(audit.entity).toBe("Discount")

        const diff = audit.diff as { scope: { type: string }; affected: number; startsAt: string }
        expect(diff.scope.type).toBe("FAMILY")
        expect(diff.affected).toBe(2)
        expect(typeof diff.startsAt).toBe("string")
    })
})

describe("ending", () => {
    it("stops a running discount without deleting it", async () => {
        const DiscountService = await service()
        const { id } = await DiscountService.create(input({ startsAt: new Date(Date.now() - HOUR) }))

        await DiscountService.stop(id)

        const stopped = await db.prisma.discount.findUniqueOrThrow({ where: { id } })
        expect(stopped.isActive).toBe(false)
        expect(await db.prisma.adminAuditLog.count({ where: { action: "discount.stop" } })).toBe(1)
    })

    it("refuses to delete a discount that has already started", async () => {
        const DiscountService = await service()
        const { id } = await DiscountService.create(input({ startsAt: new Date(Date.now() - HOUR) }))

        await expect(DiscountService.remove(id)).rejects.toThrow(/Stop it instead/)
        expect(await db.prisma.discount.count()).toBe(1)
    })

    it("deletes one that never started", async () => {
        const DiscountService = await service()
        const { id } = await DiscountService.create(input())

        await DiscountService.remove(id)
        expect(await db.prisma.discount.count()).toBe(0)
    })
})

describe("rescheduling", () => {
    it("moves both ends of a discount that has not started", async () => {
        const DiscountService = await service()
        const { id } = await DiscountService.create(input())

        const startsAt = new Date(Date.now() + 48 * HOUR)
        const endsAt = new Date(Date.now() + 72 * HOUR)
        await DiscountService.reschedule(id, startsAt, endsAt)

        const moved = await db.prisma.discount.findUniqueOrThrow({ where: { id } })
        expect(moved.startsAt.toISOString()).toBe(startsAt.toISOString())
    })

    it("refuses to move the start of one that is already running", async () => {
        const DiscountService = await service()
        const startedAt = new Date(Date.now() - HOUR)
        const { id } = await DiscountService.create(input({ startsAt: startedAt }))

        await expect(
            DiscountService.reschedule(id, new Date(Date.now() + HOUR), new Date(Date.now() + 48 * HOUR))
        ).rejects.toThrow(/only its end date can move/)

        await DiscountService.reschedule(id, startedAt, new Date(Date.now() + 96 * HOUR))
        const extended = await db.prisma.discount.findUniqueOrThrow({ where: { id } })
        expect(extended.endsAt.getTime()).toBeGreaterThan(Date.now() + 90 * HOUR)
    })
})

describe("the list", () => {
    it("labels each discount with its state and what it covers", async () => {
        const DiscountService = await service()
        await DiscountService.create(input({ name: "Scheduled one" }))
        const running = await DiscountService.create(
            input({ name: "Running one", scope: { type: "ALL" }, startsAt: new Date(Date.now() - HOUR) })
        )
        await DiscountService.stop(running.id)

        const current = await DiscountService.list()
        const ended = await DiscountService.list({ view: "ended" })
        const byName = new Map([...current.rows, ...ended.rows].map((row) => [row.name, row]))

        expect(byName.get("Scheduled one")!.status).toBe("scheduled")
        expect(byName.get("Scheduled one")!.scopeLabel).toBe("nl-test")
        expect(byName.get("Running one")!.status).toBe("stopped")
        expect(byName.get("Running one")!.scopeLabel).toBe("Whole catalogue")

        // The default view is live + scheduled only; stopped and ended ones sit behind "ended".
        expect(current.rows.map((row) => row.name)).toEqual(["Scheduled one"])
        expect(ended.rows.map((row) => row.name)).toEqual(["Running one"])
        expect(current.total).toBe(1)
        expect(ended.total).toBe(1)
    })
})

describe("product search for the picker", () => {
    it("matches by SKU and by English name, ignoring case", async () => {
        const DiscountService = await service()
        await db.prisma.productTranslation.updateMany({
            where: { productId: fixture.products.single, locale: "en" },
            data: { name: "Garden Spotlight" },
        })

        const bySku = await DiscountService.searchProducts("NL-TEST-5W")
        expect(bySku.map((hit) => hit.sku)).toEqual(["nl-test-5w"])
        expect(bySku[0]).toMatchObject({ id: fixture.products.small, name: "nl-test-5w" })

        const byName = await DiscountService.searchProducts("spotlight")
        expect(byName.map((hit) => [hit.id, hit.name])).toEqual([[fixture.products.single, "Garden Spotlight"]])

        // Fewer than two characters never touches the database.
        expect(await DiscountService.searchProducts("n")).toEqual([])
    })

    it("respects the limit and leaves out deleted products", async () => {
        const DiscountService = await service()
        expect((await DiscountService.searchProducts("nl-")).length).toBe(3)
        expect((await DiscountService.searchProducts("nl-", 2)).length).toBe(2)

        await db.prisma.product.update({ where: { id: fixture.products.small }, data: { deletedAt: new Date() } })
        const after = await DiscountService.searchProducts("nl-")
        expect(after.map((hit) => hit.sku)).not.toContain("nl-test-5w")
        expect(after.length).toBe(2)
    })
})
