import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { seedFixture, seedStock, type Fixture } from "@repo/database/test-fixtures"

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
    await db.prisma.orderItem.deleteMany()
    await db.prisma.order.deleteMany()
    await db.prisma.cartItem.deleteMany()
    await db.prisma.cart.deleteMany()
    await db.prisma.stockMovement.deleteMany()
    await db.prisma.stockLevel.deleteMany()
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

async function catalog() {
    return (await import("@/lib/services/catalog-service")).CatalogService
}
async function translations() {
    return (await import("@/lib/services/translation-service")).TranslationService
}

async function placeOrder(productId: string, price: string, quantity = 2) {
    return db.prisma.order.create({
        data: {
            userId: fixture.userId,
            orderNumber: `NL-${Math.random().toString(36).slice(2, 8)}`,
            idempotencyKey: Math.random().toString(36).slice(2),
            subtotal: (Number(price) * quantity).toFixed(2),
            shippingCost: "0.00",
            total: (Number(price) * quantity).toFixed(2),
            items: {
                create: [{ productId, productName: "snapshot", productImage: "/x.png", price, quantity }],
            },
        },
        select: { id: true },
    })
}

describe("soft delete is the default", () => {
    it("hides the product without removing it, and restore reverses it", async () => {
        const CatalogService = await catalog()

        await CatalogService.softDelete(fixture.products.small)
        const deleted = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { deletedAt: true, isActive: true },
        })
        expect(deleted.deletedAt).not.toBeNull()
        expect(deleted.isActive).toBe(false)

        await CatalogService.restore(fixture.products.small)
        const restored = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { deletedAt: true },
        })
        expect(restored.deletedAt).toBeNull()

        const actions = await db.prisma.adminAuditLog.findMany({ select: { action: true }, orderBy: { createdAt: "asc" } })
        expect(actions.map((a) => a.action)).toEqual(["product.soft_delete", "product.restore"])
    })

    it("refuses to restore a product whose variant value was taken while it was archived", async () => {
        const CatalogService = await catalog()

        await CatalogService.softDelete(fixture.products.small)
        await db.prisma.product.update({
            where: { id: fixture.products.single },
            data: { familyId: fixture.familyId, variantValue: "5w" },
        })

        await expect(CatalogService.restore(fixture.products.small)).rejects.toThrow(
            /nl-single already uses the variant "5w".*before restoring it/
        )
        const still = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { deletedAt: true },
        })
        expect(still.deletedAt).not.toBeNull()
    })
})

describe("hard delete refuses while anything still refers to the product", () => {
    it("refuses when an order line refers to it, and names the blocker", async () => {
        const CatalogService = await catalog()
        await placeOrder(fixture.products.small, "150.00")

        await expect(CatalogService.hardDelete(fixture.products.small)).rejects.toThrow(/1 order item/)

        expect(await db.prisma.product.count({ where: { id: fixture.products.small } })).toBe(1)
    })

    it("refuses when a cart refers to it", async () => {
        const CatalogService = await catalog()
        const cart = await db.prisma.cart.create({ data: { userId: fixture.userId } })
        await db.prisma.cartItem.create({ data: { cartId: cart.id, productId: fixture.products.single } })

        await expect(CatalogService.hardDelete(fixture.products.single)).rejects.toThrow(/1 cart item/)
    })

    it("refuses when stock physically moved, even with no orders", async () => {
        const CatalogService = await catalog()
        await seedStock(db.prisma, fixture.products.large, 40)

        await expect(CatalogService.hardDelete(fixture.products.large)).rejects.toThrow(/stock movement/)
    })

    it("allows it when nothing refers to the product, and records what was destroyed", async () => {
        const CatalogService = await catalog()
        await CatalogService.hardDelete(fixture.products.large)

        expect(await db.prisma.product.count({ where: { id: fixture.products.large } })).toBe(0)
        const row = await db.prisma.adminAuditLog.findFirstOrThrow({ where: { action: "product.hard_delete" } })
        expect(row.diff).toMatchObject({ sku: fixture.skus.large, irreversible: true })
    })
})

