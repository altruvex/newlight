import { prisma } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { revalidateStorefront } from "@/lib/revalidate"
import { assertValidImage, destroyCloudinaryAsset, uploadImageToCloudinary, MediaError } from "@/lib/cloudinary"

export { MediaError }

function publicIdFor(parts: { categorySlug: string; subCategorySlug: string; sku: string; index: number }): string {
    const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "")
    return `products/${clean(parts.categorySlug)}/${clean(parts.subCategorySlug)}/${clean(parts.sku)}-${parts.index}`
}

// An image's colour is one of the product's own offered colours, or none. Checked before the
// Cloudinary upload so a bad colour does not leave an orphaned asset behind.
async function assertColorOffered(productId: string, colorId: string | null): Promise<void> {
    if (colorId === null) return
    const offered = await prisma.productAvailableColor.findUnique({
        where: { productId_colorId: { productId, colorId } },
        select: { colorId: true },
    })
    if (!offered) throw new MediaError("That colour is not offered on this product. Add it to the product's colours first.")
}

export class MediaService {
    static async forProduct(productId: string) {
        await requireCurrentAdmin()
        const [images, colors] = await Promise.all([
            prisma.productImage.findMany({
                where: { productId },
                orderBy: { order: "asc" },
                include: { color: { select: { id: true, key: true, hex: true } } },
            }),
            prisma.productColor.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true, hex: true } }),
        ])
        return { images, colors }
    }

    static async upload(productId: string, file: File, colorId: string | null) {
        const admin = await requireCurrentAdmin()

        assertValidImage(file)

        const product = await prisma.product.findUniqueOrThrow({
            where: { id: productId },
            select: {
                productId: true,
                subCategory: {
                    select: {
                        translations: { where: { locale: "en" }, select: { slug: true }, take: 1 },
                        category: { select: { translations: { where: { locale: "en" }, select: { slug: true }, take: 1 } } },
                    },
                },
                images: { select: { order: true }, orderBy: { order: "desc" }, take: 1 },
            },
        })

        await assertColorOffered(productId, colorId)

        const nextOrder = (product.images[0]?.order ?? -1) + 1
        const publicId = publicIdFor({
            categorySlug: product.subCategory.category.translations[0]?.slug ?? "uncategorised",
            subCategorySlug: product.subCategory.translations[0]?.slug ?? "uncategorised",
            sku: product.productId,
            index: nextOrder,
        })

        const result = await uploadImageToCloudinary(file, publicId)

        const image = await prisma.$transaction(async (tx) => {
            const created = await tx.productImage.create({
                data: {
                    productId,
                    url: result.secure_url,
                    publicId: result.public_id,
                    order: nextOrder,
                    colorId,
                    width: result.width ?? null,
                    height: result.height ?? null,
                },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.image_upload",
                    entity: "Product",
                    entityId: productId,
                    diff: { sku: product.productId, publicId: result.public_id, order: nextOrder },
                },
            })
            return created
        })

        await revalidateStorefront({ kind: "all" })
        return image
    }

    static async reorder(productId: string, orderedIds: string[]) {
        const admin = await requireCurrentAdmin()

        const existing = await prisma.productImage.findMany({
            where: { productId },
            select: { id: true },
        })
        const known = new Set(existing.map((image) => image.id))
        if (orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id))) {
            throw new MediaError("That ordering does not match this product's images. Reload and try again.")
        }

        await prisma.$transaction(async (tx) => {
            for (const [index, id] of orderedIds.entries()) {
                await tx.productImage.update({ where: { id }, data: { order: -1 - index } })
            }
            for (const [index, id] of orderedIds.entries()) {
                await tx.productImage.update({ where: { id }, data: { order: index } })
            }
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.image_reorder",
                    entity: "Product",
                    entityId: productId,
                    diff: { order: orderedIds },
                },
            })
        })

        await revalidateStorefront({ kind: "all" })
    }

    static async setColor(imageId: string, colorId: string | null) {
        const admin = await requireCurrentAdmin()
        const owner = await prisma.productImage.findUnique({ where: { id: imageId }, select: { productId: true } })
        if (!owner) throw new MediaError("That image no longer exists. Reload and try again.")
        await assertColorOffered(owner.productId, colorId)
        const image = await prisma.$transaction(async (tx) => {
            const updated = await tx.productImage.update({
                where: { id: imageId },
                data: { colorId },
                select: { id: true, productId: true, publicId: true },
            })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.image_color",
                    entity: "Product",
                    entityId: updated.productId,
                    diff: { publicId: updated.publicId, colorId },
                },
            })
            return updated
        })
        await revalidateStorefront({ kind: "all" })
        return image
    }

    static async setAlt(imageId: string, altEn: string | null, altAr: string | null) {
        await requireCurrentAdmin()
        await prisma.productImage.update({
            where: { id: imageId },
            data: {
                altEn: altEn?.trim() ? altEn.trim() : null,
                altAr: altAr?.trim() ? altAr.trim() : null,
            },
        })
        await revalidateStorefront({ kind: "all" })
    }

    static async remove(imageId: string) {
        const admin = await requireCurrentAdmin()

        const image = await prisma.productImage.findUniqueOrThrow({
            where: { id: imageId },
            select: { id: true, productId: true, publicId: true, order: true },
        })

        const siblings = await prisma.productImage.count({
            where: { publicId: image.publicId, id: { not: imageId } },
        })

        await prisma.$transaction(async (tx) => {
            await tx.productImage.delete({ where: { id: imageId } })
            const rest = await tx.productImage.findMany({
                where: { productId: image.productId },
                orderBy: { order: "asc" },
                select: { id: true },
            })
            for (const [index, row] of rest.entries()) {
                await tx.productImage.update({ where: { id: row.id }, data: { order: index } })
            }
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.image_delete",
                    entity: "Product",
                    entityId: image.productId,
                    diff: { publicId: image.publicId, assetKept: siblings > 0 },
                },
            })
        })

        if (siblings === 0) {
            try {
                await destroyCloudinaryAsset(image.publicId)
            } catch (error) {
                logger.error({ err: error, publicId: image.publicId }, "the row is gone but Cloudinary still holds the asset")
            }
        }

        await revalidateStorefront({ kind: "all" })
        return { removed: image.publicId, assetKept: siblings > 0 }
    }
}
