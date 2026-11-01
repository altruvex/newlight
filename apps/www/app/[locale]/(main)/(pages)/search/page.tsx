import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { encodeSlug, resolveLocale } from "@repo/database"

import { Container, PageHeader } from "@/components/layout/section"
import { DirectionalArrow } from "@/components/directional-arrow"
import { EmptyState } from "@/components/states"
import { SearchResults } from "@/components/search-results"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { Pager } from "@/components/pager"
import { SEARCH_PAGE_SIZE, SearchService, searchListing } from "@/lib/services/search-service"
import { filtersFromParams, filtersToParams } from "@/lib/services/product-facets"
import { constructMetadata } from "@/lib/metadata"
import { createPageCanonicalUrl } from "@/lib/canonical-url"
import type { SupportedLanguage } from "@/types"

export const dynamic = "force-dynamic"

export async function generateMetadata({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>
}): Promise<Metadata> {
    const { q } = await searchParams
    const t = await getTranslations("search")
    const locale = (await getLocale()) as SupportedLanguage

    // Canonical (and the index) points at the bare /search page — one result set per query
    // string is exactly the kind of thin, near-duplicate page Google asks sites not to index.
    return constructMetadata({
        title: q ? t("resultsTitleFor", { query: q }) : t("resultsTitle"),
        description: t("resultsDescription"),
        locale,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "search" }),
        noIndex: true,
    })
}

type SearchPageParams = Record<string, string | string[] | undefined>

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchPageParams> }) {
    const raw = await searchParams
    const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
    const q = first(raw.q)
    const pageParam = first(raw.page)
    // Filters and sort apply to every match on the server; the pager keeps them with the query.
    const urlParams = new URLSearchParams()
    for (const key of Object.keys(raw)) {
        const value = first(raw[key])
        if (value !== undefined) urlParams.set(key, value)
    }
    const filters = filtersFromParams(urlParams)
    const requestedPage = Math.max(1, Math.floor(Number(pageParam ?? 1)) || 1)
    const query = (q ?? "").trim()
    const locale = resolveLocale(await getLocale())
    const t = await getTranslations("search")

    const [results, listing] = await Promise.all([
        query
            ? SearchService.searchTaxonomy(query, locale, 48)
            : Promise.resolve({ categories: [], subCategories: [] }),
        query
            ? searchListing(query, locale, requestedPage, SEARCH_PAGE_SIZE, filters)
            : Promise.resolve(null),
    ])
    const totalPages = Math.max(1, Math.ceil((listing?.total ?? 0) / SEARCH_PAGE_SIZE))
    const page = Math.min(requestedPage, totalPages)

    const taxonomy = [
        ...results.categories.map((c) => ({
            id: c.id,
            name: c.name,
            href: `/category/${encodeSlug(c.slug)}`,
            context: undefined as string | undefined,
        })),
        ...results.subCategories.map((s) => ({
            id: s.id,
            name: s.name,
            href: `/category/${encodeSlug(s.categorySlug ?? "")}/${encodeSlug(s.slug)}`,
            context: s.categoryName,
        })),
    ]

    const productCount = listing?.total ?? 0
    const total = productCount + taxonomy.length
    // Matches before filters: a filter that leaves nothing still shows the filter bar to undo it.
    const matched = (listing?.facets.total ?? 0) + taxonomy.length

    return (
        <>
            <PageHeader
                eyebrow={t("eyebrow")}
                title={query ? t("resultsFor", { query }) : t("resultsTitle")}
                description={query ? t("count", { count: total }) : t("prompt")}
            />

            <Container className="py-10 lg:py-14">
                {!query ? (
                    <EmptyState
                        variant="no-results"
                        title={t("prompt")}
                        description={t("promptBody")}
                        action={
                            <Button asChild size="lg" className="group">
                                <Link href="/category">
                                    {t("browseInstead")}
                                    <DirectionalArrow />
                                </Link>
                            </Button>
                        }
                        className="rounded-lg border bg-surface-sunk"
                    />
                ) : matched === 0 ? (
                    <EmptyState
                        variant="no-results"
                        title={t("noResults", { query })}
                        description={t("noResultsBody")}
                        action={
                            <Button asChild size="lg" className="group">
                                <Link href="/category">
                                    {t("browseInstead")}
                                    <DirectionalArrow />
                                </Link>
                            </Button>
                        }
                        className="rounded-lg border bg-surface-sunk"
                    />
                ) : (
                    <div className="space-y-14">
                        {taxonomy.length > 0 && (
                            <section aria-labelledby="search-sections">
                                <h2
                                    id="search-sections"
                                    className="mb-5 text-xs font-medium tracking-label text-muted-foreground uppercase"
                                >
                                    {t("sections")}
                                </h2>
                                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {taxonomy.map((entry) => (
                                        <li key={entry.id}>
                                            <Link
                                                href={entry.href}
                                                className="group flex items-center justify-between gap-4 rounded-lg border bg-card p-4 transition-colors duration-(--duration-fast) hover:border-border-strong"
                                            >
                                                <span className="min-w-0">
                                                    <span className="block truncate font-medium">
                                                        <bdi dir="auto">{entry.name}</bdi>
                                                    </span>
                                                    {entry.context && (
                                                        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                                                            <bdi dir="auto">{entry.context}</bdi>
                                                        </span>
                                                    )}
                                                </span>
                                                <DirectionalArrow variant="circled" />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {listing && listing.facets.total > 0 && (
                            <section aria-labelledby="search-products">
                                <h2
                                    id="search-products"
                                    className="mb-5 text-xs font-medium tracking-label text-muted-foreground uppercase"
                                >
                                    {t("products", { count: listing.total })}
                                </h2>
                                <SearchResults listing={listing} query={query} />
                                <Pager
                                    page={page}
                                    totalPages={totalPages}
                                    basePath="/search"
                                    params={Object.fromEntries(filtersToParams(filters, { q: query }))}
                                />
                            </section>
                        )}
                    </div>
                )}
            </Container>
        </>
    )
}
