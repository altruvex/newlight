"use client"

import Image from "@/components/app-image"
import { DirectionalArrow } from "@/components/directional-arrow"
import { DiscountBadge, PriceTag } from "@/components/price-tag"
import { Reveal } from "@/components/reveal"
import { StockChip } from "@/components/stock-status"
import type { StockStatus } from "@/lib/stock"
import { cn } from "@/lib/utils"
import { type SerializedMoney } from "@repo/database"
import { useTranslations } from "next-intl"

interface ProductCardProps {
    image: string
    title: string
    category: string
    price: SerializedMoney
    basePrice?: SerializedMoney
    discountPercent?: number
    badge?: string
    /**
     * Two or three specs, already labelled and collapsed by `quickSpecs`. A lighting tile that
     * shows a photo, a name and a price makes a customer open it to learn its wattage.
     */
    specs?: Array<{ label: string; value: string }>
    /**
     * Availability, rendered as a chip over the image. `StockChip` draws nothing for `"in"`, so a
     * grid of stocked products stays quiet and only the low and sold-out tiles speak up.
     */
    stock?: StockStatus
    /** A compare checkbox, rendered over the image. Listings pass one; strips do not. */
    action?: React.ReactNode
    onClick?: () => void
}

export function ProductCard({
    image,
    title,
    category,
    price,
    basePrice,
    discountPercent = 0,
    badge,
    specs,
    stock,
    action,
    onClick,
}: ProductCardProps) {
    const t = useTranslations("product-card")

    return (
        <Reveal
            onClick={onClick}
            className={cn(
                "group relative overflow-hidden rounded-lg border bg-card",
                "transition-[box-shadow,translate,scale] duration-(--duration-base) ease-out-fast",
                "hover:-translate-y-0.5 hover:shadow-overlay",
                "active:scale-[0.99] active:duration-(--duration-fast)"
            )}
        >
            <div className="relative aspect-square overflow-hidden">
                <Image
                    src={image || "/placeholder.svg"}
                    alt={title}
                    width={500}
                    height={500}
                    // Matches the listing grids (1 / 2 / 3 / 4 columns at sm / lg / xl); carousel
                    // tiles are narrower (260-320px), so this never under-fetches for them.
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                    data-reveal-media
                    className={cn(
                        "size-full object-cover",
                        "transition-[scale,filter] duration-(--duration-slow) ease-out-fast",
                        "group-hover:scale-105",
                        "group-active:scale-[1.02] group-active:duration-(--duration-fast)"
                    )}
                    priority={false}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-foreground/5 opacity-0 transition-opacity duration-(--duration-slow) ease-out-fast group-hover:opacity-100">
                    <div className="translate-y-4 transition-[translate] duration-(--duration-slow) ease-out-fast group-hover:translate-y-0">
                        <span className="rounded-full bg-background/95 px-6 py-2.5 text-xs font-medium uppercase tracking-widest text-foreground shadow-overlay">
                            {t("view")}
                        </span>
                    </div>
                </div>
                {badge && (
                    <div className="absolute top-4 inset-s-4 z-10 bg-foreground backdrop-blur-sm text-muted-foreground px-3 py-1 rounded-sm">
                        <p className="text-[10px] font-bold uppercase tracking-widest">{badge}</p>
                    </div>
                )}
                {discountPercent > 0 && (
                    <DiscountBadge percent={discountPercent} className="absolute top-4 inset-e-4 z-10 backdrop-blur-sm" />
                )}
                {action && (
                    <div className={cn("absolute inset-e-4 z-20", discountPercent > 0 ? "top-16" : "top-4")}>{action}</div>
                )}
                {stock && <StockChip status={stock} className="absolute bottom-4 inset-s-4 z-10" />}
            </div>
            <div className="space-y-2 p-4">
                <div className="space-y-1">
                    <p className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
                        {category}
                    </p>
                    <h3 className="font-display text-lg italic tracking-tight text-foreground transition-colors duration-300 lg:text-2xl">
                        {title}
                    </h3>
                </div>
                {specs && specs.length > 0 && (
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {specs.map((spec) => (
                            <div key={spec.label} className="flex min-w-0 items-baseline gap-1.5">
                                <dt className="truncate">{spec.label}</dt>
                                <dd className="font-medium text-foreground tabular-nums">{spec.value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
                <div className="flex flex-row items-center justify-between gap-3 border-t border-border/50 pt-4">
                    <PriceTag price={price} basePrice={basePrice} size="md" />
                    <DirectionalArrow variant="circled" />
                </div>
            </div>
        </Reveal>
    )
}