import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { seedFixture, seedStock, type Fixture } from "@repo/database/test-fixtures"
import { serializeMoney } from "@repo/database"
import { productCardInclude, productDetailInclude } from "@/lib/services/selectors"

let db: TestDatabase
let fixture: Fixture

beforeAll(async () => {
    db = await createTestDatabase()
    fixture = await seedFixture(db.prisma)
    await seedStock(db.prisma, fixture.products.small, 25)
    await seedStock(db.prisma, fixture.products.large, 0)
})
afterAll(async () => db?.drop())

describe("spec assembly (§7)", () => {
    it("renders a label and unit in each locale, from SpecDefinition", async () => {
        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            include: productDetailInclude("ar"),
        })

        const wattage = product.specs.find((s) => s.specKey === "maximum_wattage")!
        expect(wattage.spec.labelAr).toBe("أقصى قوة كهربائية")
        expect(wattage.spec.labelEn).toBe("Maximum Wattage")
        expect(wattage.spec.unitAr).toBe("W")
        expect(wattage.valueAr).toBe("٥")
        expect(wattage.valueEn).toBe("5")
        expect(wattage.valueNumber?.toString()).toBe("5")
    })

    it("carries the per-locale unit that forced unitEn/unitAr to exist (A2)", async () => {
        const lifetime = await db.prisma.specDefinition.findUniqueOrThrow({ where: { key: "life_time" } })
        expect(lifetime.unitEn).toBe("hours")
        expect(lifetime.unitAr).toBe("ساعة")
        expect(lifetime.unitEn).not.toBe(lifetime.unitAr)
    })

    it("stores IP as TEXT so the row reads IP20, not 20 (A1)", async () => {
        const definition = await db.prisma.specDefinition.findUniqueOrThrow({ where: { key: "ip_rating" } })
        expect(definition.valueType).toBe("TEXT")
        expect(definition.unitEn).toBeNull()

        const spec = await db.prisma.productSpec.findFirstOrThrow({
            where: { productId: fixture.products.small, specKey: "ip_rating" },
        })
        expect(spec.valueEn).toBe("IP20")
    })

    it("orders specs by SpecDefinition.order, with lighting_type first (round-3 review)", async () => {
        const definitions = await db.prisma.specDefinition.findMany({ orderBy: { order: "asc" } })
        expect(definitions[0]!.key).toBe("lighting_type")
        expect(definitions[0]!.order).toBe(5)
        expect(definitions[1]!.key).toBe("voltage")
        expect(definitions.map((d) => d.order)).toEqual([...definitions.map((d) => d.order)].sort((a, b) => a - b))
    })

    it("carries a data defect across verbatim rather than repairing it (N4)", async () => {
        const spec = await db.prisma.productSpec.findFirstOrThrow({
            where: { productId: fixture.products.single, specKey: "main_material" },
        })
        expect(spec.valueBool).toBe(false)
        expect(spec.valueEn).toBe("false")
    })

    it("uses the composite index for a spec query rather than scanning JSONB", async () => {
        const plan = await db.prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
            `EXPLAIN SELECT * FROM product_specs WHERE "specKey" = 'ip_rating' AND "valueEn" = 'IP65'`
        )
        expect(plan.map((r) => r["QUERY PLAN"]).join(" ")).toMatch(/Index|Bitmap/)
    })
})

