"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { usePathname, useRouter } from "@/i18n/navigation"
import { useSearchParams } from "next/navigation"
import { encodeSlug } from "@repo/database"

import { CompareToggle } from "@/components/compare/compare-toggle"
import { CompareTray } from "@/components/compare/compare-tray"
import { ProductCard } from "@/components/product-card"
import { ProductFilterBar } from "@/components/product-filter-bar"
import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import {
    EMPTY_FILTERS,
    filtersFromParams,
    filtersToParams,
    type ListingFilters,
} from "@/lib/services/product-facets"
import type { SearchListing } from "@/lib/services/search-service"

export function SearchResults({ listing, query }: { listing: SearchListing; query: string }) {
    const t = useTranslations("search")
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    const filters: ListingFilters = useMemo(
        () => filtersFromParams(new URLSearchParams(searchParams.toString())),
        [searchParams]
    )

    // The server already filtered, sorted and paged; this renders the page as given.
    const entries = listing.entries

    // A filter change is a new server render; dropping `page` starts the new result at page 1.
    function updateFilters(next: ListingFilters) {
        const params = filtersToParams(next, { q: query })
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }

    return (
        <>
            <ProductFilterBar
                facets={listing.facets}
                filters={filters}
                resultCount={listing.total}
                onChange={updateFilters}
            />

            {entries.length === 0 ? (
                <EmptyState
                    variant="no-results"
                    title={t("noMatches")}
                    description={t("noMatchesBody")}
                    action={
                        <div className="flex flex-wrap justify-center gap-3">
                            <Button
                                size="lg"
                                variant="outline"
                                onClick={() => updateFilters({ ...EMPTY_FILTERS, sort: filters.sort })}
                            >
                                {t("clearFilters")}
                            </Button>
                            <Button asChild size="lg">
                                <Link href="/category">{t("browseInstead")}</Link>
                            </Button>
                        </div>
                    }
                    className="mt-10 rounded-lg border bg-surface-sunk"
                />
            ) : (
                <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:mt-10 lg:grid-cols-3 lg:gap-8 xl:grid-cols-4">
                    {entries.map((entry) => {
                        const product = entry.product
                        return (
                            <Link
                                key={product.id}
                                href={`/category/${encodeSlug(entry.categorySlug ?? "")}/${encodeSlug(
                                    entry.subCategorySlug ?? ""
                                )}/${encodeSlug(product.slug)}`}
                                className="block"
                            >
                                <ProductCard
                                    image={product.image ?? "/lighting-product.jpg"}
                                    title={product.name}
                                    category={entry.sectionName ?? ""}
                                    price={product.price}
                                    basePrice={product.basePrice}
                                    discountPercent={product.discountPercent}
                                    stock={product.stockStatus}
                                    action={<CompareToggle sku={product.productId} />}
                                />
                            </Link>
                        )
                    })}
                </div>
            )}

            <CompareTray />
        </>
    )
}
