import { prisma, requireSlug, LOCALES, DEFAULT_LOCATION_ID } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { revalidateStorefront } from "@/lib/revalidate"

export class ReferenceError_ extends Error {
    constructor(message: string) {
        super(message)
        this.name = "ReferenceError"
    }
}

// A family renders as one row of option buttons on the storefront, one per variant value, so two
// products sharing a value show up as two identical buttons. Archived products are ignored;
// inactive ones are not, because activating one later would bring the clash back.
// Returns the reason the value is taken, or null when it is free.
export async function variantClash(familyId: string, variantValue: string | null, excludeProductId?: string) {
    const value = variantValue?.trim()
    if (!value) return null
    const clash = await prisma.product.findFirst({
        where: {
            familyId,
            deletedAt: null,
            variantValue: { equals: value, mode: "insensitive" },
            ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
        },
        select: { productId: true },
    })
    return clash
        ? `${clash.productId} already uses the variant "${value}" in this family. Edit or archive that product instead of adding a second one.`
        : null
}

export class FamilyService {
    static async list() {
        await requireCurrentAdmin()
        return prisma.productFamily.findMany({
            where: { deletedAt: null },
            orderBy: [{ subCategoryId: "asc" }, { order: "asc" }, { slug: "asc" }],
            include: {
                translations: true,
                _count: { select: { products: true } },
                subCategory: {
                    select: { id: true, translations: { where: { locale: "en" }, select: { name: true }, take: 1 } },
                },
            },
        })
    }

    static async create(input: {
        subCategoryId: string
        slug: string
        variantType: string | null
        nameEn: string
        nameAr: string
        order: number
    }) {
        const admin = await requireCurrentAdmin()
        const slug = requireSlug(input.slug.trim(), "family")
        if (!input.nameEn.trim() || !input.nameAr.trim()) {
            throw new ReferenceError_("A family needs a name in both English and Arabic.")
        }
        if (await prisma.productFamily.findUnique({ where: { slug }, select: { id: true } })) {
            throw new ReferenceError_(`A family with the URL "${slug}" already exists.`)
        }

        const created = await prisma.$transaction(async (tx) => {
            const family = await tx.productFamily.create({
                data: {
                    subCategoryId: input.subCategoryId,
                    slug,
                    variantType: input.variantType?.trim() || null,
                    order: input.order,
                    translations: {
                        create: LOCALES.map((locale) => ({
                            locale,
                            slug: locale === "en" ? slug : `${slug}-${locale}`,
                            name: locale === "en" ? input.nameEn.trim() : input.nameAr.trim(),
                        })),
                    },
                },
                select: { id: true },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "family.create",
                    entity: "ProductFamily",
                    entityId: family.id,
                    diff: { slug, variantType: input.variantType, subCategoryId: input.subCategoryId },
                },
            })
            return family
        })

        await revalidateStorefront({ kind: "all" })
        return created
    }

    static async update(id: string, input: { variantType: string | null; nameEn: string; nameAr: string; order: number }) {
        const admin = await requireCurrentAdmin()
        if (!input.nameEn.trim() || !input.nameAr.trim()) {
            throw new ReferenceError_("A family needs a name in both English and Arabic.")
        }

        await prisma.$transaction(async (tx) => {
            await tx.productFamily.update({
                where: { id },
                data: { variantType: input.variantType?.trim() || null, order: input.order },
            })
            for (const locale of LOCALES) {
                await tx.productFamilyTranslation.updateMany({
                    where: { familyId: id, locale },
                    data: { name: locale === "en" ? input.nameEn.trim() : input.nameAr.trim() },
                })
            }
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "family.update",
                    entity: "ProductFamily",
                    entityId: id,
                    diff: { nameEn: input.nameEn.trim(), variantType: input.variantType },
                },
            })
        })
        await revalidateStorefront({ kind: "all" })
    }

    static async archive(id: string) {
        const admin = await requireCurrentAdmin()
        const family = await prisma.productFamily.findUniqueOrThrow({
            where: { id },
            select: { slug: true, _count: { select: { products: true } } },
        })

        await prisma.$transaction(async (tx) => {
            await tx.product.updateMany({ where: { familyId: id }, data: { familyId: null } })
            await tx.productFamily.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "family.archive",
                    entity: "ProductFamily",
                    entityId: id,
                    diff: { slug: family.slug, productsScattered: family._count.products },
                },
            })
        })

        await revalidateStorefront({ kind: "all" })
        return { scattered: family._count.products }
    }

    static async setProductFamily(productId: string, familyId: string | null, variantValue: string | null) {
        const admin = await requireCurrentAdmin()
        const product = await prisma.product.findUniqueOrThrow({
            where: { id: productId },
            select: { productId: true, familyId: true, subCategoryId: true },
        })

        if (familyId) {
            const family = await prisma.productFamily.findUniqueOrThrow({
                where: { id: familyId },
                select: { subCategoryId: true, slug: true },
            })
            if (family.subCategoryId !== product.subCategoryId) {
                throw new ReferenceError_(
                    `"${family.slug}" belongs to a different sub-category. Move the product first, or pick a family from its own.`
                )
            }
            const clash = await variantClash(familyId, variantValue, productId)
            if (clash) throw new ReferenceError_(clash)
        }

        await prisma.$transaction(async (tx) => {
            await tx.product.update({
                where: { id: productId },
                data: { familyId, variantValue: variantValue?.trim() || null },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.family",
                    entity: "Product",
                    entityId: productId,
                    diff: { sku: product.productId, from: product.familyId, to: familyId, variantValue },
                },
            })
        })
        await revalidateStorefront({ kind: "all" })
    }
}

