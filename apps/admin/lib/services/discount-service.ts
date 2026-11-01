import {
    compareMoney,
    loadActiveDiscounts,
    MIN_EFFECTIVE_PRICE,
    money,
    prisma,
    resolveEffectivePrice,
    serializeMoney,
    subtractMoney,
    sumMoney,
    type ActiveDiscount,
    type Prisma,
    type DiscountKind,
    type DiscountScopeType,
    type SerializedMoney,
} from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { revalidateStorefront } from "@/lib/revalidate"

export type DiscountStatus = "scheduled" | "live" | "ended" | "stopped"

export interface DiscountScopeInput {
    type: DiscountScopeType
    categoryId?: string
    subCategoryId?: string
    familyId?: string
    productIds?: readonly string[]
}

export interface DiscountInput {
    name: string
    kind: DiscountKind
    value: string
    scope: DiscountScopeInput
    startsAt: Date
    endsAt: Date
}

export interface DiscountPreviewRow {
    productId: string
    sku: string
    name: string
    basePrice: SerializedMoney
    newPrice: SerializedMoney
    saving: SerializedMoney
    supersededBy: string | null
}

export interface DiscountPreview {
    rows: DiscountPreviewRow[]
    count: number
    baseTotal: SerializedMoney
    newTotal: SerializedMoney
    totalSaving: SerializedMoney
    clamped: DiscountPreviewRow[]
    overlapping: DiscountPreviewRow[]
}

export interface DiscountRow {
    id: string
    name: string
    kind: DiscountKind
    value: SerializedMoney
    scopeType: DiscountScopeType
    scopeLabel: string
    startsAt: Date
    endsAt: Date
    status: DiscountStatus
    productCount: number
    createdByEmail: string | null
    createdAt: Date
}

/** "current" = live + scheduled (what is or will be affecting prices); "ended" = finished or stopped. */
export type DiscountView = "current" | "ended"

export const DISCOUNT_PAGE_SIZE = 25

export interface DiscountList {
    rows: DiscountRow[]
    total: number
    page: number
    totalPages: number
    view: DiscountView
}

export class DiscountError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "DiscountError"
    }
}

export const MAX_DISCOUNT_DAYS = 400

function statusOf(row: { isActive: boolean; startsAt: Date; endsAt: Date }, now: Date): DiscountStatus {
    if (!row.isActive) return "stopped"
    if (row.endsAt <= now) return "ended"
    if (row.startsAt > now) return "scheduled"
    return "live"
}

function whereForScope(scope: DiscountScopeInput) {
    const live = { deletedAt: null, isActive: true } as const
    switch (scope.type) {
        case "ALL":
            return live
        case "CATEGORY":
            return { ...live, subCategory: { categoryId: scope.categoryId } }
        case "SUB_CATEGORY":
            return { ...live, subCategoryId: scope.subCategoryId }
        case "FAMILY":
            return { ...live, familyId: scope.familyId }
        case "PRODUCTS":
            return { ...live, id: { in: [...(scope.productIds ?? [])] } }
        default:
            throw new DiscountError("unknown scope")
    }
}

