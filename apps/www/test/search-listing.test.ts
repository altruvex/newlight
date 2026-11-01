import { seedFixture } from "@repo/database/test-fixtures"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

let db: TestDatabase

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
    // Two families match "nl-": nl-test-5w/nl-test-10w (led by the 150.00 variant) and nl-single (1000.00).
    await seedFixture(db.prisma)
})
afterAll(async () => db?.drop())

async function skusOnPage(page: number, sort: "featured" | "price-asc" | "price-desc" | "newest") {
    const { searchListing } = await import("@/lib/services/search-service")
    const listing = await searchListing("nl-", "en", page, 1, sort)
    return { total: listing.total, skus: listing.entries.map((entry) => entry.product.productId) }
}

describe("search listing pages", () => {
    it("counts families, not products, across all pages", async () => {
        const first = await skusOnPage(1, "featured")
        expect(first.total).toBe(2)
        expect(first.skus).toHaveLength(1)
    })

    it("sorts by price across the whole result before cutting the page", async () => {
        const asc = [(await skusOnPage(1, "price-asc")).skus[0], (await skusOnPage(2, "price-asc")).skus[0]]
        expect(asc).toEqual(["nl-test-5w", "nl-single"])

        const desc = [(await skusOnPage(1, "price-desc")).skus[0], (await skusOnPage(2, "price-desc")).skus[0]]
        expect(desc).toEqual(["nl-single", "nl-test-5w"])
    })
})
