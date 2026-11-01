import { prisma, LOCALES, type Locale } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { revalidateStorefront } from "@/lib/revalidate"

function isPlaceholderName(name: string | null | undefined, sku: string): boolean {
    if (!name) return true
    const n = name.trim()
    return n.length === 0 || n === "-" || n.toLowerCase() === sku.toLowerCase()
}

export const RTL_LOCALES: readonly Locale[] = ["ar"]
export function isRtl(locale: Locale): boolean {
    return RTL_LOCALES.includes(locale)
}

export interface TranslationFields {
    name: string | null
    description: string | null
    metaTitle: string | null
    metaDescription: string | null
}

export interface TranslationPair {
    entity: "product" | "category" | "subCategory"
    entityId: string
    reference: string
    locales: Record<Locale, TranslationFields & { exists: boolean; dir: "ltr" | "rtl" }>
    completeness: Record<Locale, { filled: number; total: number; missing: string[] }>
}

const TRANSLATABLE_FIELDS = ["name", "description", "metaTitle", "metaDescription"] as const
type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number]

interface CompletenessRow {
    entityId: string
    reference: string
    locales: Record<Locale, { exists: boolean }>
    completeness: Record<Locale, { missing: string[] }>
}

function emptyFields(): TranslationFields {
    return { name: null, description: null, metaTitle: null, metaDescription: null }
}

// The editor round-trips the `TranslationPair` row (which carries `exists` and `dir`) back into
// the save call. Prisma rejects unknown columns, so only the four translatable fields go through.
function pickFields(input: TranslationFields): TranslationFields {
    const trim = (value: string | null | undefined) => {
        const text = value?.trim()
        return text ? text : null
    }
    return {
        name: trim(input.name),
        description: trim(input.description),
        metaTitle: trim(input.metaTitle),
        metaDescription: trim(input.metaDescription),
    }
}

function score(fields: TranslationFields, sku: string | null) {
    const missing: string[] = []
    for (const field of TRANSLATABLE_FIELDS) {
        const value = fields[field]
        const blank =
            field === "name" && sku !== null
                ? isPlaceholderName(value, sku)
                : value === null || value.trim().length === 0
        if (blank) missing.push(field)
    }
    return { filled: TRANSLATABLE_FIELDS.length - missing.length, total: TRANSLATABLE_FIELDS.length, missing }
}

function pair(
    entity: TranslationPair["entity"],
    entityId: string,
    reference: string,
    rows: Array<{ locale: string } & TranslationFields>,
    sku: string | null
): TranslationPair {
    const locales = {} as TranslationPair["locales"]
    const completeness = {} as TranslationPair["completeness"]

    for (const locale of LOCALES) {
        const row = rows.find((r) => r.locale === locale)
        const fields: TranslationFields = row
            ? {
                  name: row.name,
                  description: row.description,
                  metaTitle: row.metaTitle,
                  metaDescription: row.metaDescription,
              }
            : emptyFields()
        locales[locale] = { ...fields, exists: Boolean(row), dir: isRtl(locale) ? "rtl" : "ltr" }
        completeness[locale] = score(fields, sku)
    }

    return { entity, entityId, reference, locales, completeness }
}

export class TranslationService {
    static async forProduct(productId: string): Promise<TranslationPair> {
        await requireCurrentAdmin()
        const product = await prisma.product.findUniqueOrThrow({
            where: { id: productId },
            select: { id: true, productId: true, translations: true },
        })
        return pair("product", product.id, product.productId, product.translations, product.productId)
    }

    static async forSubCategory(subCategoryId: string): Promise<TranslationPair> {
        await requireCurrentAdmin()
        const row = await prisma.subCategory.findUniqueOrThrow({
            where: { id: subCategoryId },
            select: { id: true, translations: true },
        })
        const reference = row.translations.find((t) => t.locale === "en")?.slug ?? row.id
        return pair("subCategory", row.id, reference, row.translations, null)
    }

    static async forCategory(categoryId: string): Promise<TranslationPair> {
        await requireCurrentAdmin()
        const row = await prisma.category.findUniqueOrThrow({
            where: { id: categoryId },
            select: { id: true, translations: true },
        })
        const reference = row.translations.find((t) => t.locale === "en")?.slug ?? row.id
        return pair("category", row.id, reference, row.translations, null)
    }