function assertValid(input: DiscountInput, now: Date) {
    const name = input.name.trim()
    if (name.length === 0) throw new DiscountError("give the discount a name — it is how you find it later.")
    if (name.length > 80) throw new DiscountError("that name is too long; 80 characters is the limit.")

    let value
    try {
        value = money(input.value)
    } catch {
        throw new DiscountError(`"${input.value}" is not an amount.`)
    }
    if (compareMoney(value, "0") <= 0) throw new DiscountError("a discount has to take something off.")
    if (input.kind === "PERCENT" && compareMoney(value, "100") >= 0) {
        throw new DiscountError("100% off is free. If that is the intent, set the price instead.")
    }

    if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) {
        throw new DiscountError("the start date is not a date.")
    }
    if (!(input.endsAt instanceof Date) || Number.isNaN(input.endsAt.getTime())) {
        throw new DiscountError("the end date is not a date.")
    }
    if (input.endsAt <= input.startsAt) throw new DiscountError("the discount has to end after it starts.")
    if (input.endsAt <= now) throw new DiscountError("that window has already passed.")

    const days = (input.endsAt.getTime() - input.startsAt.getTime()) / 86_400_000
    if (days > MAX_DISCOUNT_DAYS) {
        throw new DiscountError(
            `${Math.round(days)} days is not a sale, it is a price. Use bulk repricing for a permanent change.`
        )
    }

    switch (input.scope.type) {
        case "CATEGORY":
            if (!input.scope.categoryId) throw new DiscountError("choose a category.")
            break
        case "SUB_CATEGORY":
            if (!input.scope.subCategoryId) throw new DiscountError("choose a sub-category.")
            break
        case "FAMILY":
            if (!input.scope.familyId) throw new DiscountError("choose a family.")
            break
        case "PRODUCTS":
            if (!input.scope.productIds?.length) throw new DiscountError("name at least one product.")
            break
    }
}

function asCandidate(input: DiscountInput, productIds: readonly string[]): ActiveDiscount {
    return {
        id: "candidate",
        name: input.name,
        kind: input.kind,
        value: serializeMoney(input.value),
        scopeType: "PRODUCTS",
        subCategoryIds: [],
        familyId: null,
        productIds,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
    }
}

export interface DiscountProductHit {
    id: string
    sku: string
    name: string
}

export const DISCOUNT_PRODUCT_SEARCH_LIMIT = 20
export const DISCOUNT_PRODUCT_SEARCH_MIN = 2

export class DiscountService {
    /** Picker lookup for the "specific products" scope: live products matching a SKU or English name. */
    static async searchProducts(term: string, limit = DISCOUNT_PRODUCT_SEARCH_LIMIT): Promise<DiscountProductHit[]> {
        await requireCurrentAdmin()
        const needle = term.trim()
        if (needle.length < DISCOUNT_PRODUCT_SEARCH_MIN) return []

        const rows = await prisma.product.findMany({
            where: {
                deletedAt: null,
                isActive: true,
                OR: [
                    { productId: { contains: needle, mode: "insensitive" } },
                    { translations: { some: { locale: "en", name: { contains: needle, mode: "insensitive" } } } },
                ],
            },
            select: {
                id: true,
                productId: true,
                translations: { where: { locale: "en" }, select: { name: true }, take: 1 },
            },
            orderBy: { productId: "asc" },
            take: Math.min(Math.max(1, Math.floor(limit)), DISCOUNT_PRODUCT_SEARCH_LIMIT),
        })
        return rows.map((row) => ({ id: row.id, sku: row.productId, name: row.translations[0]?.name ?? row.productId }))
    }

