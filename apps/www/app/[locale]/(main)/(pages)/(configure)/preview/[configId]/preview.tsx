"use client"

import { cleanDescription } from "@/lib/product-description"
import { encodeSlug, formatMoney, multiplyMoney, subtractMoney } from "@repo/database"
import { PriceTag } from "@/components/price-tag"
import { Container } from "@/components/layout/section"
import { LoginModel } from "@/components/login-model"
import { Button } from "@/components/ui/button"
import { useRouter } from "@/i18n/navigation"
import { PreviewClientProps } from "@/types"
import { useSession } from "@/lib/auth-client"
import { Loader2, ShoppingCart } from "lucide-react"
import Image from "@/components/app-image"
import Link from "next/link"
import { useState } from "react"

export function PreviewClient({
    configId,
    product,
    configuration,
    translations: t,
    locale
}: PreviewClientProps) {
    const router = useRouter()
    const { data: session } = useSession()
    const isSignedIn = Boolean(session?.user)
    const [showLoginDialog, setShowLoginDialog] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const isArabic = locale.startsWith("ar")

    const productTranslation = product.translations[0]
    const subCategoryTranslation = product.subCategory.translations[0]
    const categoryTranslation = product.subCategory.category.translations[0]

    const productName = productTranslation?.name || product.productId
    const productDescription = cleanDescription(productTranslation?.description)
    const subCategoryName = subCategoryTranslation?.name ?? ""
    const categoryName = categoryTranslation?.name ?? ""
    const categorySlug = categoryTranslation?.slug ?? ""

    const specs = product.specs.flatMap((row) => {
        const value = isArabic ? row.valueAr : row.valueEn
        if (!value || value === "-") return []
        const unit = isArabic ? row.spec.unitAr : row.spec.unitEn
        return [[isArabic ? row.spec.labelAr : row.spec.labelEn, unit ? `${value} ${unit}` : value] as const]
    })

    const formatColorTemp = (temp: string) => {
        const map: Record<string, string> = {
            WARM_3000K: isArabic ? "دافئ 3000K" : "Warm 3000K",
            COOL_4000K: isArabic ? "بارد 4000K" : "Cool 4000K",
            WHITE_6500K: isArabic ? "أبيض 6500K" : "White 6500K",
        }
        return map[temp] || temp
    }

    const formatColor = (color: string) => {
        const map: Record<string, string> = {
            BLACK: isArabic ? "أسود" : "Black",
            GRAY: isArabic ? "رمادي" : "Gray",
            WHITE: isArabic ? "أبيض" : "White",
            GOLD: isArabic ? "ذهبي" : "Gold",
            WOOD: isArabic ? "خشبي" : "Wood",
        }
        return map[color] || color
    }

    const handleProceedToCheckout = async () => {
        if (!isSignedIn) {
            setShowLoginDialog(true)
            return
        }

        setIsProcessing(true)

        try {
            await router.push(`/confirm/${configId}`)
        } catch (error) {
            console.error("Navigation error:", error)
            setIsProcessing(false)
        }
    }

    return (
        <div className="min-h-screen py-24">
            <Container>
                <div className="max-w-6xl mx-auto">
                    <div className="mb-12">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
                            <Link href="/" className="hover:text-foreground transition-colors">
                                {t.home}
                            </Link>
                            <span>/</span>
                            <Link href={`/category/${encodeSlug(categorySlug)}`} className="hover:text-foreground transition-colors">
                                {categoryName}
                            </Link>
                            <span>/</span>
                            <span className="text-foreground">{t.orderPreview}</span>
                        </div>
                        <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight mb-4">
                            {t.reviewOrder}
                        </h1>
                        <p className="text-muted-foreground">
                            {t.reviewDescription}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-20">
                        <div className="space-y-6 md:col-span-2 col-span-3 ">
                            <div className="relative aspect-square bg-muted rounded-lg overflow-hidden">
                                {product.images.length > 0 ? (
                                    <Image
                                        src={product.images[0]!.url}
                                        alt={productName}
                                        fill
                                        sizes="(max-width: 1024px) 100vw, (max-width: 1280px) 40vw, 480px"
                                        className="object-cover"
                                        priority
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                        {t.noImage}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm uppercase tracking-label text-muted-foreground font-light mb-2">
                                        {subCategoryName}
                                    </p>
                                    <h2 className="text-3xl font-display font-light tracking-tight">
                                        {productName}
                                    </h2>
                                </div>
                                {productDescription && (
                                    <p className="text-muted-foreground leading-relaxed">
                                        {productDescription}
                                    </p>
                                )}
                                {specs.length > 0 && (
                                    <div className="border-t border-border pt-4 space-y-2">
                                        <h3 className="text-sm uppercase tracking-label text-muted-foreground font-light mb-3">
                                            {t.keySpecs}
                                        </h3>
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                            {specs.slice(0, 4).map(([label, value]) => (
                                                <div key={label}>
                                                    <span className="text-muted-foreground">{label}:</span>
                                                    <span className="ml-2 font-medium">{value}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="space-y-6 col-span-3">
                            <div className="bg-secondary/30 rounded-lg p-6 border border-border">
                                <h3 className="text-xl font-display font-light mb-6">
                                    {t.orderSummary}
                                </h3>
                                <div className="space-y-4">
                                    {configuration.selectedColorTemp && (
                                        <div className="flex justify-between items-center py-3 border-b border-border">
                                            <span className="text-sm text-muted-foreground uppercase tracking-label">
                                                {t.colorTemperature}
                                            </span>
                                            <span className="font-medium">
                                                {formatColorTemp(configuration.selectedColorTemp)}
                                            </span>
                                        </div>
                                    )}
                                    {configuration.selectedColorKey && (
                                        <div className="flex justify-between items-center py-3 border-b border-border">
                                            <span className="text-sm text-muted-foreground uppercase tracking-label">
                                                {t.surfaceColor}
                                            </span>
                                            <span className="font-medium">
                                                {formatColor(configuration.selectedColorKey)}
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-center py-3 border-b border-border">
                                        <span className="text-sm text-muted-foreground uppercase tracking-label">
                                            {t.quantity}
                                        </span>
                                        <span className="font-medium">{configuration.quantity}</span>
                                    </div>
                                    <div className="space-y-3 pt-4">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">{t.unitPrice}</span>
                                            <PriceTag price={product.price} basePrice={product.basePrice} size="sm" />
                                        </div>
                                        {product.discountPercent > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-muted-foreground">{t.discount}</span>
                                                <span className="text-destructive">
                                                    −{formatMoney(
                                                        multiplyMoney(
                                                            subtractMoney(product.basePrice, product.price),
                                                            configuration.quantity
                                                        ),
                                                        locale
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">{t.subtotal}</span>
                                            <span>{formatMoney(multiplyMoney(product.price, configuration.quantity), locale)}</span>
                                        </div>
                                        <div className="flex justify-between items-baseline pt-4 border-t border-border">
                                            <span className="text-lg font-light uppercase tracking-label">
                                                {t.total}
                                            </span>
                                            <span className="text-3xl font-display font-light">
                                                {formatMoney(configuration.totalPrice, locale)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Button
                                    onClick={handleProceedToCheckout}
                                    disabled={isProcessing}
                                    className="w-full h-14 text-base uppercase tracking-label"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className="w-5 h-5 ltr:mr-2 rtl:ml-2 animate-spin" />
                                            {isArabic ? "جاري المعالجة..." : "Processing..."}
                                        </>
                                    ) : (
                                        <>
                                            <ShoppingCart className="w-5 h-5 ltr:mr-2 rtl:ml-2" />
                                            {t.proceedToCheckout}
                                        </>
                                    )}
                                </Button>
                            </div>
                            <div className="text-xs text-muted-foreground text-center pt-4">
                                <p>{t.secureCheckout}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </Container>
            <LoginModel
                open={showLoginDialog}
                onOpenChange={setShowLoginDialog}
                translations={{
                    title: isArabic ? "تسجيل الدخول مطلوب" : "Sign In Required",
                    description: isArabic
                        ? "يجب تسجيل الدخول أو إنشاء حساب جديد لمتابعة عملية الشراء"
                        : "You need to sign in or create an account to proceed with your order",
                    signIn: isArabic ? "تسجيل الدخول" : "Sign In",
                    signUp: isArabic ? "إنشاء حساب" : "Sign Up",
                    or: isArabic ? "أو" : "or"
                }}
            />
        </div>
    )
}