describe("family grouping (§6)", () => {
    it("groups variants by a real relation, not a SKU prefix", async () => {
        const family = await db.prisma.productFamily.findUniqueOrThrow({
            where: { id: fixture.familyId },
            include: { products: { orderBy: { displayOrder: "asc" } } },
        })
        expect(family.products).toHaveLength(2)
        expect(family.variantType).toBe("wattage")
        expect(family.products.map((p) => p.productId).sort()).toEqual(["nl-test-10w", "nl-test-5w"])
    })

    it("leaves a singleton without a family, rather than inventing one", async () => {
        const single = await db.prisma.product.findUniqueOrThrow({ where: { id: fixture.products.single } })
        expect(single.familyId).toBeNull()
    })

    it("collapses a listing to one card per family", async () => {
        const products = await db.prisma.product.findMany({
            where: { subCategoryId: fixture.subCategoryId, isActive: true, deletedAt: null },
            include: productCardInclude("en"),
        })
        const seen = new Set<string>()
        const cards = products.filter((p) => {
            const key = p.familyId ?? p.id
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        expect(products).toHaveLength(3)
        expect(cards).toHaveLength(2)
    })

    it("dissolving a family does not delete its products (ON DELETE SET NULL)", async () => {
        const spare = await db.prisma.productFamily.create({
            data: { subCategoryId: fixture.subCategoryId, slug: `spare-${Date.now()}` },
        })
        const product = await db.prisma.product.create({
            data: {
                productId: `spare-${Date.now()}`, slug: `spare-${Date.now()}`,
                subCategoryId: fixture.subCategoryId, familyId: spare.id, price: "1.00",
            },
        })
        await db.prisma.productFamily.delete({ where: { id: spare.id } })
        const after = await db.prisma.product.findUnique({ where: { id: product.id } })
        expect(after).not.toBeNull()
        expect(after!.familyId).toBeNull()
    })
})

describe("image ordering (§5)", () => {
    it("treats order 0 as primary, with no isPrimary flag to disagree with it", async () => {
        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            include: productCardInclude("en"),
        })
        expect(product.images[0]!.order).toBe(0)
        expect(product.images[0]!.url).toBe("/nl-test-5w-0.png")
        // A card loads only its primary photo; the product page keeps the whole gallery.
        expect(product.images.map((i) => i.order)).toEqual([0])
        expect("isPrimary" in product.images[0]!).toBe(false)

        const detail = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            include: productDetailInclude("en"),
        })
        expect(detail.images.map((i) => i.order)).toEqual([0, 1])
    })

    it("carries dimensions when they are known and null when they are not", async () => {
        const images = await db.prisma.productImage.findMany({
            where: { productId: fixture.products.small },
            orderBy: { order: "asc" },
        })
        expect(images[0]!.width).toBe(800)
        expect(images[1]!.width).toBeNull()
    })
})

describe("the category tree", () => {
    it("resolves a category by (locale, slug), independently per language", async () => {
        const en = await db.prisma.categoryTranslation.findUnique({ where: { locale_slug: { locale: "en", slug: "indoor" } } })
        const ar = await db.prisma.categoryTranslation.findUnique({ where: { locale_slug: { locale: "ar", slug: "اضاءه-داخليه" } } })
        expect(en?.categoryId).toBe(fixture.categoryId)
        expect(ar?.categoryId).toBe(fixture.categoryId)
        expect(en!.slug).not.toBe(ar!.slug)
    })

    it("refuses two categories sharing a slug within a locale", async () => {
        await expect(
            db.prisma.categoryTranslation.create({
                data: { categoryId: fixture.categoryId, locale: "en", slug: "indoor", name: "Duplicate" },
            })
        ).rejects.toThrow()
    })

    it("allows the same slug string in different locales", async () => {
        const category = await db.prisma.category.create({ data: {} })
        await db.prisma.categoryTranslation.createMany({
            data: [
                { categoryId: category.id, locale: "en", slug: "shared-slug", name: "EN" },
                { categoryId: category.id, locale: "ar", slug: "shared-slug", name: "AR" },
            ],
        })
        expect(await db.prisma.categoryTranslation.count({ where: { slug: "shared-slug" } })).toBe(2)
        await db.prisma.category.delete({ where: { id: category.id } })
    })
})

describe("availability (§13.4)", () => {
    it("is onHand minus reserved, from the ledger", async () => {
        const level = await db.prisma.stockLevel.findUniqueOrThrow({
            where: { productId_locationId: { productId: fixture.products.small, locationId: "location_main" } },
        })
        expect(level.onHand - level.reserved).toBe(25)
    })

    it("reports a product with zero stock as out of stock, not as missing", async () => {
        const level = await db.prisma.stockLevel.findUniqueOrThrow({
            where: { productId_locationId: { productId: fixture.products.large, locationId: "location_main" } },
        })
        expect(level.onHand).toBe(0)
        expect(Math.max(0, level.onHand - level.reserved) > 0).toBe(false)
    })
})

describe("money at the boundary", () => {
    it("serialises a price as a string, exactly", async () => {
        const product = await db.prisma.product.findUniqueOrThrow({ where: { id: fixture.products.large } })
        expect(serializeMoney(product.price)).toBe("199.50")
        expect(typeof serializeMoney(product.price)).toBe("string")
    })
})
