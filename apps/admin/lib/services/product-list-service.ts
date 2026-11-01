import { Prisma, prisma, serializeMoney, serializeMoneyOrNull, type SerializedMoney } from "@repo/database"

import { toPrismaPage, type TableState } from "@/lib/table-params"

export const PRODUCT_SORT_COLUMNS = ["sku", "name", "price", "stock", "createdAt"] as const
export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number]

export interface ProductRow {
    id: string
    sku: string
    slug: string
    nameEn: string | null
    nameAr: string | null
    subCategory: string | null
    category: string | null
    family: string | null
    imageUrl: string | null
    price: SerializedMoney
    averageCost: SerializedMoney | null
    onHand: number
    reserved: number
    isActive: boolean
    isFeatured: boolean
    createdAt: string
}

export interface ProductListResult {
    rows: ProductRow[]
    total: number
    openingCountPending: boolean
    facets: {
        categories: { value: string; label: string }[]
        subCategories: { value: string; label: string }[]
    }
}

const LOCATION = "location_main"

function buildWhere(state: TableState): Prisma.ProductWhereInput {
    const { filters } = state
    const where: Prisma.ProductWhereInput = { deletedAt: null }
    const and: Prisma.ProductWhereInput[] = []

    const query = filters.q?.trim()
    if (query) {
        and.push({
            OR: [
                { productId: { contains: query, mode: "insensitive" } },
                { slug: { contains: query, mode: "insensitive" } },
                { translations: { some: { name: { contains: query, mode: "insensitive" } } } },
            ],
        })
    }

    if (filters.category) and.push({ subCategory: { categoryId: filters.category } })
    if (filters.subCategory) and.push({ subCategoryId: filters.subCategory })

    if (filters.status === "active") and.push({ isActive: true })
    if (filters.status === "hidden") and.push({ isActive: false })
    if (filters.status === "featured") and.push({ isFeatured: true })

    if (filters.cost === "missing") and.push({ averageCost: null })
    if (filters.cost === "recorded") and.push({ averageCost: { not: null } })

    if (filters.translation === "en_only") and.push({ translations: { none: { locale: "ar" } } })
    if (filters.translation === "ar_only") and.push({ translations: { none: { locale: "en" } } })
    if (filters.translation === "complete") {
        and.push({ translations: { some: { locale: "ar" } } }, { translations: { some: { locale: "en" } } })
    }

    if (filters.stock === "out") {
        and.push({
            OR: [
                { stockLevels: { none: { locationId: LOCATION } } },
                { stockLevels: { some: { locationId: LOCATION, onHand: { lte: 0 } } } },
            ],
        })
    }
    if (filters.stock === "in") {
        and.push({ stockLevels: { some: { locationId: LOCATION, onHand: { gt: 0 } } } })
    }

    if (and.length > 0) where.AND = and
    return where
}

function buildOrderBy(state: TableState): Prisma.ProductOrderByWithRelationInput[] {
    const direction = state.dir
    switch (state.sort as ProductSortColumn | null) {
        case "sku":
            return [{ productId: direction }]
        case "price":
            return [{ price: direction }]
        case "createdAt":
            return [{ createdAt: direction }]
        default:
            return [{ createdAt: "desc" }]
    }
}

const SORT_SQL = {
    stock: `COALESCE(l."onHand", 0) - COALESCE(l."reserved", 0)`,
    name: `t.name`,
} as const

