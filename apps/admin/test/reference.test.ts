import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { seedFixture, seedStock, type Fixture } from "@repo/database/test-fixtures"

let db: TestDatabase
let fixture: Fixture

const holder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock("@repo/database", async () => {
    const actual = await vi.importActual<typeof import("@repo/database")>("@repo/database")
    return { ...actual, get prisma() { return holder.client } }
})

beforeAll(async () => {
    db = await createTestDatabase()
    holder.client = db.prisma
})
afterAll(async () => db?.drop())

beforeEach(async () => {
    await db.prisma.adminAuditLog.deleteMany()
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

async function services() {
    return import("@/lib/services/reference-service")
}

describe("families scatter rather than destroy", () => {
    it("archiving a family makes its products standalone, and reports how many", async () => {
        const { FamilyService } = await services()
        const result = await FamilyService.archive(fixture.familyId)

        expect(result.scattered).toBe(2)
        const orphans = await db.prisma.product.findMany({
            where: { id: { in: [fixture.products.small, fixture.products.large] } },
            select: { familyId: true },
        })
        expect(orphans.map((o) => o.familyId)).toEqual([null, null])

        const audit = await db.prisma.adminAuditLog.findFirstOrThrow({ where: { action: "family.archive" } })
        expect(audit.diff).toMatchObject({ productsScattered: 2 })
    })

    it("refuses to move a product into a family from another sub-category", async () => {
        const { FamilyService } = await services()
        const otherCategory = await db.prisma.category.create({
            data: { translations: { create: [{ locale: "en", slug: "outdoor-x", name: "Outdoor" }, { locale: "ar", slug: "خارجي-x", name: "خارجي" }] } },
        })
        const otherSub = await db.prisma.subCategory.create({
            data: {
                categoryId: otherCategory.id,
                translations: { create: [{ locale: "en", slug: "bollard-x", name: "Bollard" }, { locale: "ar", slug: "بولارد-x", name: "بولارد" }] },
            },
        })
        const foreign = await FamilyService.create({
            subCategoryId: otherSub.id,
            slug: "nl-foreign",
            variantType: "wattage",
            nameEn: "Foreign",
            nameAr: "غريب",
            order: 0,
        })

        await expect(
            FamilyService.setProductFamily(fixture.products.single, foreign.id, "5w")
        ).rejects.toThrow(/different sub-category/)
    })

    it("moves a product into a family within its own sub-category", async () => {
        const { FamilyService } = await services()
        await FamilyService.setProductFamily(fixture.products.single, fixture.familyId, "20w")

        const product = await db.prisma.product.findUniqueOrThrow({ where: { id: fixture.products.single } })
        expect(product.familyId).toBe(fixture.familyId)
        expect(product.variantValue).toBe("20w")
    })

    it("refuses a variant value another product in the family already uses", async () => {
        const { FamilyService } = await services()

        await expect(
            FamilyService.setProductFamily(fixture.products.single, fixture.familyId, "5W")
        ).rejects.toThrow(/nl-test-5w already uses the variant "5W"/)
        const product = await db.prisma.product.findUniqueOrThrow({ where: { id: fixture.products.single } })
        expect(product.familyId).toBeNull()
    })

    it("lets a product keep its own variant value when re-saved", async () => {
        const { FamilyService } = await services()
        await FamilyService.setProductFamily(fixture.products.small, fixture.familyId, "5w")

        const product = await db.prisma.product.findUniqueOrThrow({ where: { id: fixture.products.small } })
        expect(product.variantValue).toBe("5w")
    })

    it("frees the value once the product holding it is archived", async () => {
        const { FamilyService } = await services()
        await db.prisma.product.update({ where: { id: fixture.products.small }, data: { deletedAt: new Date() } })

        await FamilyService.setProductFamily(fixture.products.single, fixture.familyId, "5w")
        const product = await db.prisma.product.findUniqueOrThrow({ where: { id: fixture.products.single } })
        expect(product.familyId).toBe(fixture.familyId)
    })
})

describe("a colour cannot be deleted out from under the products wearing it", () => {
    it("refuses while a product offers it, and points at deactivating", async () => {
        const { ColorService } = await services()
        const black = await db.prisma.productColor.findUniqueOrThrow({ where: { key: "BLACK" } })

        await expect(ColorService.remove(black.id)).rejects.toThrow(/Deactivate it instead/)
        expect(await db.prisma.productColor.count({ where: { id: black.id } })).toBe(1)
        expect(await db.prisma.productAvailableColor.count({ where: { colorId: black.id } })).toBe(3)
    })

    it("deletes one nothing uses", async () => {
        const { ColorService } = await services()
        const created = await ColorService.create({
            key: "BRONZE",
            hex: "#8C7853",
            nameEn: "Bronze",
            nameAr: "برونزي",
            order: 90,
        })
        await ColorService.remove(created.id)
        expect(await db.prisma.productColor.count({ where: { key: "BRONZE" } })).toBe(0)
    })

    it("validates the key and the hex", async () => {
        const { ColorService } = await services()
        await expect(
            ColorService.create({ key: "soft white", hex: "#FFFFFF", nameEn: "W", nameAr: "أ", order: 0 })
        ).rejects.toThrow(/not a valid key/)
        await expect(
            ColorService.create({ key: "SOFT_WHITE", hex: "white", nameEn: "W", nameAr: "أ", order: 0 })
        ).rejects.toThrow(/not a hex colour/)
    })

    it("sets which colours a product is offered in", async () => {
        const { ColorService } = await services()
        const [black, gold] = await Promise.all([
            db.prisma.productColor.findUniqueOrThrow({ where: { key: "BLACK" } }),
            db.prisma.productColor.findUniqueOrThrow({ where: { key: "GOLD" } }),
        ])

        await ColorService.setForProduct(fixture.products.single, [gold.id, black.id])
        const assigned = await db.prisma.productAvailableColor.findMany({
            where: { productId: fixture.products.single },
            orderBy: { order: "asc" },
        })
        expect(assigned.map((a) => a.colorId)).toEqual([gold.id, black.id])
    })
})

describe("a location cannot be deleted once stock has moved through it", () => {
    it("refuses the default outright", async () => {
        const { LocationService } = await services()
        const main = await db.prisma.location.findUniqueOrThrow({ where: { id: "location_main" } })
        await expect(LocationService.remove(main.id)).rejects.toThrow(/default location/)
    })

    it("refuses one with movements, because those movements are the history", async () => {
        const { LocationService } = await services()
        await seedStock(db.prisma, fixture.products.small, 10)

        const second = await LocationService.create("Overflow shelf")
        await LocationService.setDefault(second.id)

        await expect(LocationService.remove("location_main")).rejects.toThrow(/stock movement/)
    })

    it("keeps exactly one default", async () => {
        const { LocationService } = await services()
        const second = await LocationService.create("Second warehouse")
        await LocationService.setDefault(second.id)

        const defaults = await db.prisma.location.findMany({ where: { isDefault: true }, select: { id: true } })
        expect(defaults).toHaveLength(1)
        expect(defaults[0]!.id).toBe(second.id)
    })

    it("deletes one that never held anything", async () => {
        const { LocationService } = await services()
        const spare = await LocationService.create("Spare")
        await LocationService.remove(spare.id)
        expect(await db.prisma.location.count({ where: { id: spare.id } })).toBe(0)
    })
})
