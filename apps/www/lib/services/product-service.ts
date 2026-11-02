import { cleanDescription } from "@/lib/product-description"
import {
    prisma,
    DEFAULT_LOCATION_ID,
    resolveEffectivePrice,
    serializeMoney,
    translationsFor,
    type Locale,
    type SerializedMoney,
} from "@repo/database"
import { liveProduct, productDetailInclude, productLinkedCardInclude, toCardView } from "./selectors"
import { activeDiscounts } from "@/lib/discounts"
import { availableOf, stockStatusOf } from "@/lib/stock"

export class ProductService {
    static async getProductsByIds(skus: string[], locale: Locale) {
        const products = await prisma.product.findMany({
            where: { productId: { in: skus }, ...liveProduct },
            include: productLinkedCardInclude(locale),
        })

        const bySku = new Map(products.map((product) => [product.productId, product]))
        return skus.flatMap((sku) => {
            const product = bySku.get(sku)
            return product ? [product] : []
        })
    }

    static async checkAvailability(
        productId: string,
        quantity: number
    ): Promise<{ available: boolean; onHand: number; reserved: number; available_qty: number }> {
        const product = await prisma.product.findUnique({
            where: { productId },
            select: { id: true },
        })
        if (!product) throw new Error("PRODUCT_NOT_FOUND")

        const level = await prisma.stockLevel.findUnique({
            where: { productId_locationId: { productId: product.id, locationId: DEFAULT_LOCATION_ID } },
            select: { onHand: true, reserved: true },
        })

        const onHand = level?.onHand ?? 0
        const reserved = level?.reserved ?? 0
        const free = Math.max(0, onHand - reserved)
        return { available: free >= quantity, onHand, reserved, available_qty: free }
    }

    static async getProductPrice(productId: string): Promise<SerializedMoney> {
        const product = await prisma.product.findUnique({
            where: { productId },
            select: { id: true, price: true, familyId: true, subCategoryId: true },
        })
        if (!product) throw new Error("PRODUCT_NOT_FOUND")
        return resolveEffectivePrice(product.price, product, await activeDiscounts()).effective
    }

    /** The family's sibling products as the variant buttons need them: label parts and a resolved price only. */
    static async getProductVariants(slug: string, locale: Locale): Promise<ProductVariantView[]> {
        const product = await prisma.product.findFirst({
            where: { slug, ...liveProduct },
            select: { familyId: true },
        })
        if (!product?.familyId) return []

        const variants = await prisma.product.findMany({
            where: { familyId: product.familyId, ...liveProduct },
            // displayOrder is admin-entered and can tie; the rest keeps the buttons in one order.
            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: {
                id: true,
                productId: true,
                slug: true,
                familyId: true,
                subCategoryId: true,
                price: true,
                variantValue: true,
                translations: { ...translationsFor(locale), select: { name: true } },
                family: { select: { variantType: true } },
            },
        })

        const discounts = await activeDiscounts()
        return variants.map((variant) => ({
            id: variant.id,
            productId: variant.productId,
            slug: variant.slug,
            name: variant.translations[0]?.name ?? variant.productId,
            variantValue: variant.variantValue,
            price: resolveEffectivePrice(variant.price, variant, discounts).effective,
            family: variant.family ? { variantType: variant.family.variantType } : null,
        }))
    }

    static async getProductBySlug(slug: string, locale: Locale) {
        const product = await prisma.product.findFirst({
            where: { slug, ...liveProduct },
            include: productDetailInclude(locale),
        })
        if (!product) return null

        const [variants, stock, discounts] = await Promise.all([
            this.getProductVariants(slug, locale),
            prisma.stockLevel.findUnique({
                where: { productId_locationId: { productId: product.id, locationId: DEFAULT_LOCATION_ID } },
                select: { onHand: true, reserved: true },
            }),
            activeDiscounts(),
        ])

        const available = availableOf(stock ? [stock] : [])

        return {
            ...toCardView(product, discounts),
            specs: product.specs.map((spec) => ({
                ...spec,
                valueNumber: spec.valueNumber === null ? null : serializeMoney(spec.valueNumber),
            })),
            variants,
            inStock: available > 0,
            stockAvailable: available,
            stockStatus: stockStatusOf(available),
        }
    }

    static async getProductBySku(sku: string, locale: Locale) {
        const product = await prisma.product.findFirst({
            where: { productId: sku, ...liveProduct },
            select: { slug: true },
        })
        return product ? this.getProductBySlug(product.slug, locale) : null
    }
}

export type ProductDetailView = NonNullable<Awaited<ReturnType<typeof ProductService.getProductBySlug>>>

export interface ProductVariantView {
    id: string
    productId: string
    slug: string
    name: string
    variantValue: string | null
    price: SerializedMoney
    family: { variantType: string | null } | null
}

/** Exactly what the product page's client component reads — nothing else crosses the RSC boundary. */
export function toProductPageView(view: ProductDetailView) {
    const subCategory = view.subCategory.translations[0]
    const category = view.subCategory.category.translations[0]
    const translation = view.translations[0]
    return {
        productId: view.productId,
        isFeatured: view.isFeatured,
        price: view.price,
        basePrice: view.basePrice,
        discountPercent: view.discountPercent,
        colorTemperatures: view.colorTemperatures,
        stockAvailable: view.stockAvailable,
        stockStatus: view.stockStatus,
        translation: translation ? { name: translation.name, description: cleanDescription(translation.description) } : null,
        subCategory: subCategory ? { name: subCategory.name, slug: subCategory.slug } : null,
        category: category ? { name: category.name, slug: category.slug } : null,
        images: view.images.map((image) => ({ url: image.url })),
        colorKeys: view.availableColors.map((link) => link.color.key),
        specs: view.specs.map((row) => ({
            specKey: row.specKey,
            valueEn: row.valueEn,
            valueAr: row.valueAr,
            spec: {
                labelEn: row.spec.labelEn,
                labelAr: row.spec.labelAr,
                unitEn: row.spec.unitEn,
                unitAr: row.spec.unitAr,
            },
        })),
        variants: view.variants,
    }
}

export type ProductPageView = ReturnType<typeof toProductPageView>