export class ColorService {
    static async list() {
        await requireCurrentAdmin()
        return prisma.productColor.findMany({
            orderBy: [{ order: "asc" }, { key: "asc" }],
            include: { _count: { select: { products: true, images: true } } },
        })
    }

    static async create(input: { key: string; hex: string; nameEn: string; nameAr: string; order: number }) {
        const admin = await requireCurrentAdmin()
        const key = input.key.trim().toUpperCase()
        const hex = input.hex.trim().toUpperCase()

        if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
            throw new ReferenceError_(
                `"${input.key}" is not a valid key. Use uppercase letters, digits and underscores — it is a stable identifier, not a label.`
            )
        }
        if (!/^#[0-9A-F]{6}$/.test(hex)) throw new ReferenceError_(`"${input.hex}" is not a hex colour like #1A2B3C.`)
        if (!input.nameEn.trim() || !input.nameAr.trim()) {
            throw new ReferenceError_("A colour needs a name in both English and Arabic.")
        }
        if (await prisma.productColor.findUnique({ where: { key }, select: { id: true } })) {
            throw new ReferenceError_(`A colour called "${key}" already exists.`)
        }

        const created = await prisma.$transaction(async (tx) => {
            const color = await tx.productColor.create({
                data: { key, hex, nameEn: input.nameEn.trim(), nameAr: input.nameAr.trim(), order: input.order },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "color.create",
                    entity: "ProductColor",
                    entityId: color.id,
                    diff: { key, hex, nameEn: color.nameEn },
                },
            })
            return color
        })

