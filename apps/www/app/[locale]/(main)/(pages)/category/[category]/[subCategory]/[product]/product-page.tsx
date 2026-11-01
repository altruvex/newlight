"use client"

import { type ProductColorTemp } from "@repo/database"
import { addToCart } from "@/actions/cart"
import { saveConfiguration } from "@/actions/configuration"
import ProductColorTempButtons from "@/components/color-temp-buttons"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { BulkOrderDialog } from "@/components/bulk-order-dialog"
import { Container } from "@/components/layout/section"
import ProductVariantsSelector from "@/components/product-variants-selector"
import { Reveal } from "@/components/reveal"
import { StockIndicator, formatCount } from "@/components/stock-status"
import ProductSurfaceColorButtons from "@/components/surface-color-button"
import { Button } from "@/components/ui/button"
import { Link, useRouter } from "@/i18n/navigation"
import type { ProductPageView } from "@/lib/services/product-service"
import { DiscountBadge, PriceTag } from "@/components/price-tag"
import { useSession } from "@/lib/auth-client"
import { useMutation } from "@tanstack/react-query"
import { Minus, Plus, ShoppingCart } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import Image from "@/components/app-image"
import { startTransition, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface ProductPageProps {
    assurance?: React.ReactNode
    product: ProductPageView
}

export default function ProductIdPage({ product, assurance }: ProductPageProps) {
    const t = useTranslations("product-page")
    const locale = useLocale()
    const { data: session } = useSession()
    const isSignedIn = Boolean(session?.user)
    const router = useRouter()

    const [selectedImageIndex, setSelectedImageIndex] = useState(0)
    const [selectedColorTemp, setSelectedColorTemp] = useState<string>(product.colorTemperatures[0] || "")
    const availableColorKeys = product.colorKeys
    const [surfaceColor, setSurfaceColor] = useState<string>(availableColorKeys[0] ?? "")
    const [quantity, setQuantity] = useState(1)
    const [isAddingToCart, setIsAddingToCart] = useState(false)

    const stockStatus = product.stockStatus
    const isOutOfStock = stockStatus === "out"
    const maxQuantity = Math.max(1, product.stockAvailable)
    const atMaxQuantity = !isOutOfStock && quantity >= maxQuantity

    const productTranslation = product.translation
    const subCategoryTranslation = product.subCategory

    const productName = productTranslation?.name || product.productId
    const productDescription = productTranslation?.description
    const subCategoryName = subCategoryTranslation?.name ?? ""
    const categoryName = product.category?.name ?? ""
    const subCategorySlug = subCategoryTranslation?.slug ?? ""
    const categorySlug = product.category?.slug ?? ""

    const { mutate: saveConfig, isPending: isSaving } = useMutation({
        mutationKey: ["save-configuration", product.productId],
        mutationFn: () =>
            saveConfiguration({
                productId: product.productId,
                quantity,
                selectedColorTemp: selectedColorTemp || undefined,
                selectedColorKey: surfaceColor || undefined,
            }),
        onSuccess: (result) => {
            if (result && typeof result === 'object' && 'success' in result && result.success && 'configId' in result && result.configId) {
                if ('cacheCleared' in result && !result.cacheCleared) {
                    toast.warning(t("configurationSaved"), {
                        description: t("cacheClearingFailed"),
                    })
                } else {
                    toast.success(t("configurationSaved"), {
                        description: t("redirectingToPreview"),
                    })
                }
                router.push(`/preview/${result.configId}`)
            } else {
                toast.error(t("configurationError"), {
                    description: t("pleaseTryAgain"),
                })
            }
        },
        onError: (error) => {
            console.error("Failed to save configuration:", error)
            toast.error(t("configurationError"), {
                description: t("pleaseTryAgain"),
            })
        },
    })

    const handleOrderNow = useCallback(() => {
        if (isSaving) return

        if (quantity < 1) {
            toast.error(t("invalidQuantity"))
            return
        }

        saveConfig()
    }, [isSaving, quantity, saveConfig, t])

    const handleAddToCart = useCallback(() => {
        if (isAddingToCart) return

        setIsAddingToCart(true)

        if (!isSignedIn) {
            toast.error(t("signInRequired.title"), {
                description: t("signInRequired.description")
            })
            setIsAddingToCart(false)
            return
        }

        startTransition(async () => {
            try {
                const result = await addToCart(
                    product.productId,
                    quantity,
                    selectedColorTemp as ProductColorTemp | undefined,
                    surfaceColor
                )

                if (!result?.success) {
                    toast.error(t("error"), {
                        description: result?.error === "INSUFFICIENT_STOCK"
                            ? t("insufficientStock")
                            : t("failedToAddToCart"),
                    })
                    return
                }

                toast.success(t("addedToCart"), {
                    description: `${productName} ${t("addedToCart").toLowerCase()}`,
                })
            } catch (error) {
                console.error("Failed to add to cart", error)
                toast.error(t("error"), {
                    description: t("failedToAddToCart"),
                })
            } finally {
                setIsAddingToCart(false)
            }
        })
    }, [isSignedIn, isAddingToCart, quantity, product.productId, selectedColorTemp, surfaceColor, productName, t])

    const formatAvailableColor = (color: string, isArabic: boolean): string => {
        const map: Record<string, string> = {
            BLACK: isArabic ? "أسود" : "Black",
            GRAY: isArabic ? "رمادي" : "Gray",
            WHITE: isArabic ? "أبيض" : "White",
            GOLD: isArabic ? "ذهبي" : "Gold",
            WOOD: isArabic ? "خشبي" : "Wood",
        }
        return map[color] || color.replace(/_/g, " ")
    }

    const formatLabel = (label: string, isArabic: boolean): string => {
        if (isArabic) {
            return label
        }

        const lowerLabel = label.toLowerCase()
        if (lowerLabel === "ip" || lowerLabel === "ip_rating" || lowerLabel === "iprating") {
            return "IP"
        }
        if (lowerLabel === "maxip" || lowerLabel === "max_ip" || lowerLabel === "maxiprating") {
            return "Max IP"
        }

        return label
            .replace(/_/g, " ")
            .replace(/([A-Z])/g, " $1")
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(" ")
            .trim()
    }

    const preferredOrder = [
        "input",
        "المدخل",
        "voltage",
        "الفولت",
        "maximum_wattage",
        "أقصى قوة كهربائية",
        "brand_of_led",
        "علامة الليد التجارية",
        "luminous_flux",
        "اللومن",
        "main_material",
        "مادة التصنيع",
        "cri",
        "مؤشر تجسيد الألوان",
        "beam_angle",
        "زاوية الإضاءة",
        "working_temperature",
        "درجة حرارة التشغيل",
        "fixture_dimmable",
        "قابل للتعتيم",
        "electrical",
        "الكهرباء",
        "driver",
        "المحرك",
        "power_factor",
        "معامل القدرة",
        "color_temperature",
        "درجة حرارة اللون",
        "ip_rating",
        "درجة الحماية",
        "ip",
        "maxip",
        "أقصى درجة حماية",
        "energy_saving",
        "توفير الطاقة",
        "life_time",
        "العمر الافتراضي",
        "product_dimensions",
        "أبعاد المنتج",
        "hole_size",
        "حجم الفتحة",
        "surface_color",
        "لون السطح",
        "available_colors",
        "الالوان المتوفرة",
    ] as const

    const formatter = new Intl.NumberFormat(locale, {
        maximumFractionDigits: 2,
        ...(locale.startsWith("ar") ? { numberingSystem: "arab" } : {}),
    })

    const formatNumber = (value: number | string): string => {
        const num = typeof value === "number" ? value : parseFloat(value.toString())
        if (!isNaN(num) && isFinite(num)) {
            return formatter.format(num)
        }
        return value.toString()
    }

    const formatColorTemps = (temps: string[]) => {
        const isArabic = locale.startsWith("ar")
        const map: Record<string, string> = {
            WARM_3000K: isArabic ? "دافئ 3000K" : "Warm 3000K",
            COOL_4000K: isArabic ? "بارد 4000K" : "Cool 4000K",
            WHITE_6500K: isArabic ? "أبيض 6500K" : "White 6500K",
        }
        const joiner = isArabic ? " / " : " / "
        return temps.map((temp) => map[temp] || temp.replace(/_/g, " ").toLowerCase()).join(joiner)
    }

    const formatValue = (label: string, value: string | number | string[]) => {
        if (value === null || value === undefined || value === "") return ""

        const isArabic = locale.startsWith("ar")
        const joiner = isArabic ? " ، " : ", "

        if (Array.isArray(value)) {
            const normalizedLabel = label.toLowerCase()

            if (
                ["surface_color", "لون السطح", "available_colors", "الالوان المتوفرة", "color"].some((l) =>
                    normalizedLabel.includes(l.toLowerCase()),
                )
            ) {
                return value.map(color => formatAvailableColor(color, isArabic)).join(joiner)
            }

            return value.map((v) => `${formatNumber(v)}K`).join(joiner)
        }

        const normalizedLabel = label.toLowerCase()

        if (
            ["surface_color", "لون السطح", "available_colors", "الالوان المتوفرة"].some((l) =>
                normalizedLabel.includes(l.toLowerCase()),
            )
        ) {
            return formatAvailableColor(value.toString(), isArabic)
        }

        if (["أقصى قوة كهربائية", "maximum_wattage", "wattage"].some((l) => normalizedLabel.includes(l.toLowerCase()))) {
            const unit = isArabic ? "وات" : "W"
            return `${formatNumber(value)} ${unit}`
        }

        if (["درجة الحماية القصوي", "maxip", "max_ip"].some((l) => normalizedLabel.includes(l.toLowerCase()))) {
            return formatNumber(value)
        }

        if (["درجة حرارة اللون", "color_temperature"].some((l) => normalizedLabel.includes(l.toLowerCase()))) {
            return value.toString()
        }

        if (["اللومن", "luminous_flux", "luminous flux"].some((l) => normalizedLabel.includes(l.toLowerCase()))) {
            const unit = isArabic ? "لومن" : "lm"
            return `${formatNumber(value)} ${unit}`
        }

        if (["العمر الافتراضي", "life_time", "lifetime"].some((l) => normalizedLabel.includes(l.toLowerCase()))) {
            const unit = isArabic ? "ساعة" : "hours"
            return `${formatNumber(value)} ${unit}`
        }

        if (["زاوية الإضاءة", "beam_angle"].some((l) => normalizedLabel.includes(l.toLowerCase()))) {
            return `${formatNumber(value)}°`
        }

        if (["توفير الطاقة", "energy_saving"].some((l) => normalizedLabel.includes(l.toLowerCase()))) {
            return `${formatNumber(value)}%`
        }

        return value.toString()
    }

    const isArabic = locale.startsWith("ar")
    const isMagneticAccessories = product.specs.length === 0

    const specEntries = product.specs.flatMap((row) => {
        const value = isArabic ? row.valueAr : row.valueEn
        if (!value || value === "-") return []
        const unit = isArabic ? row.spec.unitAr : row.spec.unitEn
        return [{
            originalLabel: row.specKey,
            label: isArabic ? row.spec.labelAr : row.spec.labelEn,
            value: unit ? `${value} ${unit}` : value,
        }]
    })

    if (!isMagneticAccessories && product.colorTemperatures.length > 0) {
        const colorTempLabel = isArabic ? "درجة حرارة اللون" : "Color Temperature"
        specEntries.push({
            originalLabel: "color_temperature",
            label: colorTempLabel,
            value: formatColorTemps(product.colorTemperatures),
        })
    }

    const specifications = [...specEntries].sort((a, b) => {
        const normalizeKey = (key: string) => key.toLowerCase().replace(/\s+/g, "_")

        const ia = preferredOrder.findIndex(
            (order) => normalizeKey(order) === normalizeKey(a.originalLabel) || normalizeKey(order) === normalizeKey(a.label),
        )
        const ib = preferredOrder.findIndex(
            (order) => normalizeKey(order) === normalizeKey(b.originalLabel) || normalizeKey(order) === normalizeKey(b.label),
        )

        if (ia !== -1 && ib !== -1) return ia - ib
        if (ia !== -1) return -1
        if (ib !== -1) return 1
        return a.label.localeCompare(b.label, isArabic ? "ar" : "en")
    })

    return (
        <main className="min-h-screen">
            <div className="border-b border-border py-24">
                <Container>
                    <Breadcrumbs
                        className="py-5"
                        items={[
                            { name: categoryName, href: `/category/${categorySlug}` },
                            { name: subCategoryName, href: `/category/${categorySlug}/${subCategorySlug}` },
                            { name: productName },
                        ]}
                    />
                </Container>
            </div>
            <section className="py-12 lg:py-20">
                <Container>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 xl:gap-20 items-start">
                        <div className="space-y-4 lg:sticky lg:top-8">
                            <div className="relative aspect-square overflow-hidden">
                                {product.images.length > 0 ? (
                                    <Image
                                        src={product.images[selectedImageIndex]?.url ?? product.images[0]!.url}
                                        alt={productName}
                                        fill
                                        sizes="(max-width: 1024px) 100vw, (max-width: 1280px) 50vw, 600px"
                                        className="object-contain p-6 transition-opacity duration-300"
                                        priority
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground font-light text-sm tracking-wide">
                                        {t("noImage")}
                                    </div>
                                )}
                                {product.isFeatured && (
                                    <div className="absolute top-4 ltr:left-4 rtl:right-4 z-10">
                                        <span className="px-3 py-1 bg-primary text-primary-foreground text-2xs uppercase tracking-label font-medium">
                                            {t("featured")}
                                        </span>
                                    </div>
                                )}
                            </div>
                            {product.images.length > 1 && (
                                <div className="grid grid-cols-5 gap-2">
                                    {product.images.map((image, index) => (
                                        <button
                                            key={index}
                                            onClick={() => setSelectedImageIndex(index)}
                                            className={`relative aspect-square bg-muted overflow-hidden border transition-all duration-200 ${selectedImageIndex === index
                                                ? "border-foreground"
                                                : "border-border hover:border-border"
                                                }`}
                                            aria-label={`${t("viewImage")} ${index + 1}`}
                                        >
                                            <Image
                                                src={image.url}
                                                alt={`${productName} - ${index + 1}`}
                                                fill
                                                sizes="(max-width: 1024px) 20vw, (max-width: 1280px) 10vw, 120px"
                                                className="object-contain p-1"
                                            />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="space-y-8">
                            <div className="space-y-5">
                                <p className="text-xs uppercase tracking-label text-primary font-medium">
                                    {subCategoryName}
                                </p>
                                <h1 className="text-4xl md:text-5xl lg:text-6xl font-display italic tracking-tight text-foreground leading-[1]">
                                    {productName}
                                </h1>
                                <div className="h-px w-14 bg-border" />
                            </div>
                            {productDescription && (
                                <p className="text-muted-foreground font-light leading-relaxed text-base tracking-wide">
                                    {productDescription}
                                </p>
                            )}
                            <div className="flex flex-wrap items-baseline gap-3 pt-2 pb-6 border-b border-border">
                                <PriceTag price={product.price} basePrice={product.basePrice} size="xl" />
                                {product.discountPercent > 0 && (
                                    <DiscountBadge percent={product.discountPercent} />
                                )}
                            </div>
                            {product.variants && product.variants.length > 1 && (
                                <ProductVariantsSelector
                                    currentProductId={product.productId}
                                    variants={product.variants}
                                    categorySlug={categorySlug}
                                    subCategorySlug={subCategorySlug}
                                />
                            )}
                            {!isMagneticAccessories && product.colorTemperatures.length > 0 && (
                                <ProductColorTempButtons
                                    availableTemps={product.colorTemperatures}
                                    initialTemp={selectedColorTemp}
                                    onColorTempChange={setSelectedColorTemp}
                                />
                            )}
                            {availableColorKeys && availableColorKeys.length > 0 && (
                                <ProductSurfaceColorButtons
                                    availableColors={availableColorKeys}
                                    initialColor={surfaceColor}
                                    onSurfaceColorChange={setSurfaceColor}
                                />
                            )}
                            <div className="space-y-5 pt-2">
                                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                                    <span className="text-xs uppercase tracking-label text-muted-foreground font-light">
                                        {t("quantity")}
                                    </span>
                                    <div className="flex items-center border border-border">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-10 w-10 rounded-none hover:bg-muted"
                                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                            disabled={isOutOfStock || quantity <= 1}
                                            aria-label={t("decreaseQuantity")}
                                        >
                                            <Minus className="h-3.5 w-3.5" />
                                        </Button>
                                        <span className="w-12 text-center font-light tabular-nums text-sm" aria-label={t("quantity")}>
                                            {quantity}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-10 w-10 rounded-none hover:bg-muted"
                                            onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}
                                            disabled={isOutOfStock || atMaxQuantity}
                                            aria-label={t("increaseQuantity")}
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                    <StockIndicator status={stockStatus} available={product.stockAvailable} />
                                </div>
                                {atMaxQuantity && (
                                    <p className="text-2xs font-light tracking-wide text-muted-foreground" role="status">
                                        {t("maxAvailable", {
                                            count: product.stockAvailable,
                                            value: formatCount(product.stockAvailable, locale),
                                        })}
                                    </p>
                                )}
                                {isOutOfStock ? (
                                    <div className="border border-danger-border bg-danger-bg/60 p-5 space-y-2">
                                        <p className="text-xs uppercase tracking-label font-medium text-danger">
                                            {t("outOfStock")}
                                        </p>
                                        <p className="text-sm font-light leading-relaxed text-muted-foreground">
                                            {t("outOfStockBody")}
                                        </p>
                                        <Link
                                            href={`/category/${categorySlug}/${subCategorySlug}`}
                                            className="inline-block text-xs font-medium underline underline-offset-4 text-foreground"
                                        >
                                            {t("browseAlternatives")}
                                        </Link>
                                    </div>
                                ) : null}
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <Button
                                        onClick={handleAddToCart}
                                        disabled={isAddingToCart || isOutOfStock}
                                        className="flex-1 h-13 text-sm uppercase tracking-label font-light rounded-none bg-transparent border border-border hover:bg-muted hover:border-foreground text-foreground transition-all duration-300"
                                        variant="outline"
                                    >
                                        <ShoppingCart className="w-4 h-4 ltr:mr-2.5 rtl:ml-2.5" />
                                        {isAddingToCart ? t("addingToCart") : t("addToCart")}
                                    </Button>
                                    <Button
                                        onClick={handleOrderNow}
                                        disabled={isSaving || isOutOfStock}
                                        className="flex-1 h-13 text-sm uppercase tracking-label font-light rounded-none bg-foreground text-background hover:bg-foreground/90 transition-all duration-300"
                                    >
                                        {isSaving ? t("processing") : t("orderNow")}
                                    </Button>
                                </div>
                            </div>
                            <BulkOrderDialog sku={product.productId} productName={productName} quantity={quantity} />

                            {assurance}
                            <p className="text-2xs text-muted-foreground font-light tracking-label uppercase border-t border-border pt-4">
                                SKU: {product.productId}
                            </p>
                        </div>
                    </div>
                </Container>
            </section>
            {specifications.length > 0 && (
                <Reveal as="section" className="border-t bg-surface-sunk py-16 lg:py-24">
                    <Container>
                        <div className="mb-12 space-y-3">
                            <p className="text-2xs uppercase tracking-label text-primary font-medium">
                                {t("technicalLabel")}
                            </p>
                            <h2 className="text-3xl md:text-4xl font-display italic tracking-tight text-foreground">
                                {t("specifications")}
                            </h2>
                            <div className="h-px w-14 bg-border mt-2" />
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-t border-border">
                                <tbody>
                                    {specifications.map((spec, index) => (
                                        <tr
                                            key={`${spec.originalLabel}-${index}`}
                                            className={`border-b border-border transition-colors ${index % 2 === 0 ? "" : "bg-background"}`}
                                        >
                                            <td className="py-4 px-5 text-muted-foreground uppercase tracking-label text-2xs w-2/5 lg:w-1/3">
                                                {spec.label}
                                            </td>
                                            <td className="py-4 px-5 font-light text-foreground">{spec.value}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Container>
                </Reveal>
            )}
        </main>
    )
}