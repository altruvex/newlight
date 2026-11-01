import { compareMoney, Prisma, prisma, resolveEffectivePrice, translationsFor, type Locale, type SerializedMoney } from "@repo/database"
import { activeDiscounts } from "@/lib/discounts"
import { liveCategory, liveProduct, liveSubCategory, productImages, productListCardInclude, toCardView } from "./selectors"
import {
    buildFacets,
    toListingProduct,
    type ListingProduct,
    type SortKey,
    type ProductFacets,
} from "./product-facets"

export interface SearchResult {
    products: Array<{
        id: string
        productId: string
        slug: string
        price: SerializedMoney
        basePrice: SerializedMoney
        discountPercent: number
        image: string | null
        name: string
        description?: string | null
        categoryName?: string
        categorySlug?: string
        subCategoryName?: string
        subCategorySlug?: string
    }>
    categories: Array<{ id: string; slug: string; name: string; description?: string | null }>
    subCategories: Array<{
        id: string
        slug: string
        name: string
        description?: string | null
        categorySlug?: string
        categoryName?: string
    }>
}

type SearchTaxonomy = Pick<SearchResult, "categories" | "subCategories">

/** Category / sub-category name matches only — no product rows. */
async function searchTaxonomy(term: string, locale: Locale, limit: number): Promise<SearchTaxonomy> {
    const contains = { contains: term, mode: "insensitive" } as const

    const [categoryTranslations, subCategoryTranslations] = await Promise.all([
        prisma.categoryTranslation.findMany({
            where: { locale, category: liveCategory, OR: [{ name: contains }, { description: contains }] },
            take: limit,
        }),
        prisma.subCategoryTranslation.findMany({
            where: { locale, subCategory: liveSubCategory, OR: [{ name: contains }, { description: contains }] },
            take: limit,
            include: {
                subCategory: { include: { category: { include: { translations: translationsFor(locale) } } } },
            },
        }),
    ])

    return {
        categories: categoryTranslations.map((translation) => ({
            id: translation.categoryId,
            slug: translation.slug,
            name: translation.name,
            description: translation.description,
        })),
        subCategories: subCategoryTranslations.map((translation) => ({
            id: translation.subCategoryId,
            slug: translation.slug,
            name: translation.name,
            description: translation.description,
            categorySlug: translation.subCategory.category.translations[0]?.slug,
            categoryName: translation.subCategory.category.translations[0]?.name,
        })),
    }
}

function productMatch(term: string, locale: Locale): Prisma.ProductWhereInput {
    const contains = { contains: term, mode: "insensitive" } as const
    return {
        ...liveProduct,
        OR: [
            { productId: contains },
            { slug: contains },
            { translations: { some: { locale, OR: [{ name: contains }, { description: contains }] } } },
            { specs: { some: { valueEn: contains } } },
        ],
    }
}

export class SearchService {
    /** Taxonomy matches for the /search page, without loading any products. */
    static async searchTaxonomy(query: string, locale: Locale, limit = 20): Promise<SearchTaxonomy> {
        const term = query.trim()
        if (!term) return { categories: [], subCategories: [] }
        return searchTaxonomy(term, locale, limit)
    }

    static async searchContent(query: string, locale: Locale, limit = 20): Promise<SearchResult> {
        const term = query.trim()
        if (!term) return { products: [], categories: [], subCategories: [] }

        const [products, taxonomy] = await Promise.all([
            prisma.product.findMany({
                where: productMatch(term, locale),
                orderBy: [{ isFeatured: "desc" }, { order: "asc" }],
                take: limit,
                include: {
                    translations: translationsFor(locale),
                    images: { ...productImages, take: 1 },
                    subCategory: {
                        include: {
                            translations: translationsFor(locale),
                            category: { include: { translations: translationsFor(locale) } },
                        },
                    },
                },
            }),
            searchTaxonomy(term, locale, limit),
        ])

        const discounts = await activeDiscounts()

        return {
            products: products.map((product) => {
                const subCategoryTranslation = product.subCategory.translations[0]
                const categoryTranslation = product.subCategory.category.translations[0]
                const priced = resolveEffectivePrice(product.price, product, discounts)
                return {
                    id: product.id,
                    productId: product.productId,
                    slug: product.slug,
                    price: priced.effective,
                    basePrice: priced.base,
                    discountPercent: priced.percentOff,
                    image: product.images[0]?.url ?? null,
                    name: product.translations[0]?.name ?? product.productId,
                    description: product.translations[0]?.description,
                    categoryName: categoryTranslation?.name,
                    categorySlug: categoryTranslation?.slug,
                    subCategoryName: subCategoryTranslation?.name,
                    subCategorySlug: subCategoryTranslation?.slug,
                }
            }),
            ...taxonomy,
        }
    }
}

