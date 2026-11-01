"use client"

import type { SearchResult } from "@/actions/search"
import { formatMoney } from "@repo/database"
import { searchProducts } from "@/actions/search"
import { DirectionalArrow } from "@/components/directional-arrow"
import { Input } from "@/components/ui/input"
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Search, X, Loader2, Zap, Droplet } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link, useRouter } from "@/i18n/navigation"
import Image from "@/components/app-image"
import { useDebounce } from "use-debounce"
import { useTranslations, useLocale } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { PriceTag } from "@/components/price-tag"

interface Product {
    id: string
    productId: string
    slug: string
    price: number
    images: string[]
    name: string
    description?: string | null
    categoryName?: string
    categorySlug?: string
    subCategoryName?: string
    subCategorySlug?: string
    maxWattage?: number | null
    voltage?: string | null
    colorTemperatures?: string[]
    ipRating?: string | null
}

const MIN_SEARCH_LENGTH = 2

export function SearchSheet() {
    const t = useTranslations('search')
    const tLogo = useTranslations("nav")
    const locale = useLocale()
    const [open, setOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [debouncedSearchTerm] = useDebounce(searchQuery, 300)
    const [filteredProducts, setFilteredProducts] = useState<SearchResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const router = useRouter()

    useEffect(() => {
        if (open && inputRef.current) {
            setTimeout(() => {
                inputRef.current?.focus()
            }, 100)
        }
    }, [open])

    // A newer query (or closing the sheet) bumps the counter, so a slow earlier response is dropped.
    const requestRef = useRef(0)

    useEffect(() => {
        const term = debouncedSearchTerm.trim()
        const request = ++requestRef.current
        if (term.length < MIN_SEARCH_LENGTH) return

        const run = async () => {
            setIsSearching(true)
            try {
                const results = await searchProducts(term, locale)
                if (request === requestRef.current) setFilteredProducts(results)
            } catch (error) {
                console.error("Error searching products:", error)
                if (request === requestRef.current) setFilteredProducts([])
            } finally {
                if (request === requestRef.current) setIsSearching(false)
            }
        }
        void run()
    }, [debouncedSearchTerm, locale])

    // Too-short queries never reach the server; the view ignores any leftover results then.
    const searchable = searchQuery.trim().length >= MIN_SEARCH_LENGTH
    const searching = isSearching && searchable

    const handleOpenChange = (isOpen: boolean) => {
        setOpen(isOpen)
        if (!isOpen) {
            requestRef.current++
            setSearchQuery("")
            setFilteredProducts([])
            setIsSearching(false)
        }
    }

    const handleResultClick = () => {
        setOpen(false)
        setSearchQuery("")
        setFilteredProducts([])
    }

    const formatColorTemp = (temp: string) => {
        const tempMap: Record<string, string> = {
            WARM_3000K: "3000K",
            COOL_4000K: "4000K",
            WHITE_6500K: "6500K",
        }
        return tempMap[temp] || temp
    }

    const popularSearches = [
        t('suggestions.indoor'),
        t('suggestions.outdoor'),
    ]

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetTrigger asChild>
                <button className="group rounded-lg p-2 transition-all duration-200 hover:bg-secondary">
                    <Search className="h-5 w-5" />
                    <span className="sr-only">{t('button')}</span>
                </button>
            </SheetTrigger>
            <SheetContent
                side="top"
                className="w-full border-b border-border h-screen data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            >
                <SheetTitle className="sr-only">{t('button')}</SheetTitle>
                <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between px-8 py-6 border-b border-border">
                        <div className="flex items-baseline gap-1">
                            <span className="text-xl font-extrabold tracking-tight uppercase">
                                {tLogo('logoNew')}
                            </span>
                            <span className="text-xl font-light tracking-wordmark uppercase">
                                {tLogo('logoLight')}
                            </span>
                        </div>
                        <SheetClose asChild>
                            <button className="rounded-lg p-2 transition-all duration-200 hover:bg-secondary">
                                <X className="h-6 w-6 text-foreground" />
                                <span className="sr-only">{t('close')}</span>
                            </button>
                        </SheetClose>
                    </div>
                    <div className="flex-1 overflow-y-auto hide-scrollbar">
                        <div className="container mx-auto max-w-3xl px-8 py-12">
                            <form
                                role="search"
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    const term = searchQuery.trim()
                                    if (!term) return
                                    handleResultClick()
                                    router.push(`/search?q=${encodeURIComponent(term)}`)
                                }}
                                className="relative"
                            >
                                <Search
                                    aria-hidden
                                    className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                                />
                                <Input
                                    ref={inputRef}
                                    type="search"
                                    name="q"
                                    aria-label={t('placeholder')}
                                    placeholder={t('placeholder')}
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value)
                                        // A short term orphans the request in flight (its `finally`
                                        // is skipped), so clear the spinner here.
                                        if (e.target.value.trim().length < MIN_SEARCH_LENGTH) setIsSearching(false)
                                    }}
                                    className="h-14 w-full ps-12 pe-12 text-lg"
                                />
                                {searching && (
                                    <div className="absolute end-4 top-1/2 -translate-y-1/2">
                                        <Loader2 aria-hidden className="h-5 w-5 animate-spin text-muted-foreground" />
                                        <span className="sr-only">{t('searching', { query: searchQuery })}</span>
                                    </div>
                                )}
                            </form>
                            <div className="mt-8 space-y-6">
                                {searchQuery ? (
                                    <>
                                        {!searchable ? (
                                            <p className="py-12 text-center text-sm text-muted-foreground">
                                                {t('minChars', { count: MIN_SEARCH_LENGTH })}
                                            </p>
                                        ) : searching ? (
                                            <div className="text-center py-12">
                                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                                                <p className="text-sm text-muted-foreground">
                                                    {t('searching', { query: searchQuery })}
                                                </p>
                                            </div>
                                        ) : filteredProducts.length > 0 ? (
                                            <>
                                                <div className="mb-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
                                                    <span>{t('count', { count: filteredProducts.length })}</span>
                                                    <Link
                                                        href={`/search?q=${encodeURIComponent(searchQuery.trim())}`}
                                                        onClick={handleResultClick}
                                                        className="group inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
                                                    >
                                                        {t('seeAll')}
                                                        <DirectionalArrow />
                                                    </Link>
                                                </div>
                                                <div className="space-y-2">
                                                    {filteredProducts.map((product) => (
                                                        <Link
                                                            key={product.id}
                                                            href={`/category/${product.categorySlug}/${product.subCategorySlug}/${product.productId}`}
                                                            onClick={handleResultClick}
                                                            className="block group"
                                                        >
                                                            <div className="flex items-start gap-4 px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors">
                                                                {product.images[0]?.url && (
                                                                    <div className="relative w-20 h-20 rounded-md overflow-hidden bg-muted shrink-0">
                                                                        <Image
                                                                            src={product.images[0].url}
                                                                            alt={product.name}
                                                                            fill
                                                                            sizes="80px"
                                                                            className="object-cover"
                                                                        />
                                                                    </div>
                                                                )}
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-medium text-foreground group-hover:text-foreground/80 transition-colors truncate">
                                                                        {product.name}
                                                                    </p>
                                                                    {product.description && (
                                                                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                                                                            {product.description}
                                                                        </p>
                                                                    )}
                                                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                                        {product.categoryName && (
                                                                            <Badge variant="secondary" className="text-xs">
                                                                                {product.categoryName}
                                                                            </Badge>
                                                                        )}
                                                                        {product.subCategoryName && (
                                                                            <Badge variant="outline" className="text-xs">
                                                                                {product.subCategoryName}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                                                        {product.maxWattage && (
                                                                            <div className="flex items-center gap-1">
                                                                                <span>{product.maxWattage}W</span>
                                                                            </div>
                                                                        )}
                                                                        {product.voltage && (
                                                                            <span>{product.voltage}</span>
                                                                        )}
                                                                        {product.ipRating && (
                                                                            <div className="flex items-center gap-1">
                                                                                <span>{product.ipRating}</span>
                                                                            </div>
                                                                        )}
                                                                        {product.colorTemperatures && product.colorTemperatures.length > 0 && (
                                                                            <span>
                                                                                {product.colorTemperatures.map(formatColorTemp).join(", ")}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="shrink-0 text-end">
                                                                    <PriceTag
                                                                        price={product.price}
                                                                        basePrice={product.basePrice}
                                                                        size="sm"
                                                                        className="justify-end"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </Link>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-center py-12">
                                                <div className="mb-4">
                                                    <Search className="h-12 w-12 text-muted-foreground mx-auto" />
                                                </div>
                                                <p className="text-sm text-muted-foreground mb-2">
                                                    {t('noResults', { query: searchQuery })}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    Try searching by product name, category, wattage, IP rating, or specifications
                                                </p>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div>
                                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-label mb-4">
                                            {t('popularSearches')}
                                        </h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {popularSearches.map((item) => (
                                                <button
                                                    key={item}
                                                    onClick={() => setSearchQuery(item)}
                                                    className="text-left px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors text-foreground text-sm border border-border"
                                                >
                                                    {item}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="px-8 py-6 border-t border-border">
                        <p className="text-sm text-muted-foreground font-light">
                            {t('footer')}
                        </p>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}