async function sortedPageIds(
    where: Prisma.ProductWhereInput,
    sort: keyof typeof SORT_SQL,
    dir: "asc" | "desc",
    skip: number,
    take: number
): Promise<string[]> {
    const matching = await prisma.product.findMany({ where, select: { id: true } })
    if (matching.length === 0) return []

    const order = Prisma.raw(`${SORT_SQL[sort]} ${dir === "asc" ? "ASC" : "DESC"} NULLS LAST, p."productId" ASC`)
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p.id
          FROM products p
          LEFT JOIN stock_levels l ON l."productId" = p.id AND l."locationId" = ${LOCATION}
          LEFT JOIN product_translations t ON t."productId" = p.id AND t.locale = 'en'
         WHERE p.id = ANY(${matching.map((m) => m.id)}::text[])
         ORDER BY ${order}
         LIMIT ${take} OFFSET ${skip}`
    return rows.map((row) => row.id)
}

export async function listProducts(state: TableState): Promise<ProductListResult> {
    const where = buildWhere(state)

    const [total, openingSetting, categories, subCategories] = await Promise.all([
        prisma.product.count({ where }),
        prisma.systemSetting.findUnique({ where: { key: "inventory.opening_count_pending" } }),
        prisma.category.findMany({
            where: { deletedAt: null },
            select: { id: true, translations: { where: { locale: "en" }, take: 1, select: { name: true } } },
            orderBy: { order: "asc" },
        }),
        prisma.subCategory.findMany({
            where: { deletedAt: null },
            select: { id: true, translations: { where: { locale: "en" }, take: 1, select: { name: true } } },
            orderBy: { order: "asc" },
        }),
    ])

    const { skip, take } = toPrismaPage(state, total)

    // Stock (available at LOCATION) and English name are not columns Prisma can order by, so
    // those two sorts order the whole filtered set in SQL and fetch just the page's ids.
    const sort = state.sort as ProductSortColumn | null
    const pageIds = sort === "stock" || sort === "name" ? await sortedPageIds(where, sort, state.dir, skip, take) : null

    const fetched = await prisma.product.findMany({
        where: pageIds ? { id: { in: pageIds } } : where,
        ...(pageIds ? {} : { skip, take, orderBy: buildOrderBy(state) }),
        select: {
            id: true,
            productId: true,
            slug: true,
            price: true,
            averageCost: true,
            isActive: true,
            isFeatured: true,
            createdAt: true,
            translations: { select: { locale: true, name: true } },
            images: { orderBy: { order: "asc" }, take: 1, select: { url: true } },
            stockLevels: { where: { locationId: LOCATION }, take: 1, select: { onHand: true, reserved: true } },
            family: { select: { slug: true } },
            subCategory: {
                select: {
                    translations: { where: { locale: "en" }, take: 1, select: { name: true } },
                    category: {
                        select: { translations: { where: { locale: "en" }, take: 1, select: { name: true } } },
                    },
                },
            },
        },
    })

    const byId = new Map(fetched.map((product) => [product.id, product]))
    const products = pageIds ? pageIds.flatMap((id) => byId.get(id) ?? []) : fetched

    const rows: ProductRow[] = products.map((product) => ({
        id: product.id,
        sku: product.productId,
        slug: product.slug,
        nameEn: product.translations.find((t) => t.locale === "en")?.name ?? null,
        nameAr: product.translations.find((t) => t.locale === "ar")?.name ?? null,
        subCategory: product.subCategory?.translations[0]?.name ?? null,
        category: product.subCategory?.category?.translations[0]?.name ?? null,
        family: product.family?.slug ?? null,
        imageUrl: product.images[0]?.url ?? null,
        price: serializeMoney(product.price),
        averageCost: serializeMoneyOrNull(product.averageCost),
        onHand: product.stockLevels[0]?.onHand ?? 0,
        reserved: product.stockLevels[0]?.reserved ?? 0,
        isActive: product.isActive,
        isFeatured: product.isFeatured,
        createdAt: product.createdAt.toISOString(),
    }))

    return {
        rows,
        total,
        openingCountPending: openingSetting?.value === "true",
        facets: {
            categories: categories.map((c) => ({ value: c.id, label: c.translations[0]?.name ?? c.id })),
            subCategories: subCategories.map((s) => ({ value: s.id, label: s.translations[0]?.name ?? s.id })),
        },
    }
}
