import { unstable_cache } from "next/cache"
import { loadActiveDiscounts, Prisma, prisma, resolveEffectivePrice, type ActiveDiscount, type Locale } from "@repo/database"

import { logger } from "@/lib/logger"

import { activeDiscounts, nextDiscountBoundary } from "@/lib/discounts"
import { liveProduct, productLinkedCardInclude, toCardView, type CardView } from "./selectors"

export interface OfferSummary {
    percentOff: number
    productCount: number
    endsAt: string
}

export interface OfferGroup {
    subCategoryId: string
    name: string
    slug: string
    categoryName: string
    categorySlug: string
    summary: OfferSummary
    products: Array<CardView<Prisma.ProductGetPayload<{ include: ReturnType<typeof productLinkedCardInclude> }>>>
}

type PricedRow = { id: string; familyId: string | null; subCategoryId: string; price: Prisma.Decimal }

function whereForDiscounts(discounts: readonly ActiveDiscount[]): Prisma.ProductWhereInput | null {
    if (discounts.length === 0) return null
    if (discounts.some((discount) => discount.scopeType === "ALL")) return { ...liveProduct }

    const subCategoryIds = new Set<string>()
    const familyIds = new Set<string>()
    const productIds = new Set<string>()

    for (const discount of discounts) {
        discount.subCategoryIds.forEach((id) => subCategoryIds.add(id))
        if (discount.familyId) familyIds.add(discount.familyId)
        discount.productIds.forEach((id) => productIds.add(id))
    }

    const or: Prisma.ProductWhereInput[] = []
    if (subCategoryIds.size > 0) or.push({ subCategoryId: { in: [...subCategoryIds] } })
    if (familyIds.size > 0) or.push({ familyId: { in: [...familyIds] } })
    if (productIds.size > 0) or.push({ id: { in: [...productIds] } })
    if (or.length === 0) return null

    return { ...liveProduct, OR: or }
}

export function summariseOffers(rows: readonly PricedRow[], discounts: readonly ActiveDiscount[]): OfferSummary | null {
    let percentOff = 0
    let endsAt: Date | null = null
    const counted = new Set<string>()

    for (const row of rows) {
        const priced = resolveEffectivePrice(row.price, row, discounts)
        if (!priced.discount) continue

        counted.add(row.familyId ?? row.id)
        percentOff = Math.max(percentOff, priced.percentOff)
        if (endsAt === null || priced.discount.endsAt < endsAt) endsAt = priced.discount.endsAt
    }

    if (counted.size === 0 || endsAt === null) return null
    return { percentOff, productCount: counted.size, endsAt: endsAt.toISOString() }
}

// Every product the active discounts could reach, with only the fields pricing reads. The
// winning discount depends on each row's price (fixed-amount vs percent) and id (PRODUCTS
// scope), so the summary is evaluated per row rather than with an aggregate; callers cache it.
async function pricedCandidates(where: Prisma.ProductWhereInput) {
    return prisma.product.findMany({
        where,
        orderBy: [{ isFeatured: "desc" }, { order: "asc" }],
        select: { id: true, familyId: true, subCategoryId: true, price: true },
    })
}

async function offersHighlight(): Promise<OfferSummary | null> {
    // Not `activeDiscounts()`: that swallows a failed read as "no offers", and the cache
    // below would keep that empty answer for 15 minutes. A throw is never cached.
    const discounts = await loadActiveDiscounts(prisma, new Date())
    const where = whereForDiscounts(discounts)
    if (!where) return null

    return summariseOffers(await pricedCandidates(where), discounts)
}

// The longest the offers bar, and every page that shows it, is cached for.
const OFFERS_CACHE_SECONDS = 900

/**
 * The offers bar, read on every storefront page. Plain numbers and an ISO string, so it
 * round-trips the cache; purged with the `catalog` tag.
 *
 * An offer starting or ending is announced by nothing, so the cache is keyed on the next such
 * moment and expires then: after it, the key changes and the bar is read again. The shorter
 * `revalidate` also shortens the cache time of the page rendering it (Next takes the lowest
 * `unstable_cache` revalidate seen during an ISR render), and every storefront page renders
 * this bar through the shared layout, so prices on every page switch on time too.
 */
