"use client"

import { formatMoney } from "@repo/database"
import type { ProductVariantView } from "@/lib/services/product-service"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Button } from "./ui/button"

type ProductVariant = ProductVariantView

interface ProductVariantsSelectorProps {
    currentProductId: string
    variants: ProductVariant[]
    categorySlug: string
    subCategorySlug: string
}

export default function ProductVariantsSelector({
    currentProductId,
    variants,
    categorySlug,
    subCategorySlug,
}: ProductVariantsSelectorProps) {
    const locale = useLocale()
    const router = useRouter()
    const [isPending, startTransition] = useTransition()
    const [selectedVariant, setSelectedVariant] = useState(currentProductId)

    if (!variants || variants.length <= 1) {
        return null
    }

    const handleVariantChange = (variant: ProductVariant) => {
        setSelectedVariant(variant.productId)

        startTransition(() => {
            const newUrl = `/${locale}/category/${categorySlug}/${subCategorySlug}/${variant.slug}`
            router.replace(newUrl, { scroll: false })
        })
    }

    const formatVariantLabel = (variant: ProductVariant): string => {
        if (!variant.variantValue) {
            return variant.name
        }

        const value = variant.variantValue.toLowerCase()

        if (variant.family?.variantType === "wattage") {
            return variant.variantValue.toUpperCase()
        } else if (variant.family?.variantType === "length") {
            return variant.variantValue.toUpperCase()
        } else if (variant.family?.variantType === "voltage") {
            return variant.variantValue.toUpperCase()
        } else if (variant.family?.variantType === "height") {
            return value.replace('cm', ' Cm')
        } else if (variant.family?.variantType === "dimensions") {
            return value
                .replace(/\*/g, ' × ')
                .replace(/-cm/g, ' Cm')
                .replace(/cm/g, ' Cm')
        }

        return variant.variantValue.toUpperCase()
    }

    const getVariantTypeLabel = (variantType: string | null): string => {
        if (!variantType) return ""

        const isArabic = locale.startsWith("ar")
        const labels: Record<string, { en: string; ar: string }> = {
            wattage: { en: "Power", ar: "القوة" },
            length: { en: "Length", ar: "الطول" },
            voltage: { en: "Voltage", ar: "الفولت" },
            height: { en: "Height", ar: "الارتفاع" },
            dimensions: { en: "Dimensions", ar: "الأبعاد" },
        }

        return labels[variantType]?.[isArabic ? "ar" : "en"] || variantType
    }

    const variantType = variants[0]?.family?.variantType ?? null
    const typeLabel = getVariantTypeLabel(variantType)
    // Show every option's price once they differ, so the buttons compare like for like
    // instead of being measured against whichever variant happens to sort first.
    const pricesVary = variants.some((variant) => variant.price !== variants[0].price)

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <p className="text-sm uppercase tracking-label text-muted-foreground font-light">
                    {typeLabel}
                </p>
            </div>

            <div className="flex flex-wrap gap-3 transition-all">
                {variants.map((variant) => {
                    const isSelected = selectedVariant === variant.productId
                    const isOutOfStock = false
                    const label = formatVariantLabel(variant)
                    return (
                        <Button
                            key={variant.id}
                            variant="outline"
                            onClick={() => !isOutOfStock && handleVariantChange(variant)}
                            disabled={isOutOfStock || isPending}
                            className={cn(
                                "group relative h-auto min-w-[80px] flex-col gap-0.5 py-2 transition-all duration-300",
                                isSelected
                                    ? "border-accent bg-accent/10 scale-105 shadow-md ease-in-out"
                                    : "border-border hover:border-accent/50 hover:bg-accent/5"
                            )}
                        >
                            <div className="flex items-center justify-center gap-2">
                                <span
                                    className={cn(
                                        "text-sm font-light tracking-wide transition-colors",
                                    )}
                                >
                                    {label}
                                </span>
                                {isSelected && (
                                    <Check aria-hidden className="size-4 text-primary" strokeWidth={2.5} />
                                )}
                            </div>
                            {isOutOfStock && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-sm">
                                    <span className="text-xs text-muted-foreground font-light">
                                        {locale.startsWith("ar") ? "غير متوفر" : "Out of Stock"}
                                    </span>
                                </div>
                            )}
                            {pricesVary && (
                                <span className="text-xs font-light tabular-nums text-muted-foreground">
                                    {formatMoney(variant.price, locale)}
                                </span>
                            )}
                        </Button>
                    )
                })}
            </div>
            {isPending && (
                <div className="flex items-center gap-2 animate-fadeIn">
                    <div className="relative flex items-center rtl:flex-row-reverse">
                        <div className="w-4 h-4 border-2 border-accent/20 rounded-full"></div>
                        <div className="absolute top-0 left-0 w-4 h-4 border-2 border-t-accent border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
                    </div>
                    <span className="text-sm text-muted-foreground font-light">
                        {locale.startsWith("ar") ? "جاري التحديث..." : "Updating..."}
                    </span>
                </div>
            )}
        </div>
    )
}