    static async list(options: { view?: DiscountView; page?: number } = {}): Promise<DiscountList> {
        await requireCurrentAdmin()
        const now = new Date()
        const view = options.view ?? "current"

        // statusOf(): live and scheduled are exactly "still active and not yet over".
        const current = { isActive: true, endsAt: { gt: now } } satisfies Prisma.DiscountWhereInput
        const where: Prisma.DiscountWhereInput = view === "current" ? current : { NOT: current }

        const total = await prisma.discount.count({ where })
        const totalPages = Math.max(1, Math.ceil(total / DISCOUNT_PAGE_SIZE))
        const page = Math.min(Math.max(1, Math.floor(options.page ?? 1) || 1), totalPages)

        const rows = await prisma.discount.findMany({
            where,
            orderBy: [{ startsAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * DISCOUNT_PAGE_SIZE,
            take: DISCOUNT_PAGE_SIZE,
            include: {
                category: { select: { translations: { where: { locale: "en" }, take: 1, select: { name: true } } } },
                subCategory: { select: { translations: { where: { locale: "en" }, take: 1, select: { name: true } } } },
                family: { select: { slug: true } },
                _count: { select: { products: true } },
            },
        })

        const mapped = rows.map((row) => ({
            id: row.id,
            name: row.name,
            kind: row.kind,
            value: serializeMoney(row.value),
            scopeType: row.scopeType,
            scopeLabel:
                row.scopeType === "ALL"
                    ? "Whole catalogue"
                    : row.scopeType === "CATEGORY"
                      ? (row.category?.translations[0]?.name ?? "Category")
                      : row.scopeType === "SUB_CATEGORY"
                        ? (row.subCategory?.translations[0]?.name ?? "Sub-category")
                        : row.scopeType === "FAMILY"
                          ? (row.family?.slug ?? "Family")
                          : `${row._count.products} product${row._count.products === 1 ? "" : "s"}`,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            status: statusOf(row, now),
            productCount: row._count.products,
            createdByEmail: row.createdByEmail,
            createdAt: row.createdAt,
        }))

        return { rows: mapped, total, page, totalPages, view }
    }

    static async preview(input: DiscountInput): Promise<DiscountPreview> {
        await requireCurrentAdmin()
        const now = new Date()
        assertValid(input, now)

        const products = await prisma.product.findMany({
            where: whereForScope(input.scope),
            select: {
                id: true,
                productId: true,
                price: true,
                familyId: true,
                subCategoryId: true,
                translations: { where: { locale: "en" }, take: 1, select: { name: true } },
            },
            orderBy: { productId: "asc" },
        })

        if (products.length === 0) throw new DiscountError("that selection contains no live products.")

        const candidate = asCandidate(
            input,
            products.map((product) => product.id)
        )
        const existing = await loadActiveDiscounts(prisma, input.startsAt)

        const rows: DiscountPreviewRow[] = products.map((product) => {
            const proposed = resolveEffectivePrice(product.price, product, [candidate])
            const current = resolveEffectivePrice(product.price, product, existing)

            return {
                productId: product.id,
                sku: product.productId,
                name: product.translations[0]?.name ?? product.productId,
                basePrice: proposed.base,
                newPrice: proposed.effective,
                saving: proposed.saving,
                supersededBy:
                    current.discount && compareMoney(current.effective, proposed.effective) <= 0
                        ? current.discount.name
                        : null,
            }
        })

        const clamped =
            input.kind === "AMOUNT"
                ? rows.filter(
                      (row) =>
                          compareMoney(subtractMoney(row.basePrice, input.value), MIN_EFFECTIVE_PRICE) < 0
                  )
                : []

        return {
            rows,
            count: rows.length,
            baseTotal: serializeMoney(sumMoney(rows.map((row) => row.basePrice))),
            newTotal: serializeMoney(sumMoney(rows.map((row) => row.newPrice))),
            totalSaving: serializeMoney(sumMoney(rows.map((row) => row.saving))),
            clamped,
            overlapping: rows.filter((row) => row.supersededBy !== null),
        }
    }

    static async create(input: DiscountInput) {
        const admin = await requireCurrentAdmin()
        const preview = await this.preview(input)

        if (preview.clamped.length > 0) {
            throw new DiscountError(
                `${preview.clamped.length} product(s) cost less than that discount takes off: ${preview.clamped
                    .slice(0, 5)
                    .map((row) => row.sku)
                    .join(", ")}. Use a percentage, or narrow the scope.`
            )
        }

        const scope = input.scope
        const discount = await prisma.$transaction(async (tx) => {
            const created = await tx.discount.create({
                data: {
                    name: input.name.trim(),
                    kind: input.kind,
                    value: serializeMoney(input.value),
                    scopeType: scope.type,
                    categoryId: scope.type === "CATEGORY" ? scope.categoryId : null,
                    subCategoryId: scope.type === "SUB_CATEGORY" ? scope.subCategoryId : null,
                    familyId: scope.type === "FAMILY" ? scope.familyId : null,
                    startsAt: input.startsAt,
                    endsAt: input.endsAt,
                    createdById: admin.id,
                    createdByEmail: admin.email,
                    ...(scope.type === "PRODUCTS"
                        ? {
                              products: {
                                  createMany: {
                                      // preview.rows is the scope after whereForScope — archived and
                                      // inactive products are left out, however they were selected.
                                      data: preview.rows.map((row) => ({ productId: row.productId })),
                                  },
                              },
                          }
                        : {}),
                },
            })

            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "discount.create",
                    entity: "Discount",
                    entityId: created.id,
                    diff: {
                        name: created.name,
                        kind: created.kind,
                        value: serializeMoney(created.value),
                        scope: { ...scope, productIds: scope.productIds ? [...scope.productIds] : undefined },
                        startsAt: created.startsAt.toISOString(),
                        endsAt: created.endsAt.toISOString(),
                        affected: preview.count,
                        baseTotal: preview.baseTotal,
                        newTotal: preview.newTotal,
                    },
                },
            })

            return created
        })

