import {
    prisma,
    Prisma,
    DEFAULT_LOCATION_ID,
    resolveEffectivePrice,
    serializeMoney,
    type Locale,
    type SerializedMoney,
} from "@repo/database"
import { liveProduct, productCardInclude, productDetailInclude, productLinkedCardInclude, toCardView } from "./selectors"
import { getLocaleOrDefault } from "../db"
import { activeDiscounts } from "@/lib/discounts"
import { availableOf, stockStatusOf } from "@/lib/stock"
import { Product } from "@/types"
import type { SpecificationSource } from "./shared-types"

export type ProductWithTranslations = Prisma.ProductGetPayload<{
    include: {
        translations: true
        subCategory: {
            include: {
                translations: true
                category: { include: { translations: true } }
            }
        }
    }
}>

export class ProductService {
    private static extractSpecifications(product: SpecificationSource, locale: string): Record<string, string | number | string[]> | null {
        const translation = product.translations?.find((t) => t.locale === locale)
        const specs = translation?.specifications

        if (!specs || typeof specs !== 'object' || Array.isArray(specs)) {
            return null
        }

        const record = specs as Record<string, unknown>
        const result: Record<string, string | number | string[]> = {}
        let hasValidEntries = false

        for (const [key, value] of Object.entries(record)) {
            if (typeof value === 'string' || typeof value === 'number' || Array.isArray(value)) {
                result[key] = value as string | number | string[]
                hasValidEntries = true
            }
        }

        return hasValidEntries ? result : null
    }

    private static async sortAlphabetically<T extends {
        order?: number
        isFeatured?: boolean
        translations?: Array<{ locale: string; name: string }>
    }>(
        items: T[],
        locale: string
    ): Promise<T[]> {
        return [...items].sort((a, b) => {
            if (a.isFeatured !== undefined && b.isFeatured !== undefined) {
                if (a.isFeatured && !b.isFeatured) return -1
                if (!a.isFeatured && b.isFeatured) return 1
            }

            if (a.order !== undefined && b.order !== undefined) {
                if (a.order !== b.order) {
                    return a.order - b.order
                }
            }

            const nameA = a.translations?.find((t) => t.locale === locale)?.name || ""
            const nameB = b.translations?.find((t) => t.locale === locale)?.name || ""

            return nameA.localeCompare(nameB, locale === "ar" ? "ar" : "en", {
                numeric: true,
                sensitivity: "base",
            })
        })
    }

    static async getProduct(
        productId: string,
        locale: string = "en"
    ): Promise<ProductWithTranslations | null> {
        const product = await prisma.product.findUnique({
            where: { productId },
            include: {
                translations: {
                    where: { locale },
                    take: 1,
                },
                subCategory: {
                    include: {
                        translations: {
                            where: { locale },
                            take: 1,
                        },
                        category: {
                            include: {
                                translations: {
                                    where: { locale },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        })

        return product
    }

    static async getProducts(
        productIds: string[],
        locale: string = "en"
    ): Promise<ProductWithTranslations[]> {
        const products = await prisma.product.findMany({
            where: {
                productId: { in: productIds },
            },
            include: {
                translations: {
                    where: { locale },
                    take: 1,
                },
                subCategory: {
                    include: {
                        translations: {
                            where: { locale },
                            take: 1,
                        },
                        category: {
                            include: {
                                translations: {
                                    where: { locale },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        })

        return products
    }

    static async getAllProducts(locale?: string, limit?: number): Promise<Product[]> {
        const resolvedLocale = await getLocaleOrDefault(locale)
        const products = await prisma.product.findMany({
            where: {
                isActive: true,
            },
            orderBy: [{ isFeatured: "desc" }, { order: "asc" }],
            take: limit,
            include: {
                translations: true,
                subCategory: {
                    include: {
                        translations: {
                            where: { locale: resolvedLocale },
                        },
                        category: {
                            include: {
                                translations: {
                                    where: { locale: resolvedLocale },
                                },
                            },
                        },
                    },
                },
            },
        })

        const mappedProducts = products.map(product => ({
            ...product,
            specifications: this.extractSpecifications(product, resolvedLocale),
            translations: product.translations.filter((t) => t.locale === resolvedLocale)
        }))

        const sorted = await this.sortAlphabetically(mappedProducts, resolvedLocale)
        return sorted as unknown as Product[]
    }

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

    static async searchProducts(params: {
        query?: string
        categoryId?: string
        subCategoryId?: string
        locale?: string
        skip?: number
        take?: number
    }): Promise<ProductWithTranslations[]> {
        const { query, categoryId, subCategoryId, locale = "en", skip = 0, take = 20 } = params

        const where: Prisma.ProductWhereInput = {}

        if (query) {
            where.OR = [
                {
                    translations: {
                        some: {
                            name: { contains: query, mode: "insensitive" },
                            locale,
                        },
                    },
                },
                {
                    productId: { contains: query, mode: "insensitive" },
                },
            ]
        }

        if (subCategoryId) {
            where.subCategoryId = subCategoryId
        } else if (categoryId) {
            where.subCategory = {
                categoryId,
            }
        }

        const products = await prisma.product.findMany({
            where,
            include: {
                translations: {
                    where: { locale },
                    take: 1,
                },
                subCategory: {
                    include: {
                        translations: {
                            where: { locale },
                            take: 1,
                        },
                        category: {
                            include: {
                                translations: {
                                    where: { locale },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
            skip,
            take,
            orderBy: { createdAt: "desc" },
        })

        return products
    }

    static async getProductVariants(slug: string, locale: Locale) {
        const product = await prisma.product.findFirst({
            where: { slug, ...liveProduct },
            select: { familyId: true },
        })
        if (!product?.familyId) return []

        const variants = await prisma.product.findMany({
            where: { familyId: product.familyId, ...liveProduct },
            // displayOrder is admin-entered and can tie; the rest keeps the buttons in one order.
            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            include: { ...productCardInclude(locale), family: true },
        })

        const discounts = await activeDiscounts()
        return variants.map((variant) => ({
            ...toCardView(variant, discounts),
            name: variant.translations[0]?.name ?? variant.productId,
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
export type ProductVariantView = Awaited<ReturnType<typeof ProductService.getProductVariants>>[number]