describe("renaming keeps the old URL alive", () => {
    it("writes the previous slug to history in the same transaction", async () => {
        const CatalogService = await catalog()
        await CatalogService.rename(fixture.products.small, "nl-test-5w-renamed")

        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { slug: true },
        })
        expect(product.slug).toBe("nl-test-5w-renamed")

        const history = await db.prisma.productSlugHistory.findMany({
            where: { productId: fixture.products.small },
            select: { slug: true },
        })
        expect(history.map((h) => h.slug).sort()).toEqual(["nl-test-5w", "nl-test-5w-old"])
    })

    it("is a no-op when the slug is unchanged, so history stays honest", async () => {
        const CatalogService = await catalog()
        const before = await db.prisma.productSlugHistory.count()
        await CatalogService.rename(fixture.products.small, "nl-test-5w")
        expect(await db.prisma.productSlugHistory.count()).toBe(before)
    })

    it("can revive one of its own old slugs, and then retire it again", async () => {
        const CatalogService = await catalog()
        await CatalogService.rename(fixture.products.small, "nl-test-5w-renamed")
        await CatalogService.rename(fixture.products.small, "nl-test-5w")
        await CatalogService.rename(fixture.products.small, "nl-test-5w-renamed")

        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { slug: true },
        })
        expect(product.slug).toBe("nl-test-5w-renamed")

        const history = await db.prisma.productSlugHistory.findMany({
            where: { productId: fixture.products.small },
            select: { slug: true },
        })
        // The live slug is never also a redirect.
        expect(history.map((h) => h.slug).sort()).toEqual(["nl-test-5w", "nl-test-5w-old"])
    })
})

describe("money snapshots are immutable (§13.2 item 4)", () => {
    it("repricing a product never rewrites what a customer was charged", async () => {
        const CatalogService = await catalog()
        const PricingService = (await import("@/lib/services/pricing-service")).PricingService
        await placeOrder(fixture.products.small, "150.00", 2)

        const scope = { kind: "products", productIds: [fixture.products.small] } as const
        const formula = { kind: "percent", percent: "100" } as const
        const preview = await PricingService.preview(scope, formula)
        await PricingService.apply(scope, formula, preview.token)

        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { price: true },
        })
        expect(product.price.toFixed(2)).toBe("300.00")

        const item = await db.prisma.orderItem.findFirstOrThrow({ where: { productId: fixture.products.small } })
        expect(item.price.toFixed(2)).toBe("150.00")

        expect(await CatalogService.assertSnapshotsIntact()).toEqual([])
    })
})

describe("translations never silently fall back", () => {
    it("reports a missing locale as missing rather than borrowing English", async () => {
        const TranslationService = await translations()
        await db.prisma.productTranslation.deleteMany({
            where: { productId: fixture.products.single, locale: "ar" },
        })

        const paired = await TranslationService.forProduct(fixture.products.single)
        expect(paired.locales.ar.exists).toBe(false)
        expect(paired.locales.ar.name).toBeNull()
        expect(paired.locales.en.description).toBe("nl-single description")
        expect(paired.completeness.ar.missing).toEqual(["name", "description", "metaTitle", "metaDescription"])
    })

    it("counts a name that is just the SKU as untranslated (A26)", async () => {
        const TranslationService = await translations()
        const paired = await TranslationService.forProduct(fixture.products.small)

        expect(paired.locales.en.name).toBe(fixture.skus.small)
        expect(paired.completeness.en.missing).toContain("name")
        expect(paired.completeness.en.filled).toBe(1)
    })

    it("marks Arabic as RTL so the editor does not hard-code a language check", async () => {
        const TranslationService = await translations()
        const paired = await TranslationService.forProduct(fixture.products.small)
        expect(paired.locales.ar.dir).toBe("rtl")
        expect(paired.locales.en.dir).toBe("ltr")
    })

    it("saves both locales in one transaction", async () => {
        const TranslationService = await translations()
        await TranslationService.saveProduct(fixture.products.small, {
            en: { name: "5W Panel Light", description: "Recessed", metaTitle: null, metaDescription: null },
            ar: { name: "بانل لايت ٥ وات", description: "غائر", metaTitle: null, metaDescription: null },
        })

        const paired = await TranslationService.forProduct(fixture.products.small)
        expect(paired.locales.en.name).toBe("5W Panel Light")
        expect(paired.locales.ar.name).toBe("بانل لايت ٥ وات")
        expect(paired.completeness.ar.missing).toEqual(["metaTitle", "metaDescription"])
    })

    it("orders the queue worst-first: an absent locale outranks a missing meta field", async () => {
        const TranslationService = await translations()
        await db.prisma.productTranslation.deleteMany({
            where: { productId: fixture.products.large, locale: "ar" },
        })
        await TranslationService.saveProduct(fixture.products.small, {
            en: { name: "5W Panel", description: "d", metaTitle: "t", metaDescription: null },
            ar: { name: "بانل ٥", description: "و", metaTitle: "ع", metaDescription: null },
        })

        const queue = await TranslationService.queue()
        expect(queue.rows[0].reference).toBe(fixture.skus.large)
        expect(queue.rows[0].absentLocales).toEqual(["ar"])
        expect(queue.rows.at(-1)?.reference).toBe(fixture.skus.small)
    })
})

