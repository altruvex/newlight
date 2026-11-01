import { seedFixture } from "@repo/database/test-fixtures"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { ListingFilters, SortKey } from "@/lib/services/product-facets"

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

async function listingPage(page: number, filters: Partial<ListingFilters> = {}) {
    const { searchListing } = await import("@/lib/services/search-service")
    const { EMPTY_FILTERS } = await import("@/lib/services/product-facets")
    return searchListing("nl-", "en", page, 1, { ...EMPTY_FILTERS, ...filters })
}

async function skusOnPage(page: number, sort: SortKey, filters: Partial<ListingFilters> = {}) {
    const listing = await listingPage(page, { ...filters, sort })
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

    it("filters across all matches before cutting the page", async () => {
        // Unfiltered, nl-single is on page 2 of "price low to high"; only it has main_material.
        expect((await skusOnPage(2, "price-asc")).skus).toEqual(["nl-single"])

        const filtered = await skusOnPage(1, "price-asc", { specs: { main_material: ["false"] } })
        expect(filtered).toEqual({ total: 1, skus: ["nl-single"] })

        // Family-wide attributes: IP65 is on nl-test-10w, the family is led by nl-test-5w.
        const family = await skusOnPage(1, "price-asc", { specs: { ip_rating: ["IP65"] } })
        expect(family).toEqual({ total: 1, skus: ["nl-test-5w"] })

        const none = await listingPage(1, { onSaleOnly: true })
        expect(none.total).toBe(0)
        expect(none.entries).toHaveLength(0)
        expect(none.facets.total).toBe(2)
    })

    it("counts facets over every match, not the page in view", async () => {
        const listing = await listingPage(1, { specs: { main_material: ["false"] } })
        expect(listing.entries).toHaveLength(1)
        expect(listing.facets.total).toBe(2)
        expect(listing.facets.colorTemperatures.map((option) => option.count)).toEqual([2, 2])
        expect(listing.facets.colors.map((option) => option.count)).toEqual([2])
    })
})