export interface SearchListingEntry {
    product: ListingProduct
    categorySlug: string
    subCategorySlug: string
    sectionName: string
}

export interface SearchListing {
    entries: SearchListingEntry[]
    facets: ProductFacets
    /** Distinct product families matching the query (not just this page). */
    total: number
}

export const SEARCH_PAGE_SIZE = 24

/**
 * One page of the family-deduped result list. Matching ids are read first (two columns, no
 * relations) so the page boundary and the real total come from the same deduped order; only the
 * rows of that page's families are then loaded in full. A non-default sort is applied here,
 * before the cut, so page 2 of "price low to high" continues page 1; the filter bar re-sorts
 * within the page by the same key, which leaves this order unchanged.
 */
export async function searchListing(
    query: string,
    locale: Locale,
    page = 1,
    pageSize = SEARCH_PAGE_SIZE,
    sort: SortKey = "featured"
): Promise<SearchListing> {
    const term = query.trim()
    const empty: SearchListing = {
        entries: [],
        facets: { colorTemperatures: [], colors: [], specs: [], inStock: 0, onSale: 0, total: 0 },
        total: 0,
    }
    if (!term) return empty

    const [matches, discounts] = await Promise.all([
        prisma.product.findMany({
            where: productMatch(term, locale),
            orderBy: [{ isFeatured: "desc" }, { order: "asc" }],
            select: { id: true, familyId: true, subCategoryId: true, price: true, createdAt: true },
        }),
        activeDiscounts(),
    ])

    // Same grouping as before: a family is one entry, represented by its first matching product
    // (the row whose price and date the card shows).
    const families = new Map<string, { lead: (typeof matches)[number]; ids: string[] }>()
    for (const match of matches) {
        const key = match.familyId ?? match.id
        const family = families.get(key)
        if (family) family.ids.push(match.id)
        else families.set(key, { lead: match, ids: [match.id] })
    }
    const total = families.size
    if (total === 0) return empty

    let ordered = [...families.values()]
    if (sort === "price-asc" || sort === "price-desc") {
        const effective = new Map(
            ordered.map(({ lead }) => [lead.id, resolveEffectivePrice(lead.price, lead, discounts).effective])
        )
        const direction = sort === "price-asc" ? 1 : -1
        ordered = ordered.sort((a, b) => direction * compareMoney(effective.get(a.lead.id)!, effective.get(b.lead.id)!))
    } else if (sort === "newest") {
        ordered = ordered.sort((a, b) => b.lead.createdAt.getTime() - a.lead.createdAt.getTime())
    }

    const lastPage = Math.max(1, Math.ceil(total / pageSize))
    const start = (Math.min(Math.max(1, page), lastPage) - 1) * pageSize
    const pageIds = ordered.slice(start, start + pageSize).flatMap((family) => family.ids)

    const loaded = await prisma.product.findMany({
        where: { id: { in: pageIds } },
        include: {
            ...productListCardInclude(locale),
            subCategory: {
                include: {
                    translations: translationsFor(locale),
                    category: { include: { translations: translationsFor(locale) } },
                },
            },
        },
    })
    const order = new Map(pageIds.map((id, index) => [id, index]))
    const rows = loaded.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0))

    const priced = rows.map((row) => toCardView(row, discounts))
    const groups = new Map<string, typeof priced>()
    for (const row of priced) {
        const key = row.familyId ?? row.id
        const group = groups.get(key) ?? []
        group.push(row)
        groups.set(key, group)
    }

    const entries: SearchListingEntry[] = []
    const seen = new Set<string>()
    for (const row of priced) {
        const key = row.familyId ?? row.id
        if (seen.has(key)) continue
        seen.add(key)
        const family = groups.get(key) ?? [row]
        const source = rows.find((candidate) => candidate.id === row.id)
        entries.push({
            product: toListingProduct(row, family, locale),
            categorySlug: source?.subCategory.category.translations[0]?.slug ?? "",
            subCategorySlug: source?.subCategory.translations[0]?.slug ?? "",
            sectionName: source?.subCategory.translations[0]?.name ?? "",
        })
    }

    const colorKeys = [...new Set(entries.flatMap((entry) => entry.product.colorKeys))]
    const colors = colorKeys.length
        ? await prisma.productColor.findMany({ where: { key: { in: colorKeys } } })
        : []
    const colorNames = new Map(
        colors.map((color) => [color.key, { name: locale === "ar" ? color.nameAr : color.nameEn, hex: color.hex }])
    )

    return {
        entries,
        facets: { ...buildFacets(entries.map((entry) => entry.product), colorNames, locale), specs: [] },
        total,
    }
}
