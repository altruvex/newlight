import { PLACEHOLDER, type Locale, type ProductColorTemp } from "@repo/database"

import { availableOf, stockStatusOf, type StockLevelLike, type StockStatus } from "@/lib/stock"
import type { CardView, ProductListCard } from "./selectors"

/** Cards a product listing renders at first, and adds with each "Load more". */
export const LISTING_PAGE_SIZE = 24

export type SortKey = "featured" | "price-asc" | "price-desc" | "newest"

export const SORT_KEYS: readonly SortKey[] = ["featured", "price-asc", "price-desc", "newest"]

export function isSortKey(value: unknown): value is SortKey {
    return typeof value === "string" && (SORT_KEYS as readonly string[]).includes(value)
}

export interface FacetOption {
    value: string
    label: string
    count: number
    hex?: string
}

export interface ProductFacets {
    colorTemperatures: FacetOption[]
    colors: FacetOption[]
    specs: SpecFacet[]
    inStock: number
    onSale: number
    total: number
}

export interface ListingProduct {
    id: string
    slug: string
    productId: string
    name: string
    image: string | null
    price: string
    basePrice: string
    discountPercent: number
    isDiscounted: boolean
    colorTemperatures: ProductColorTemp[]
    colorKeys: string[]
    specs: Record<string, string[]>
    available: boolean
    stockStatus: StockStatus
    createdAt: string
    isFeatured: boolean
}

const COLOR_TEMP_LABEL: Record<ProductColorTemp, string> = {
    WARM_3000K: "3000K",
    COOL_4000K: "4000K",
    WHITE_6500K: "6500K",
}

const COLOR_TEMP_ORDER: readonly ProductColorTemp[] = ["WARM_3000K", "COOL_4000K", "WHITE_6500K"]

type ListingRow = CardView<ProductListCard>

/** The per-product fields a family's filterable attributes are read from. */
export interface FacetSource {
    colorTemperatures: readonly ProductColorTemp[]
    availableColors: readonly { color: { key: string } }[]
    stockLevels: readonly StockLevelLike[]
    specs: Parameters<typeof specValuesOf>[0]
}

/** A family's filterable attributes: the union over its members (stock is summed). */
export function familyFacetFields(
    family: readonly FacetSource[],
    locale: Locale
): Pick<ListingProduct, "colorTemperatures" | "colorKeys" | "specs" | "available" | "stockStatus"> {
    const temps = new Set<ProductColorTemp>()
    const colors = new Set<string>()
    const specs = new Map<string, Set<string>>()
    let availableQuantity = 0

    for (const member of family) {
        for (const temp of member.colorTemperatures) temps.add(temp)
        for (const entry of member.availableColors) colors.add(entry.color.key)
        availableQuantity += availableOf(member.stockLevels)

        for (const [key, value] of specValuesOf(member.specs, locale)) {
            const values = specs.get(key) ?? new Set<string>()
            values.add(value)
            specs.set(key, values)
        }
    }

    return {
        colorTemperatures: [...temps].sort(
            (a, b) => COLOR_TEMP_ORDER.indexOf(a) - COLOR_TEMP_ORDER.indexOf(b)
        ),
        colorKeys: [...colors],
        specs: Object.fromEntries([...specs].map(([key, values]) => [key, [...values]])),
        available: availableQuantity > 0,
        stockStatus: stockStatusOf(availableQuantity),
    }
}

export function toListingProduct(
    row: ListingRow,
    family: readonly ListingRow[],
    locale: Locale
): ListingProduct {
    return {
        id: row.id,
        slug: row.slug,
        productId: row.productId,
        name:
            family.length > 1
                ? (row.family?.translations[0]?.name ?? row.translations[0]?.name ?? row.productId)
                : (row.translations[0]?.name ?? row.productId),
        image: row.images[0]?.url ?? null,
        price: row.price,
        basePrice: row.basePrice,
        discountPercent: row.discountPercent,
        isDiscounted: row.isDiscounted,
        ...familyFacetFields(family, locale),
        createdAt: row.createdAt.toISOString(),
        isFeatured: row.isFeatured,
    }
}