export async function cachedOffersHighlight(): Promise<OfferSummary | null> {
    try {
        const boundary = await nextDiscountBoundary()
        const secondsLeft = boundary ? Math.ceil((boundary.getTime() - Date.now()) / 1000) : Infinity
        const revalidate = Math.max(1, Math.min(OFFERS_CACHE_SECONDS, secondsLeft))
        return await unstable_cache(offersHighlight, ["offers-highlight", boundary?.toISOString() ?? "none"], {
            revalidate,
            tags: ["catalog"],
        })()
    } catch (error) {
        logger.error({ err: error }, "offers bar unavailable")
        return null
    }
}

export async function offersForSection(
    scope: { subCategoryId: string } | { categoryId: string }
): Promise<OfferSummary | null> {
    const discounts = await activeDiscounts()
    if (discounts.length === 0) return null

    const rows = await prisma.product.findMany({
        where:
            "subCategoryId" in scope
                ? { ...liveProduct, subCategoryId: scope.subCategoryId }
                : { ...liveProduct, subCategory: { categoryId: scope.categoryId } },
        select: { id: true, familyId: true, subCategoryId: true, price: true },
    })
    return summariseOffers(rows, discounts)
}

export interface OffersLimit {
    /** At most this many cards per sub-category group (the /offers page). */
    perGroup?: number
    /** At most this many cards in all, taken round-robin across groups (home and category strips). */
    total?: number
    /** Only offers in this category. */
    categoryId?: string
}

/**
 * Every live offer, grouped by sub-category, one card per family. The summaries cover every
 * discounted product in scope, but full card data (translations, image, stock) is loaded only
 * for the cards the caller will show; groups left with no card are dropped.
 */
export async function allOffers(
    locale: Locale,
    limit: OffersLimit = {}
): Promise<{ summary: OfferSummary; groups: OfferGroup[] } | null> {
    const discounts = await activeDiscounts()
    const scope = whereForDiscounts(discounts)
    if (!scope) return null

    const rows = await pricedCandidates(
        limit.categoryId ? { ...scope, subCategory: { categoryId: limit.categoryId } } : scope
    )
    const summary = summariseOffers(rows, discounts)
    if (!summary) return null

    const bySubCategory = new Map<string, PricedRow[]>()
    const seen = new Set<string>()
    for (const row of rows) {
        if (!resolveEffectivePrice(row.price, row, discounts).discount) continue
        const key = row.familyId ?? row.id
        if (seen.has(key)) continue
        seen.add(key)
        const group = bySubCategory.get(row.subCategoryId)
        if (group) group.push(row)
        else bySubCategory.set(row.subCategoryId, [row])
    }

    const picked = new Map<string, string[]>()
    if (limit.total !== undefined) {
        let count = 0
        for (let index = 0; count < limit.total; index += 1) {
            const before = count
            for (const [subCategoryId, group] of bySubCategory) {
                const row = group[index]
                if (!row || count >= limit.total) continue
                picked.set(subCategoryId, [...(picked.get(subCategoryId) ?? []), row.id])
                count += 1
            }
            if (count === before) break
        }
    } else {
        for (const [subCategoryId, group] of bySubCategory) {
            picked.set(subCategoryId, group.slice(0, limit.perGroup ?? group.length).map((row) => row.id))
        }
    }

    const ids = [...picked.values()].flat()
    const cards = await prisma.product.findMany({
        where: { id: { in: ids } },
        include: productLinkedCardInclude(locale),
    })
    const cardById = new Map(cards.map((card) => [card.id, card]))

    const groups: OfferGroup[] = []
    for (const [subCategoryId, group] of bySubCategory) {
        const products = (picked.get(subCategoryId) ?? []).flatMap((id) => {
            const card = cardById.get(id)
            return card ? [toCardView(card, discounts)] : []
        })
        const first = products[0]
        if (!first) continue
        groups.push({
            subCategoryId,
            name: first.subCategory.translations[0]?.name ?? "",
            slug: first.subCategory.translations[0]?.slug ?? "",
            categoryName: first.subCategory.category.translations[0]?.name ?? "",
            categorySlug: first.subCategory.category.translations[0]?.slug ?? "",
            summary: summariseOffers(group, discounts) ?? { percentOff: 0, productCount: 0, endsAt: summary.endsAt },
            products,
        })
    }

    return { summary, groups }
}
