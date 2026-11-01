import {
    DEFAULT_LOCATION_ID,
    Prisma,
    resolveEffectivePrice,
    translationsFor,
    type ActiveDiscount,
    type Locale,
    type SerializedMoney,
} from "@repo/database"

export const productImages = { orderBy: { order: "asc" as const } }

// Every card shows one photo; only the product page (productDetailInclude) needs the gallery.
export const productCardImages = { ...productImages, take: 1 }

export const productSpecs = {
    include: { spec: true },
    orderBy: { spec: { order: "asc" as const } },
}

export function productAvailableColors() {
    return { include: { color: true }, orderBy: { order: "asc" as const } }
}

export function productCardInclude(locale: Locale) {
    return {
        translations: translationsFor(locale),
        images: productCardImages,
    } satisfies Prisma.ProductInclude
}

export function productDetailInclude(locale: Locale) {
    return {
        translations: translationsFor(locale),
        images: productImages,
        specs: productSpecs,
        availableColors: productAvailableColors(),
        family: { include: { translations: translationsFor(locale) } },
        subCategory: {
            include: {
                translations: translationsFor(locale),
                category: { include: { translations: translationsFor(locale) } },
            },
        },
    } satisfies Prisma.ProductInclude
}

export type ProductCard = Prisma.ProductGetPayload<{ include: ReturnType<typeof productCardInclude> }>

export function productListCardInclude(locale: Locale) {
    return {
        translations: translationsFor(locale),
        family: { include: { translations: translationsFor(locale) } },
        images: productCardImages,
        availableColors: { include: { color: true }, orderBy: { order: "asc" as const } },
        stockLevels: {
            where: { locationId: DEFAULT_LOCATION_ID },
            select: { onHand: true, reserved: true },
        },
        specs: productSpecs,
    } satisfies Prisma.ProductInclude
}

export type ProductListCard = Prisma.ProductGetPayload<{
    include: ReturnType<typeof productListCardInclude>
}>
export type ProductDetail = Prisma.ProductGetPayload<{ include: ReturnType<typeof productDetailInclude> }>

export const liveProduct = { isActive: true, deletedAt: null } satisfies Prisma.ProductWhereInput
export const liveSubCategory = { isActive: true, deletedAt: null } satisfies Prisma.SubCategoryWhereInput
export const liveCategory = { isActive: true, deletedAt: null } satisfies Prisma.CategoryWhereInput

export function productLinkedCardInclude(locale: Locale) {
    return {
        translations: translationsFor(locale),
        images: productCardImages,
        stockLevels: {
            where: { locationId: DEFAULT_LOCATION_ID },
            select: { onHand: true, reserved: true },
        },
        subCategory: {
            include: {
                translations: translationsFor(locale),
                category: { include: { translations: translationsFor(locale) } },
            },
        },
    } satisfies Prisma.ProductInclude
}

export type ProductLinkedCard = Prisma.ProductGetPayload<{ include: ReturnType<typeof productLinkedCardInclude> }>

export function toCardView<
    T extends {
        id: string
        familyId: string | null
        subCategoryId: string
        price: Prisma.Decimal
        averageCost: Prisma.Decimal | null
    },
>(product: T, discounts: readonly ActiveDiscount[] = []): CardView<T> {
    const { averageCost: _cost, price, ...rest } = product
    void _cost

    const resolved = resolveEffectivePrice(price, product, discounts)

    return {
        ...rest,
        price: resolved.effective,
        basePrice: resolved.base,
        discountPercent: resolved.percentOff,
        isDiscounted: resolved.discount !== null,
    }
}

export type CardView<T extends { price: Prisma.Decimal; averageCost: Prisma.Decimal | null }> = Omit<
    T,
    "price" | "averageCost"
> & {
    price: SerializedMoney
    basePrice: SerializedMoney
    discountPercent: number
    isDiscounted: boolean
}
