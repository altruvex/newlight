import Link from "next/link"
import { LOCALES } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TranslationService } from "@/lib/services/translation-service"
import { CatalogService } from "@/lib/services/catalog-service"
import { PageBody, PageHeader, PageStack, Section, Stat, StatGrid, TableFrame } from "@/components/page"
import { StatusBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/states"
import { parseTableState } from "@/lib/table-params"
import { QueuePager } from "./queue-pager"

export const dynamic = "force-dynamic"

export default async function TranslationsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    await requireCurrentAdmin()
    const state = parseTableState(await searchParams)

    // One query feeds both the coverage stats and the queue page.
    const [{ queue, coverage }, quality] = await Promise.all([
        TranslationService.overview(state.page, state.pageSize),
        CatalogService.dataQualityQueue(),
    ])

    return (
        <>
            <PageHeader
                title="Translations"
                description="The storefront serves English and Arabic. A product with no Arabic row falls back to its English name in an Arabic page, which reads as a bug to a customer."
            />

            <PageBody>
                <PageStack>
                    <StatGrid className="md:grid-cols-3">
                        {LOCALES.map((locale) => {
                            const c = coverage.perLocale[locale]
                            return (
                                <Stat
                                    key={locale}
                                    label={`${locale.toUpperCase()} complete`}
                                    value={
                                        <>
                                            {c.complete}
                                            <span className="text-sm font-normal text-muted-foreground">
                                                {" / "}
                                                {coverage.products}
                                            </span>
                                        </>
                                    }
                                    hint={`${c.partial} partial · ${c.absent} with no row at all`}
                                    tone={c.absent > 0 ? "warning" : "default"}
                                />
                            )
                        })}
                        <Stat
                            label="Needing work"
                            value={queue.total}
                            hint="products in the queue below"
                            tone={queue.total > 0 ? "warning" : "success"}
                        />
                    </StatGrid>

                    <Section
                        title="Missing translations"
                        description="Worst first: a product with no Arabic row at all outranks one that only lacks a meta description. A name that is just the SKU counts as untranslated, because it is."
                    >
                        <TableFrame className="max-h-[36rem]">
                            {queue.rows.length === 0 ? (
                                <EmptyState
                                    variant="no-data"
                                    title="Every product is fully translated"
                                    description="Both languages carry a name, a description and a meta description for every product in the catalogue."
                                />
                            ) : (
                                <Table>
                                    <caption className="sr-only">Products with incomplete translations</caption>
                                    <TableHeader className="sticky top-0 z-10">
                                        <TableRow>
                                            <TableHead scope="col">SKU</TableHead>
                                            {LOCALES.map((locale) => (
                                                <TableHead key={locale} scope="col" className="uppercase">
                                                    {locale}
                                                </TableHead>
                                            ))}
                                            <TableHead scope="col" className="text-right">
                                                Fields missing
                                            </TableHead>
                                            <TableHead scope="col">
                                                <span className="sr-only">Actions</span>
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {queue.rows.map((row) => (
                                            <TableRow key={row.entityId}>
                                                <TableCell className="font-mono">{row.reference}</TableCell>
                                                {LOCALES.map((locale) => {
                                                    const c = row.completeness[locale]
                                                    return (
                                                        <TableCell key={locale}>
                                                            {!row.locales[locale].exists ? (
                                                                <StatusBadge kind="translation" value="missing" />
                                                            ) : c.missing.length === 0 ? (
                                                                <StatusBadge kind="translation" value="complete" />
                                                            ) : (
                                                                <span className="text-muted-foreground">
                                                                    {c.missing.join(", ")}
                                                                </span>
                                                            )}
                                                        </TableCell>
                                                    )
                                                })}
                                                <TableCell className="text-right tabular-nums">
                                                    {row.missingCount}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                                                        <Link href={`/admin/products/${row.entityId}?tab=translations`}>
                                                            Translate
                                                        </Link>
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </TableFrame>
                        {queue.total > 0 && <QueuePager total={queue.total} />}
                    </Section>

                    <Section
                        title="Data quality"
                        description="Carried across from the v1 catalog exactly as it was, and reported rather than repaired — a migration that quietly improves data is one whose output cannot be checked against its input."
                    >
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                            {[
                                {
                                    label: "Arabic taxonomy names",
                                    value: quality.taxonomyDefects.length,
                                    note: quality.taxonomyDefects
                                        .slice(0, 3)
                                        .map((t) => `${t.name.trim()}${t.untrimmed ? " (trailing space)" : ""}`)
                                        .join(", "),
                                },
                                {
                                    label: "Placeholder specs",
                                    value: quality.placeholderSpecs,
                                    note: 'a stored value of "-" rather than a real measurement',
                                },
                                {
                                    label: "Boolean specs (N4)",
                                    value: quality.booleanSpecs.count,
                                    note: quality.booleanSpecs.sample
                                        .map((s) => `${s.product.productId}/${s.specKey}`)
                                        .join(", "),
                                },
                                {
                                    label: "Products with no image",
                                    value: quality.noImages.count,
                                    note: quality.noImages.sample.map((p) => p.productId).join(", "),
                                },
                                {
                                    label: "Products with no colour",
                                    value: quality.noColors.count,
                                    note: quality.noColors.sample.map((p) => p.productId).join(", "),
                                },
                            ].map((card) => (
                                <div key={card.label} className="rounded-lg border bg-card p-3">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <p className="truncate text-xs text-muted-foreground">{card.label}</p>
                                        <StatusBadge kind="quality" value={card.value > 0 ? "warning" : "ok"} />
                                    </div>
                                    <p
                                        className={`mt-0.5 text-xl font-semibold tabular-nums ${
                                            card.value > 0 ? "text-warning" : ""
                                        }`}
                                    >
                                        {card.value}
                                    </p>
                                    {card.value > 0 && card.note && (
                                        <p className="mt-1.5 font-mono text-2xs break-words text-muted-foreground">
                                            {card.note}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </Section>
                </PageStack>
            </PageBody>
        </>
    )
}