describe("editing one product's price and details", () => {
    it("changes a single price and records it as price history", async () => {
        const { PricingService } = await import("@/lib/services/pricing-service")

        const result = await PricingService.setPrice(fixture.products.small, "175.50")
        expect(result.changed).toBe(true)
        expect(result.price).toBe("175.50")

        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { price: true },
        })
        expect(product.price.toFixed(2)).toBe("175.50")

        const history = await PricingService.priceHistory(fixture.products.small)
        expect(history).toHaveLength(1)
        expect(history[0]).toMatchObject({ from: "150.00", to: "175.50" })
    })

    it("refuses a price of zero rather than storing it", async () => {
        const { PricingService } = await import("@/lib/services/pricing-service")
        await expect(PricingService.setPrice(fixture.products.small, "0")).rejects.toThrow(/greater than zero/)

        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: fixture.products.small },
            select: { price: true },
        })
        expect(product.price.toFixed(2)).toBe("150.00")
    })

    it("shows every spec the sub-category declares, including ones with no value yet", async () => {
        const { SpecService } = await import("@/lib/services/spec-service")

        await db.prisma.subCategorySpec.createMany({
            data: [
                { subCategoryId: fixture.subCategoryId, specKey: "maximum_wattage", required: true, order: 1 },
                { subCategoryId: fixture.subCategoryId, specKey: "beam_angle", required: false, order: 2 },
            ],
        })

        const rows = await SpecService.forProduct(fixture.products.small)
        const byKey = new Map(rows.map((r) => [r.key, r]))

        expect(byKey.get("maximum_wattage")).toMatchObject({ valueEn: "5", declared: true, required: true })
        expect(byKey.get("beam_angle")).toMatchObject({ valueEn: null, declared: true })
        expect(byKey.get("ip_rating")).toMatchObject({ declared: false })
    })

    it("saves specs, deriving the numeric column and normalising IP ratings", async () => {
        const { SpecService } = await import("@/lib/services/spec-service")

        await SpecService.save(fixture.products.small, [
            { key: "maximum_wattage", valueEn: "7.5", valueAr: "٧٫٥" },
            { key: "ip_rating", valueEn: "65", valueAr: "65" },
        ])

        const specs = await db.prisma.productSpec.findMany({
            where: { productId: fixture.products.small, specKey: { in: ["maximum_wattage", "ip_rating"] } },
            orderBy: { specKey: "asc" },
        })

        const ip = specs.find((s) => s.specKey === "ip_rating")!
        expect(ip.valueEn).toBe("IP65")
        expect(ip.valueAr).toBe("IP65")

        const wattage = specs.find((s) => s.specKey === "maximum_wattage")!
        expect(wattage.valueEn).toBe("7.5")
        expect(wattage.valueNumber?.toString()).toBe("7.5")
    })

    it("deletes a spec when both values are cleared, rather than storing a blank", async () => {
        const { SpecService } = await import("@/lib/services/spec-service")

        await SpecService.save(fixture.products.small, [{ key: "hole_size", valueEn: "", valueAr: "" }])

        expect(
            await db.prisma.productSpec.count({
                where: { productId: fixture.products.small, specKey: "hole_size" },
            })
        ).toBe(0)

        const audit = await db.prisma.adminAuditLog.findFirstOrThrow({ where: { action: "product.specs_save" } })
        expect(audit.diff).toMatchObject({ changes: [{ key: "hole_size", from: "-", to: null }] })
    })

    it("keeps a non-numeric value as text instead of rejecting it", async () => {
        const { SpecService } = await import("@/lib/services/spec-service")

        await SpecService.save(fixture.products.small, [{ key: "maximum_wattage", valueEn: "12-15", valueAr: "١٢-١٥" }])

        const spec = await db.prisma.productSpec.findUniqueOrThrow({
            where: { productId_specKey: { productId: fixture.products.small, specKey: "maximum_wattage" } },
        })
        expect(spec.valueEn).toBe("12-15")
        expect(spec.valueNumber).toBeNull()
    })
})