    static async saveProduct(productId: string, input: Record<Locale, TranslationFields>) {
        const admin = await requireCurrentAdmin()

        await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUniqueOrThrow({
                where: { id: productId },
                select: { productId: true, translations: true },
            })

            for (const locale of LOCALES) {
                const next = pickFields(input[locale])
                await tx.productTranslation.upsert({
                    where: { productId_locale: { productId, locale } },
                    create: { productId, locale, ...next, name: next.name ?? product.productId },
                    update: { ...next, name: next.name ?? product.productId },
                })
            }

            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "translation.save",
                    entity: "Product",
                    entityId: productId,
                    diff: {
                        sku: product.productId,
                        before: product.translations.map((t) => ({
                            locale: t.locale,
                            name: t.name,
                            description: t.description,
                        })),
                        after: LOCALES.map((locale) => ({
                            locale,
                            name: input[locale].name,
                            description: input[locale].description,
                        })),
                    },
                },
            })
        })

        await revalidateStorefront({ kind: "all" })
    }

    /**
     * One pass over the catalogue for both the coverage stats and the work queue. Postgres decides
     * which fields are blank (same rules as score()), so no description or meta text leaves the
     * database; only a few booleans per product and locale do.
     */
    // The blank tests use JS `.trim()`'s whitespace set (NBSP, BOM, Unicode spaces), not just
    // [[:space:]], so the queue and the product tab agree on what is missing.
    private static async completeness(): Promise<CompletenessRow[]> {
        const rows = await prisma.$queryRaw<
            Array<{
                id: string
                sku: string
                locale: string | null
                nameMissing: boolean | null
                descriptionMissing: boolean | null
                metaTitleMissing: boolean | null
                metaDescriptionMissing: boolean | null
            }>
        >`
            SELECT p.id,
                   p."productId" AS sku,
                   t.locale,
                   (t.name IS NULL OR t.name ~ '^[[:space:]   -     　﻿]*$' OR t.name ~ '^[[:space:]   -     　﻿]*-[[:space:]   -     　﻿]*$'
                       OR lower(regexp_replace(t.name, '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')) = lower(p."productId")) AS "nameMissing",
                   (t.description IS NULL OR t.description ~ '^[[:space:]   -     　﻿]*$') AS "descriptionMissing",
                   (t."metaTitle" IS NULL OR t."metaTitle" ~ '^[[:space:]   -     　﻿]*$') AS "metaTitleMissing",
                   (t."metaDescription" IS NULL OR t."metaDescription" ~ '^[[:space:]   -     　﻿]*$') AS "metaDescriptionMissing"
            FROM products p
            LEFT JOIN product_translations t ON t."productId" = p.id AND t.locale = ANY(${[...LOCALES]}::text[])
            WHERE p."deletedAt" IS NULL
            ORDER BY p."productId" ASC`

        const byProduct = new Map<string, CompletenessRow>()
        for (const row of rows) {
            let entry = byProduct.get(row.id)
            if (!entry) {
                entry = { entityId: row.id, reference: row.sku, locales: {}, completeness: {} } as CompletenessRow
                for (const locale of LOCALES) {
                    entry.locales[locale] = { exists: false }
                    entry.completeness[locale] = { missing: [...TRANSLATABLE_FIELDS] }
                }
                byProduct.set(row.id, entry)
            }
            if (row.locale === null || !(LOCALES as readonly string[]).includes(row.locale)) continue
            const locale = row.locale as Locale
            entry.locales[locale] = { exists: true }
            entry.completeness[locale] = {
                missing: [
                    row.nameMissing && "name",
                    row.descriptionMissing && "description",
                    row.metaTitleMissing && "metaTitle",
                    row.metaDescriptionMissing && "metaDescription",
                ].filter((field): field is string => Boolean(field)),
            }
        }
        return [...byProduct.values()]
    }

    private static toQueue(products: CompletenessRow[]) {
        return products
            .map((entry) => ({
                ...entry,
                missingCount: LOCALES.reduce((sum, l) => sum + entry.completeness[l].missing.length, 0),
                absentLocales: LOCALES.filter((l) => !entry.locales[l].exists),
            }))
            .filter((entry) => entry.missingCount > 0)
            .sort(
                (a, b) =>
                    b.absentLocales.length - a.absentLocales.length ||
                    b.missingCount - a.missingCount ||
                    a.reference.localeCompare(b.reference)
            )
    }

    private static toCoverage(products: CompletenessRow[]) {
        const perLocale = {} as Record<Locale, { complete: number; partial: number; absent: number }>
        for (const locale of LOCALES) perLocale[locale] = { complete: 0, partial: 0, absent: 0 }

        for (const p of products) {
            for (const locale of LOCALES) {
                if (!p.locales[locale].exists) perLocale[locale].absent += 1
                else if (p.completeness[locale].missing.length === 0) perLocale[locale].complete += 1
                else perLocale[locale].partial += 1
            }
        }
        return { products: products.length, perLocale }
    }

    /** Coverage stats plus one page of the work queue, from a single query. */
    static async overview(page: number, pageSize: number) {
        await requireCurrentAdmin()
        const products = await this.completeness()
        const queue = this.toQueue(products)
        const totalPages = Math.max(1, Math.ceil(queue.length / pageSize))
        const current = Math.min(Math.max(1, page), totalPages)
        return {
            coverage: this.toCoverage(products),
            queue: { total: queue.length, rows: queue.slice((current - 1) * pageSize, current * pageSize) },
        }
    }

    static async queue(limit = 100) {
        await requireCurrentAdmin()
        const rows = this.toQueue(await this.completeness())
        return { total: rows.length, rows: rows.slice(0, limit) }
    }

    static async coverage() {
        await requireCurrentAdmin()
        return this.toCoverage(await this.completeness())
    }
}

export type { TranslatableField }