        await revalidateStorefront({ kind: "all" })
        return created
    }

    static async update(id: string, input: { hex: string; nameEn: string; nameAr: string; order: number; isActive: boolean }) {
        const admin = await requireCurrentAdmin()
        const hex = input.hex.trim().toUpperCase()
        if (!/^#[0-9A-F]{6}$/.test(hex)) throw new ReferenceError_(`"${input.hex}" is not a hex colour like #1A2B3C.`)
        if (!input.nameEn.trim() || !input.nameAr.trim()) {
            throw new ReferenceError_("A colour needs a name in both English and Arabic.")
        }

        await prisma.$transaction(async (tx) => {
            await tx.productColor.update({
                where: { id },
                data: {
                    hex,
                    nameEn: input.nameEn.trim(),
                    nameAr: input.nameAr.trim(),
                    order: input.order,
                    isActive: input.isActive,
                },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "color.update",
                    entity: "ProductColor",
                    entityId: id,
                    diff: { hex, nameEn: input.nameEn.trim(), isActive: input.isActive },
                },
            })
        })
        await revalidateStorefront({ kind: "all" })
    }

    static async remove(id: string) {
        const admin = await requireCurrentAdmin()
        const color = await prisma.productColor.findUniqueOrThrow({
            where: { id },
            select: { key: true, nameEn: true, _count: { select: { products: true, images: true } } },
        })

        if (color._count.products > 0 || color._count.images > 0) {
            throw new ReferenceError_(
                `${color.nameEn} is offered by ${color._count.products} product(s) and shown in ${color._count.images} photo(s). ` +
                    `Deleting it would remove it from all of them. Deactivate it instead — it stops being offered and nothing is lost.`
            )
        }

        await prisma.$transaction(async (tx) => {
            await tx.productColor.delete({ where: { id } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "color.delete",
                    entity: "ProductColor",
                    entityId: id,
                    diff: { key: color.key, irreversible: true },
                },
            })
        })
        await revalidateStorefront({ kind: "all" })
    }

    static async setForProduct(productId: string, colorIds: string[]) {
        const admin = await requireCurrentAdmin()

        await prisma.$transaction(async (tx) => {
            const before = await tx.productAvailableColor.findMany({
                where: { productId },
                select: { colorId: true },
            })
            await tx.productAvailableColor.deleteMany({ where: { productId } })
            if (colorIds.length > 0) {
                await tx.productAvailableColor.createMany({
                    data: colorIds.map((colorId, order) => ({ productId, colorId, order })),
                })
            }
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.colors",
                    entity: "Product",
                    entityId: productId,
                    diff: { before: before.map((b) => b.colorId).sort(), after: [...colorIds].sort() },
                },
            })
        })
        await revalidateStorefront({ kind: "all" })
    }
}

export class LocationService {
    static async list() {
        await requireCurrentAdmin()
        const locations = await prisma.location.findMany({
            orderBy: [{ isDefault: "desc" }, { name: "asc" }],
            include: { _count: { select: { movements: true, stockLevels: true } } },
        })
        const totals = await prisma.stockLevel.groupBy({ by: ["locationId"], _sum: { onHand: true } })
        const byLocation = new Map(totals.map((t) => [t.locationId, t._sum.onHand ?? 0]))
        return locations.map((location) => ({ ...location, onHand: byLocation.get(location.id) ?? 0 }))
    }

    static async create(name: string) {
        const admin = await requireCurrentAdmin()
        if (!name.trim()) throw new ReferenceError_("A location needs a name.")

        const created = await prisma.$transaction(async (tx) => {
            const location = await tx.location.create({ data: { name: name.trim(), isDefault: false } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "location.create",
                    entity: "Location",
                    entityId: location.id,
                    diff: { name: location.name },
                },
            })
            return location
        })
        return created
    }

    static async rename(id: string, name: string) {
        const admin = await requireCurrentAdmin()
        if (!name.trim()) throw new ReferenceError_("A location needs a name.")
        const before = await prisma.location.findUniqueOrThrow({ where: { id }, select: { name: true } })

        await prisma.$transaction(async (tx) => {
            await tx.location.update({ where: { id }, data: { name: name.trim() } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "location.rename",
                    entity: "Location",
                    entityId: id,
                    diff: { from: before.name, to: name.trim() },
                },
            })
        })
    }

    static async setDefault(id: string) {
        const admin = await requireCurrentAdmin()
        await prisma.$transaction(async (tx) => {
            await tx.location.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
            await tx.location.update({ where: { id }, data: { isDefault: true } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "location.set_default",
                    entity: "Location",
                    entityId: id,
                    diff: { note: `${DEFAULT_LOCATION_ID} is the code default; this changes the database default` },
                },
            })
        })
    }

    static async remove(id: string) {
        const admin = await requireCurrentAdmin()
        const location = await prisma.location.findUniqueOrThrow({
            where: { id },
            select: { name: true, isDefault: true, _count: { select: { movements: true } } },
        })

        if (location.isDefault) {
            throw new ReferenceError_("This is the default location. Make another one the default first.")
        }
        if (location._count.movements > 0) {
            throw new ReferenceError_(
                `${location._count.movements} stock movement(s) happened at ${location.name}. Deleting it would destroy the record of stock that physically moved.`
            )
        }

        await prisma.$transaction(async (tx) => {
            await tx.stockLevel.deleteMany({ where: { locationId: id } })
            await tx.location.delete({ where: { id } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "location.delete",
                    entity: "Location",
                    entityId: id,
                    diff: { name: location.name },
                },
            })
        })
    }
}
