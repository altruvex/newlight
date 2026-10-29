import {
    prisma,
    requireSlug,
    money,
    serializeMoney,
    recordMovement,
    DEFAULT_LOCATION_ID,
    type Locale,
} from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { revalidateStorefront } from "@/lib/revalidate"
import { variantClash } from "@/lib/services/reference-service"

export interface DeletionBlockers {
    orderItems: number
    cartItems: number
    configurations: number
}

export class CatalogError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "CatalogError"
    }
}

export class CatalogService {
    static async deletionBlockers(productId: string): Promise<DeletionBlockers> {
        await requireCurrentAdmin()
        const [orderItems, cartItems, configurations] = await Promise.all([
            prisma.orderItem.count({ where: { productId } }),
            prisma.cartItem.count({ where: { productId } }),
            prisma.productConfiguration.count({ where: { productId } }),
        ])
        return { orderItems, cartItems, configurations }
    }

    static async softDelete(productId: string) {
        const admin = await requireCurrentAdmin()

        const product = await prisma.$transaction(async (tx) => {
            const updated = await tx.product.update({
                where: { id: productId },
                data: { deletedAt: new Date(), isActive: false },
                select: { id: true, productId: true, slug: true },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.soft_delete",
                    entity: "Product",
                    entityId: productId,
                    diff: { sku: updated.productId, reversible: true },
                },
            })
            return updated
        })

        await revalidateStorefront({ kind: "all" })
        return product
    }

    static async restore(productId: string) {
        const admin = await requireCurrentAdmin()
        const product = await prisma.$transaction(async (tx) => {
            const updated = await tx.product.update({
                where: { id: productId },
                data: { deletedAt: null },
                select: { id: true, productId: true },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.restore",
                    entity: "Product",
                    entityId: productId,
                    diff: { sku: updated.productId },
                },
            })
            return updated
        })
        await revalidateStorefront({ kind: "all" })
        return product
    }

    static async hardDelete(productId: string) {
        const admin = await requireCurrentAdmin()
        const blockers = await this.deletionBlockers(productId)
        const total = blockers.orderItems + blockers.cartItems + blockers.configurations

        if (total > 0) {
            throw new CatalogError(
                `this product cannot be hard-deleted: ${blockers.orderItems} order item(s), ` +
                    `${blockers.cartItems} cart item(s) and ${blockers.configurations} configuration(s) refer to it. ` +
                    `Soft-delete it instead — every order that mentions it stays readable.`
            )
        }

        const movements = await prisma.stockMovement.count({ where: { productId } })
        if (movements > 0) {
            throw new CatalogError(
                `this product has ${movements} stock movement(s). Deleting it would destroy the record of ` +
                    `stock that physically moved. Soft-delete it instead.`
            )
        }

        const product = await prisma.$transaction(async (tx) => {
            const target = await tx.product.findUniqueOrThrow({
                where: { id: productId },
                select: { productId: true, slug: true },
            })
            await tx.product.delete({ where: { id: productId } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.hard_delete",
                    entity: "Product",
                    entityId: productId,
                    diff: { sku: target.productId, slug: target.slug, irreversible: true },
                },
            })
            return target
        })

        await revalidateStorefront({ kind: "all" })
        return product
    }

    static async rename(productId: string, nextSlug: string) {
        const admin = await requireCurrentAdmin()
        const slug = requireSlug(nextSlug, `product ${productId}`)

        const result = await prisma.$transaction(async (tx) => {
            const current = await tx.product.findUniqueOrThrow({
                where: { id: productId },
                select: { slug: true, productId: true },
            })
            if (current.slug === slug) return { slug, changed: false }

            // The new slug may be one of this product's own old addresses. It stops being a
            // redirect the moment it is live again, and the slug being vacated becomes one — an
            // upsert because a slug that was live, retired and revived can already have a row.
            await tx.productSlugHistory.deleteMany({ where: { slug } })
            await tx.productSlugHistory.upsert({
                where: { slug: current.slug },
                create: { productId, slug: current.slug },
                update: { productId },
            })
            await tx.product.update({ where: { id: productId }, data: { slug } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.rename",
                    entity: "Product",
                    entityId: productId,
                    diff: { sku: current.productId, from: current.slug, to: slug, redirect: "301" },
                },
            })
            return { slug, changed: true }
        })

        if (result.changed) await revalidateStorefront({ kind: "all" })
        return result
    }

    static async assertSnapshotsIntact(): Promise<Array<{ orderNumber: string; recorded: string; fromItems: string }>> {
        await requireCurrentAdmin()
        return prisma.$queryRaw<Array<{ orderNumber: string; recorded: string; fromItems: string }>>`
            SELECT o."orderNumber",
                   (o.subtotal)::text     AS recorded,
                   (SUM(i.price * i.quantity))::text AS "fromItems"
              FROM orders o
              JOIN order_items i ON i."orderId" = o.id
             GROUP BY o.id, o."orderNumber", o.subtotal
            HAVING o.subtotal <> SUM(i.price * i.quantity)`
    }

    static async dataQualityQueue(locale: Locale = "en") {
        await requireCurrentAdmin()

        const [missingTranslations, placeholderSpecs, booleanSpecs, noImages, noColors] = await Promise.all([
            prisma.product.findMany({
                where: { deletedAt: null, translations: { none: { locale } } },
                select: { id: true, productId: true },
                orderBy: { productId: "asc" },
            }),
            prisma.productSpec.count({ where: { valueEn: "-" } }),
            prisma.productSpec.findMany({
                where: { valueBool: { not: null } },
                select: { specKey: true, product: { select: { productId: true } } },
                orderBy: [{ productId: "asc" }, { specKey: "asc" }],
            }),
            prisma.product.findMany({
                where: { deletedAt: null, images: { none: {} } },
                select: { id: true, productId: true },
                orderBy: { productId: "asc" },
            }),
            prisma.product.findMany({
                where: { deletedAt: null, availableColors: { none: {} } },
                select: { id: true, productId: true },
                orderBy: { productId: "asc" },
            }),
        ])

        const arabicTaxonomy = await prisma.subCategoryTranslation.findMany({
            where: { locale: "ar" },
            select: { subCategoryId: true, name: true, slug: true },
            orderBy: { slug: "asc" },
        })
        const taxonomyDefects = arabicTaxonomy
            .filter((row) => /[A-Za-z]/.test(row.name) || row.name !== row.name.trim())
            .map((row) => ({
                subCategoryId: row.subCategoryId,
                slug: row.slug,
                name: row.name,
                untrimmed: row.name !== row.name.trim(),
                containsLatin: /[A-Za-z]/.test(row.name),
            }))

        return {
            missingTranslations,
            taxonomyDefects,
            placeholderSpecs,
            booleanSpecs,
            noImages,
            noColors,
        }
    }
}

