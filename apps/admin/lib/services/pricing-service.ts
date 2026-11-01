import { createHash } from "node:crypto"
import {
    addMoney,
    compareMoney,
    money,
    prisma,
    roundMoney,
    serializeMoney,
    subtractMoney,
    sumMoney,
    type Money,
    type SerializedMoney,
} from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { revalidateStorefront } from "@/lib/revalidate"

export type PricingScope =
    | { kind: "category"; categoryId: string }
    | { kind: "subCategory"; subCategoryId: string }
    | { kind: "family"; familyId: string }
    | { kind: "products"; productIds: readonly string[] }

export type PricingFormula =
    | { kind: "percent"; percent: string }
    | { kind: "fixed"; amount: string }
    | { kind: "set"; amount: string }
    | { kind: "linear"; multiplier: string; addend: string }

export interface PreviewRow {
    productId: string
    sku: string
    name: string
    oldPrice: SerializedMoney
    newPrice: SerializedMoney
    delta: SerializedMoney
}

export interface PricingPreview {
    rows: PreviewRow[]
    count: number
    oldTotal: SerializedMoney
    newTotal: SerializedMoney
    invalid: PreviewRow[]
    token: string
}

export class PricingError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "PricingError"
    }
}

const DECIMAL = /^-?\d+(\.\d+)?$/
const PERCENT_MIN = -99
const PERCENT_MAX = 1000

function requireDecimal(value: unknown, what: string): string {
    if (typeof value !== "string" || !DECIMAL.test(value.trim())) {
        throw new PricingError(`${what} must be a number such as 12.50.`)
    }
    return value.trim()
}

// The formula comes straight from the form, so the strings are checked before Decimal sees them:
// money("abc") would throw a Decimal error, and NaN would pass right through `times`.
function validateFormula(formula: PricingFormula): PricingFormula {
    switch (formula.kind) {
        case "percent": {
            const percent = requireDecimal(formula.percent, "The percentage")
            const value = Number(percent)
            if (!Number.isFinite(value) || value < PERCENT_MIN || value > PERCENT_MAX) {
                throw new PricingError(`The percentage must be between ${PERCENT_MIN}% and ${PERCENT_MAX}%.`)
            }
            return { kind: "percent", percent }
        }
        case "fixed":
            return { kind: "fixed", amount: requireDecimal(formula.amount, "The amount") }
        case "set":
            return { kind: "set", amount: requireDecimal(formula.amount, "The price") }
        case "linear":
            return {
                kind: "linear",
                multiplier: requireDecimal(formula.multiplier, "The multiplier"),
                addend: requireDecimal(formula.addend, "The addend"),
            }
        default:
            throw new PricingError("That pricing formula is not recognised.")
    }
}

function whereFor(scope: PricingScope) {
    const live = { deletedAt: null } as const
    switch (scope.kind) {
        case "category":
            return { ...live, subCategory: { categoryId: scope.categoryId } }
        case "subCategory":
            return { ...live, subCategoryId: scope.subCategoryId }
        case "family":
            return { ...live, familyId: scope.familyId }
        case "products":
            return { ...live, id: { in: [...scope.productIds] } }
    }
}

function applyFormula(price: Money, formula: PricingFormula): Money {
    switch (formula.kind) {
        case "percent": {
            const factor = addMoney("1", money(formula.percent).dividedBy(100))
            return roundMoney(price.times(factor))
        }
        case "fixed":
            return roundMoney(addMoney(price, formula.amount))
        case "set":
            return roundMoney(money(formula.amount))
        case "linear":
            return roundMoney(addMoney(multiplyMoneyByDecimal(price, formula.multiplier), formula.addend))
    }
}

function multiplyMoneyByDecimal(price: Money, multiplier: string): Money {
    return price.times(money(multiplier))
}

function mintToken(scope: PricingScope, formula: PricingFormula, rows: PreviewRow[]): string {
    return createHash("sha256")
        .update(
            JSON.stringify({
                scope,
                formula,
                rows: rows.map((row) => [row.productId, row.oldPrice]),
            })
        )
        .digest("hex")
}

export class PricingService {
    static async preview(scope: PricingScope, input: PricingFormula): Promise<PricingPreview> {
        await requireCurrentAdmin()
        const formula = validateFormula(input)

        const products = await prisma.product.findMany({
            where: whereFor(scope),
            select: {
                id: true,
                productId: true,
                price: true,
                translations: { where: { locale: "en" }, take: 1, select: { name: true } },
            },
            orderBy: { productId: "asc" },
        })

        if (products.length === 0) throw new PricingError("that selection contains no products")

        const rows: PreviewRow[] = products.map((product) => {
            const oldPrice = money(product.price)
            const newPrice = applyFormula(oldPrice, formula)
            return {
                productId: product.id,
                sku: product.productId,
                name: product.translations[0]?.name ?? product.productId,
                oldPrice: serializeMoney(oldPrice),
                newPrice: serializeMoney(newPrice),
                delta: serializeMoney(subtractMoney(newPrice, oldPrice)),
            }
        })

        const invalid = rows.filter((row) => compareMoney(row.newPrice, "0") <= 0)

        return {
            rows,
            count: rows.length,
            oldTotal: serializeMoney(sumMoney(rows.map((r) => r.oldPrice))),
            newTotal: serializeMoney(sumMoney(rows.map((r) => r.newPrice))),
            invalid,
            token: mintToken(scope, formula, rows),
        }
    }