export function buildFacets(
    products: readonly ListingProduct[],
    colorNames: ReadonlyMap<string, { name: string; hex: string }>,
    locale: Locale
): ProductFacets {
    void locale

    const tempCounts = new Map<ProductColorTemp, number>()
    const colorCounts = new Map<string, number>()

    for (const product of products) {
        for (const temp of product.colorTemperatures) {
            tempCounts.set(temp, (tempCounts.get(temp) ?? 0) + 1)
        }
        for (const key of product.colorKeys) {
            colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1)
        }
    }

    return {
        specs: [],
        colorTemperatures: COLOR_TEMP_ORDER.filter((temp) => tempCounts.has(temp)).map((temp) => ({
            value: temp,
            label: COLOR_TEMP_LABEL[temp],
            count: tempCounts.get(temp)!,
        })),
        colors: [...colorCounts.entries()]
            .map(([key, count]) => ({
                value: key,
                label: colorNames.get(key)?.name ?? key,
                hex: colorNames.get(key)?.hex,
                count,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        inStock: products.filter((p) => p.available).length,
        onSale: products.filter((p) => p.isDiscounted).length,
        total: products.length,
    }
}

export interface ListingFilters {
    colorTemperatures: string[]
    colors: string[]
    specs: Record<string, string[]>
    inStockOnly: boolean
    onSaleOnly: boolean
    sort: SortKey
}

export const EMPTY_FILTERS: ListingFilters = {
    colorTemperatures: [],
    colors: [],
    specs: {},
    inStockOnly: false,
    onSaleOnly: false,
    sort: "featured",
}

export function applyFilters(
    products: readonly ListingProduct[],
    filters: ListingFilters
): ListingProduct[] {
    const filtered = products.filter((product) => {
        if (filters.inStockOnly && !product.available) return false
        if (filters.onSaleOnly && !product.isDiscounted) return false
        if (
            filters.colorTemperatures.length > 0 &&
            !filters.colorTemperatures.some((temp) => (product.colorTemperatures as string[]).includes(temp))
        ) {
            return false
        }
        if (filters.colors.length > 0 && !filters.colors.some((key) => product.colorKeys.includes(key))) {
            return false
        }

        for (const [key, selected] of Object.entries(filters.specs)) {
            if (selected.length === 0) continue
            const values = product.specs[key]
            if (!values || !selected.some((value) => values.includes(value))) return false
        }

        return true
    })

    const byPrice = (a: ListingProduct, b: ListingProduct) => Number(a.price) - Number(b.price)

    switch (filters.sort) {
        case "price-asc":
            return [...filtered].sort(byPrice)
        case "price-desc":
            return [...filtered].sort((a, b) => byPrice(b, a))
        case "newest":
            return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        case "featured":
        default:
            return filtered
    }
}

export function activeFilterCount(filters: ListingFilters): number {
    return (
        filters.colorTemperatures.length +
        filters.colors.length +
        Object.values(filters.specs).reduce((total, values) => total + values.length, 0) +
        (filters.inStockOnly ? 1 : 0) +
        (filters.onSaleOnly ? 1 : 0)
    )
}

export interface SpecFacet {
    key: string
    label: string
    unit: string | null
    numeric: boolean
    options: FacetOption[]
}

const MAX_SPEC_OPTIONS = 20

export function specValuesOf(
    specs: readonly {
        specKey: string
        valueNumber: unknown
        valueEn: string | null
        valueAr: string | null
        valueBool: boolean | null
    }[],
    locale: Locale
): Map<string, string> {
    const values = new Map<string, string>()
    for (const spec of specs) {
        let value: string | null = null
        if (spec.valueNumber !== null && spec.valueNumber !== undefined) {
            value = String(Number(spec.valueNumber))
        } else if (spec.valueBool !== null) {
            value = spec.valueBool ? "true" : "false"
        } else {
            const text = locale === "ar" ? (spec.valueAr ?? spec.valueEn) : spec.valueEn
            value = text?.trim() || null
        }
        if (!value || value === PLACEHOLDER) continue
        values.set(spec.specKey, value)
    }
    return values
}

export function localiseDigits(value: string, locale: Locale): string {
    if (locale !== "ar") return value
    return value.replace(/[0-9]/g, (digit) => String.fromCharCode(0x0660 + Number(digit)))
}

export interface SpecDefinitionView {
    key: string
    label: string
    unit: string | null
    numeric: boolean
    order: number
}

export function buildSpecFacets(
    products: readonly ListingProduct[],
    declared: readonly SpecDefinitionView[],
    locale: Locale = "en"
): SpecFacet[] {
    const facets: SpecFacet[] = []

    for (const definition of [...declared].sort((a, b) => a.order - b.order)) {
        const counts = new Map<string, number>()
        for (const product of products) {
            for (const value of product.specs[definition.key] ?? []) {
                counts.set(value, (counts.get(value) ?? 0) + 1)
            }
        }

        if (counts.size < 2 || counts.size > MAX_SPEC_OPTIONS) continue

        const options = [...counts.entries()].map(([value, count]) => ({
            value,
            label: localiseDigits(value, locale),
            count,
        }))
        options.sort((a, b) =>
            definition.numeric
                ? Number(a.value) - Number(b.value)
                : a.value.localeCompare(b.value)
        )

        facets.push({
            key: definition.key,
            label: definition.label,
            unit: definition.unit,
            numeric: definition.numeric,
            options,
        })
    }

    return facets
}

export interface QuickSpec {
    label: string
    value: string
}

export function quickSpecs(
    product: Pick<ListingProduct, "specs">,
    definitions: readonly SpecDefinitionView[],
    locale: Locale = "en",
    max = 3
): QuickSpec[] {
    const out: QuickSpec[] = []

    for (const definition of definitions) {
        if (out.length >= max) break
        const values = product.specs[definition.key]
        if (!values || values.length === 0) continue

        const collapsed = collapse(values)
        if (!collapsed) continue
        const value = localiseDigits(collapsed, locale)
        out.push({ label: definition.label, value: definition.unit ? `${value} ${definition.unit}` : value })
    }

    return out
}

function collapse(values: readonly string[]): string | null {
    if (values.length === 1) return values[0] ?? null

    const parsed = values.map((value) => ({ value, number: Number.parseFloat(normaliseDigits(value)) }))
    if (parsed.some((entry) => !Number.isFinite(entry.number))) return null

    const sorted = [...parsed].sort((a, b) => a.number - b.number)
    const low = sorted[0]!
    const high = sorted[sorted.length - 1]!
    return low.number === high.number ? low.value : `${low.value}-${high.value}`
}

function normaliseDigits(value: string): string {
    return value.replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
}

export function filtersFromParams(params: URLSearchParams): ListingFilters {
    const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean)
    const specs: Record<string, string[]> = {}
    for (const [key, value] of params.entries()) {
        if (!key.startsWith("spec.")) continue
        const values = value.split(",").filter(Boolean)
        if (values.length) specs[key.slice(5)] = values
    }
    const sort = params.get("sort")

    return {
        colorTemperatures: list("temp"),
        colors: list("finish"),
        specs,
        inStockOnly: params.get("stock") === "in",
        onSaleOnly: params.get("sale") === "1",
        sort: isSortKey(sort) ? sort : EMPTY_FILTERS.sort,
    }
}

export function filtersToParams(filters: ListingFilters, keep: Record<string, string> = {}): URLSearchParams {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(keep)) {
        if (value) params.set(key, value)
    }
    if (filters.colorTemperatures.length) params.set("temp", filters.colorTemperatures.join(","))
    if (filters.colors.length) params.set("finish", filters.colors.join(","))
    for (const [key, values] of Object.entries(filters.specs)) {
        if (values.length) params.set(`spec.${key}`, values.join(","))
    }
    if (filters.inStockOnly) params.set("stock", "in")
    if (filters.onSaleOnly) params.set("sale", "1")
    if (filters.sort !== EMPTY_FILTERS.sort) params.set("sort", filters.sort)
    return params
}
