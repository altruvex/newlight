"use server"

import {
    Prisma,
    prisma,
    resolveEffectivePrice,
    resolveLocale,
    translationsFor,
    type ActiveDiscount,
    type Locale,
    type SerializedMoney,
} from "@repo/database"
import { activeDiscounts } from "@/lib/discounts"

const SEARCHABLE_SPEC_KEYS = [
    "voltage",
    "brand_of_led",
    "luminous_flux",
    "main_material",
    "cri",
    "product_dimensions",
    "hole_size",
    "power_factor",
] as const

const RESULT_SPEC_KEYS = ["maximum_wattage", "voltage", "ip_rating"] as const

export interface SearchResultImage {
    url: string
    blurDataUrl: string | null
    width: number | null
    height: number | null
    alt: string | null
}

export interface SearchResult {
    id: string
    productId: string
    slug: string
    price: SerializedMoney
    basePrice: SerializedMoney
    discountPercent: number
    images: SearchResultImage[]
    name: string
    description: string | null
    categoryName: string | undefined
    categorySlug: string | undefined
    subCategoryName: string | undefined
    subCategorySlug: string | undefined
    maxWattage: string | null
    voltage: string | null
    colorTemperatures: string[]
    ipRating: string | null
}

function resultInclude(locale: Locale) {
    return {
        translations: translationsFor(locale),
        images: { orderBy: { order: "asc" as const }, take: 1 },
        specs: { where: { specKey: { in: [...RESULT_SPEC_KEYS] } } },
        subCategory: {
            include: {
                translations: translationsFor(locale),
                category: { include: { translations: translationsFor(locale) } },
            },
        },
    } satisfies Prisma.ProductInclude
}

type ProductWithIncludes = Prisma.ProductGetPayload<{ include: ReturnType<typeof resultInclude> }>

function toResult(
    product: ProductWithIncludes,
    locale: Locale,
    discounts: readonly ActiveDiscount[]
): SearchResult {
    const translation = product.translations[0]
    const subCategoryTranslation = product.subCategory?.translations[0]
    const categoryTranslation = product.subCategory?.category?.translations[0]
    const spec = (key: string) => product.specs.find((s) => s.specKey === key)?.valueEn ?? null
    const priced = resolveEffectivePrice(product.price, product, discounts)

    return {
        id: product.id,
        productId: product.productId,
        slug: product.slug,
        price: priced.effective,
        basePrice: priced.base,
        discountPercent: priced.percentOff,
        images: product.images.map((image) => ({
            url: image.url,
            blurDataUrl: image.blurDataUrl,
            width: image.width,
            height: image.height,
            alt: (locale === "ar" ? image.altAr : image.altEn) ?? translation?.name ?? null,
        })),
        name: translation?.name ?? "",
        description: translation?.description ?? null,
        categoryName: categoryTranslation?.name,
        categorySlug: categoryTranslation?.slug,
        subCategoryName: subCategoryTranslation?.name,
        subCategorySlug: subCategoryTranslation?.slug,
        maxWattage: spec("maximum_wattage"),
        voltage: spec("voltage"),
        colorTemperatures: product.colorTemperatures,
        ipRating: spec("ip_rating"),
    }
}

const MIN_SEARCH_LENGTH = 2
const SEARCH_RESULT_LIMIT = 8

export async function searchProducts(searchItem: string, requestedLocale: string = "en"): Promise<SearchResult[]> {
    const searchTerm = searchItem.trim()
    if (searchTerm.length < MIN_SEARCH_LENGTH) return []

    const locale = resolveLocale(requestedLocale)
    const contains = { contains: searchTerm, mode: "insensitive" } as const

    const products = await prisma.product.findMany({
        where: {
            isActive: true,
            deletedAt: null,
            OR: [
                { productId: contains },
                { slug: contains },
                {
                    translations: {
                        some: {
                            locale,
                            OR: [
                                { name: contains },
                                { description: contains },
                                { metaTitle: contains },
                                { metaDescription: contains },
                            ],
                        },
                    },
                },
                {
                    subCategory: {
                        category: {
                            translations: { some: { locale, OR: [{ name: contains }, { description: contains }] } },
                        },
                    },
                },
                {
                    subCategory: {
                        translations: { some: { locale, OR: [{ name: contains }, { description: contains }] } },
                    },
                },
                { specs: { some: { specKey: { in: [...SEARCHABLE_SPEC_KEYS] }, valueEn: contains } } },
            ],
        },
        include: resultInclude(locale),
        orderBy: [{ isFeatured: "desc" }, { order: "asc" }],
        take: SEARCH_RESULT_LIMIT,
    })

    const discounts = await activeDiscounts()
    return Array.from(new Map(products.map((p) => [p.id, p])).values()).map((p) =>
        toResult(p, locale, discounts)
    )
}
