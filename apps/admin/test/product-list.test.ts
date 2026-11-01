import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { seedFixture, seedStock, type Fixture } from "@repo/database/test-fixtures"
import type { TableState } from "@/lib/table-params"

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
    fixture = await seedFixture(db.prisma)

    // Name order (Alpha, Bravo, Charlie) differs from SKU order (nl-single, nl-test-10w, nl-test-5w)
    // and from stock order (large 10, single 5, small 1), so each sort is told apart.
    const names = { small: "Alpha", single: "Bravo", large: "Charlie" } as const
    for (const key of ["small", "single", "large"] as const) {
        await db.prisma.productTranslation.update({
            where: { productId_locale: { productId: fixture.products[key], locale: "en" } },
            data: { name: names[key] },
        })
    }
    await seedStock(db.prisma, fixture.products.small, 1)
    await seedStock(db.prisma, fixture.products.large, 10)
    await seedStock(db.prisma, fixture.products.single, 5)
})
afterAll(async () => db?.drop())

function state(sort: string, dir: "asc" | "desc", page: number): TableState {
    return { page, pageSize: 2, sort, dir, density: "compact", filters: {} }
}

async function skus(sort: string, dir: "asc" | "desc") {
    const { listProducts } = await import("@/lib/services/product-list-service")
    const first = await listProducts(state(sort, dir, 1))
    const second = await listProducts(state(sort, dir, 2))
    return [...first.rows, ...second.rows].map((row) => row.sku)
}

describe("product list sorting spans every page", () => {
    it("sorts by available stock across the whole result, not within one page", async () => {
        expect(await skus("stock", "desc")).toEqual(["nl-test-10w", "nl-single", "nl-test-5w"])
        expect(await skus("stock", "asc")).toEqual(["nl-test-5w", "nl-single", "nl-test-10w"])
    })

    it("sorts by the English name, not the SKU", async () => {
        expect(await skus("name", "asc")).toEqual(["nl-test-5w", "nl-single", "nl-test-10w"])
        expect(await skus("name", "desc")).toEqual(["nl-test-10w", "nl-single", "nl-test-5w"])
    })
})