    static async apply(scope: PricingScope, formula: PricingFormula, token: string) {
        const admin = await requireCurrentAdmin()
        const preview = await this.preview(scope, formula)

        if (preview.token !== token) {
            throw new PricingError(
                "the catalog changed since this preview was generated. Review the new prices and apply again."
            )
        }
        if (preview.invalid.length > 0) {
            throw new PricingError(
                `${preview.invalid.length} product(s) would be priced at or below zero: ${preview.invalid
                    .slice(0, 5)
                    .map((row) => row.sku)
                    .join(", ")}`
            )
        }

        // One updateMany per distinct (old, new) pair instead of one update per product: a category
        // of a few hundred products is a handful of statements. `price: oldPrice` in the where is the
        // optimistic guard — a row repriced since the preview is not matched, the count comes up
        // short, and the whole transaction rolls back rather than applying a stale formula.
        const groups = new Map<string, { oldPrice: SerializedMoney; newPrice: SerializedMoney; ids: string[] }>()
        for (const row of preview.rows) {
            const key = `${row.oldPrice}->${row.newPrice}`
            const group = groups.get(key) ?? { oldPrice: row.oldPrice, newPrice: row.newPrice, ids: [] }
            group.ids.push(row.productId)
            groups.set(key, group)
        }

        await prisma.$transaction(
            async (tx) => {
                for (const group of groups.values()) {
                    const { count } = await tx.product.updateMany({
                        where: { id: { in: group.ids }, price: group.oldPrice, deletedAt: null },
                        data: { price: group.newPrice },
                    })
                    if (count !== group.ids.length) {
                        throw new PricingError(
                            "the catalog changed since this preview was generated. Review the new prices and apply again."
                        )
                    }
                }

                await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "product.bulk_reprice",
                    entity: "Product",
                    entityId: `${scope.kind}:${"categoryId" in scope ? scope.categoryId : "subCategoryId" in scope ? scope.subCategoryId : "familyId" in scope ? scope.familyId : `${scope.productIds.length} selected`}`,
                    diff: {
                        scope,
                        formula,
                        count: preview.count,
                        oldTotal: preview.oldTotal,
                        newTotal: preview.newTotal,
                        changes: preview.rows.map((row) => ({ sku: row.sku, from: row.oldPrice, to: row.newPrice })),
                    },
                },
            })
            },
            { timeout: 30_000 }
        )

        await revalidateStorefront({ kind: "all" })

        return { count: preview.count, oldTotal: preview.oldTotal, newTotal: preview.newTotal }
    }

    static async setPrice(productId: string, amount: string) {
        const scope: PricingScope = { kind: "products", productIds: [productId] }
        const formula: PricingFormula = { kind: "set", amount }
        const preview = await this.preview(scope, formula)

        if (preview.count === 0) throw new PricingError("that product no longer exists.")
        if (preview.invalid.length > 0) throw new PricingError("a price must be greater than zero.")

        const row = preview.rows[0]!
        if (row.oldPrice === row.newPrice) return { changed: false, price: row.newPrice }

        await this.apply(scope, formula, preview.token)
        return { changed: true, price: row.newPrice, previous: row.oldPrice }
    }

    static async priceHistory(productId: string, limit = 50) {
        await requireCurrentAdmin()
        const product = await prisma.product.findUniqueOrThrow({
            where: { id: productId },
            select: { productId: true },
        })

        // Every price change — single or bulk — is written by apply() as one `product.bulk_reprice`
        // row whose diff.changes lists {sku, from, to}. The action filter and the containment test
        // narrow the rows BEFORE anything is unnested, so only rows that mention this SKU are expanded.
        // The containment test is on the whole `diff` so the GIN index (migration 0017) answers it.
        const mentions = JSON.stringify({ changes: [{ sku: product.productId }] })
        const rows = await prisma.$queryRaw<
            Array<{ createdAt: Date; actorEmail: string | null; from: string; to: string; action: string }>
        >`
            SELECT a."createdAt", a."actorEmail", a.action,
                   change ->> 'from' AS "from",
                   change ->> 'to'   AS "to"
              FROM admin_audit_log a,
                   LATERAL jsonb_array_elements(a.diff -> 'changes') AS change
             WHERE a.entity = 'Product'
               AND a.action = 'product.bulk_reprice'
               AND a.diff @> ${mentions}::jsonb
               AND change ->> 'sku' = ${product.productId}
             ORDER BY a."createdAt" DESC
             LIMIT ${limit}`
        return rows
    }
}