export interface NewProductInput {
    sku: string
    slug: string
    subCategoryId: string
    familyId: string | null
    variantValue: string | null
    price: string
    colorTemperatures: string[]
    nameEn: string
    nameAr: string
    descriptionEn: string | null
    descriptionAr: string | null
    openingStock: number | null
}

export class CatalogCreationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "CatalogCreationError"
    }
}

export async function createProduct(input: NewProductInput) {
    const admin = await requireCurrentAdmin()

    const sku = input.sku.trim()
    if (!sku) throw new CatalogCreationError("A product needs a SKU.")
    if (!input.nameEn.trim() || !input.nameAr.trim()) {
        throw new CatalogCreationError("A product needs a name in both English and Arabic.")
    }

    const slug = requireSlug(input.slug.trim() || sku, `product ${sku}`)

    let price: string
    try {
        price = serializeMoney(money(input.price))
    } catch {
        throw new CatalogCreationError(`"${input.price}" is not a price.`)
    }
    if (Number(price) <= 0) throw new CatalogCreationError("A price must be greater than zero.")

    const [bySku, bySlug] = await Promise.all([
        prisma.product.findUnique({ where: { productId: sku }, select: { id: true, deletedAt: true } }),
        prisma.product.findUnique({ where: { slug }, select: { id: true } }),
    ])
    if (bySku) {
        throw new CatalogCreationError(
            bySku.deletedAt
                ? `SKU ${sku} belongs to an archived product. Restore that one instead of creating a duplicate.`
                : `SKU ${sku} already exists.`
        )
    }
    if (bySlug) throw new CatalogCreationError(`The URL /${slug} is already taken.`)
    if (input.familyId) {
        const clash = await variantClash(input.familyId, input.variantValue)
        if (clash) throw new CatalogCreationError(clash)
    }

    const product = await prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
            data: {
                productId: sku,
                slug,
                subCategoryId: input.subCategoryId,
                familyId: input.familyId,
                variantValue: input.variantValue?.trim() || null,
                price,
                colorTemperatures: input.colorTemperatures as never,
                isActive: false,
                translations: {
                    create: [
                        {
                            locale: "en",
                            name: input.nameEn.trim(),
                            description: input.descriptionEn?.trim() || null,
                        },
                        {
                            locale: "ar",
                            name: input.nameAr.trim(),
                            description: input.descriptionAr?.trim() || null,
                        },
                    ],
                },
            },
            select: { id: true, productId: true, slug: true },
        })

        if (input.openingStock && input.openingStock > 0) {
            await recordMovement(tx, {
                productId: created.id,
                locationId: DEFAULT_LOCATION_ID,
                type: "INITIAL",
                quantity: input.openingStock,
                unitCost: null,
                reason: "opening stock at creation",
                referenceType: "manual",
                referenceId: `${admin.id}:${Date.now()}`,
                actorType: "ADMIN",
                actorId: admin.id,
            })
        }

        await tx.adminAuditLog.create({
            data: {
                actorType: "ADMIN",
                actorId: admin.id,
                actorEmail: admin.email,
                action: "product.create",
                entity: "Product",
                entityId: created.id,
                diff: { sku, slug, price, openingStock: input.openingStock ?? 0 },
            },
        })

        return created
    })

    await revalidateStorefront({ kind: "all" })
    return product
}