describe("creating a product", () => {
    async function create() {
        return (await import("@/lib/services/catalog-service")).createProduct
    }

    const base = {
        sku: "nl-new-9w",
        slug: "nl-new-9w",
        familyId: null,
        variantValue: null,
        price: "450.00",
        colorTemperatures: ["WARM_3000K"],
        nameEn: "9W Panel Light",
        nameAr: "بانل لايت ٩ وات",
        descriptionEn: "A description",
        descriptionAr: "وصف",
        openingStock: null as number | null,
    }

    it("creates it in both languages, and hidden", async () => {
        const createProduct = await create()
        const result = await createProduct({ ...base, subCategoryId: fixture.subCategoryId })

        const product = await db.prisma.product.findUniqueOrThrow({
            where: { id: result.id },
            include: { translations: { orderBy: { locale: "asc" } } },
        })

        expect(product.isActive).toBe(false)
        expect(product.price.toFixed(2)).toBe("450.00")
        expect(product.translations.map((t) => `${t.locale}:${t.name}`)).toEqual([
            "ar:بانل لايت ٩ وات",
            "en:9W Panel Light",
        ])
    })

    it("refuses a product that has only one language", async () => {
        const createProduct = await create()
        await expect(
            createProduct({ ...base, sku: "nl-en-only", slug: "nl-en-only", subCategoryId: fixture.subCategoryId, nameAr: "  " })
        ).rejects.toThrow(/both English and Arabic/)

        expect(await db.prisma.product.count({ where: { productId: "nl-en-only" } })).toBe(0)
    })

    it("refuses a SKU that already exists, and says which", async () => {
        const createProduct = await create()
        await expect(
            createProduct({ ...base, sku: fixture.skus.small, slug: "something-else", subCategoryId: fixture.subCategoryId })
        ).rejects.toThrow(new RegExp(fixture.skus.small))
    })

    it("points at the archived product rather than letting you duplicate its SKU", async () => {
        const { CatalogService } = await import("@/lib/services/catalog-service")
        const createProduct = await create()
        await CatalogService.softDelete(fixture.products.single)

        await expect(
            createProduct({ ...base, sku: fixture.skus.single, slug: "brand-new-slug", subCategoryId: fixture.subCategoryId })
        ).rejects.toThrow(/archived/)
    })

    it("refuses a price of zero", async () => {
        const createProduct = await create()
        await expect(
            createProduct({ ...base, sku: "nl-free", slug: "nl-free", subCategoryId: fixture.subCategoryId, price: "0" })
        ).rejects.toThrow(/greater than zero/)
    })

    it("writes opening stock through the ledger, never straight to the level", async () => {
        const createProduct = await create()
        const result = await createProduct({
            ...base,
            sku: "nl-with-stock",
            slug: "nl-with-stock",
            subCategoryId: fixture.subCategoryId,
            openingStock: 40,
        })

        const movements = await db.prisma.stockMovement.findMany({ where: { productId: result.id } })
        expect(movements).toHaveLength(1)
        expect(movements[0]).toMatchObject({ type: "INITIAL", quantity: 40, actorType: "ADMIN" })

        const level = await db.prisma.stockLevel.findFirstOrThrow({ where: { productId: result.id } })
        expect(level.onHand).toBe(40)
    })

    it("records the creation in the audit log", async () => {
        const createProduct = await create()
        await createProduct({ ...base, sku: "nl-audited", slug: "nl-audited", subCategoryId: fixture.subCategoryId })

        const row = await db.prisma.adminAuditLog.findFirstOrThrow({ where: { action: "product.create" } })
        expect(row.diff).toMatchObject({ sku: "nl-audited", price: "450.00" })
    })
})