        await revalidateStorefront({ kind: "all" })
        return { id: discount.id, count: preview.count, totalSaving: preview.totalSaving }
    }

    static async stop(id: string) {
        const admin = await requireCurrentAdmin()
        const existing = await prisma.discount.findUnique({ where: { id } })
        if (!existing) throw new DiscountError("that discount no longer exists.")
        if (!existing.isActive) throw new DiscountError("that discount is already stopped.")

        await prisma.$transaction(async (tx) => {
            await tx.discount.update({ where: { id }, data: { isActive: false } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "discount.stop",
                    entity: "Discount",
                    entityId: id,
                    diff: {
                        name: existing.name,
                        stoppedAt: new Date().toISOString(),
                        wouldHaveEndedAt: existing.endsAt.toISOString(),
                    },
                },
            })
        })

        await revalidateStorefront({ kind: "all" })
        return { name: existing.name }
    }

    static async reschedule(id: string, startsAt: Date, endsAt: Date) {
        const admin = await requireCurrentAdmin()
        const now = new Date()
        const existing = await prisma.discount.findUnique({ where: { id } })
        if (!existing) throw new DiscountError("that discount no longer exists.")
        if (!existing.isActive) throw new DiscountError("a stopped discount cannot be rescheduled.")
        if (existing.endsAt <= now) throw new DiscountError("that discount has already ended.")
        if (endsAt <= startsAt) throw new DiscountError("the discount has to end after it starts.")
        if (endsAt <= now) throw new DiscountError("the new end is in the past.")

        const started = existing.startsAt <= now
        if (started && startsAt.getTime() !== existing.startsAt.getTime()) {
            throw new DiscountError("this discount is already running; only its end date can move.")
        }

        await prisma.$transaction(async (tx) => {
            await tx.discount.update({ where: { id }, data: { startsAt, endsAt } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "discount.reschedule",
                    entity: "Discount",
                    entityId: id,
                    diff: {
                        name: existing.name,
                        from: { startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt.toISOString() },
                        to: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
                    },
                },
            })
        })

        await revalidateStorefront({ kind: "all" })
        return { name: existing.name }
    }

    static async remove(id: string) {
        const admin = await requireCurrentAdmin()
        const existing = await prisma.discount.findUnique({ where: { id } })
        if (!existing) throw new DiscountError("that discount no longer exists.")
        if (existing.startsAt <= new Date()) {
            throw new DiscountError(
                "this discount has already started. Stop it instead — orders placed under it have to stay explicable."
            )
        }

        await prisma.$transaction(async (tx) => {
            await tx.discount.delete({ where: { id } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "discount.delete",
                    entity: "Discount",
                    entityId: id,
                    diff: {
                        name: existing.name,
                        startsAt: existing.startsAt.toISOString(),
                        endsAt: existing.endsAt.toISOString(),
                        note: "deleted before it started",
                    },
                },
            })
        })

        return { name: existing.name }
    }
}
