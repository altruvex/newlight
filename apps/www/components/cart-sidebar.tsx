"use client"
import { multiplyMoney, serializeMoney } from "@repo/database"
import { CartColorTempSelector, CartSurfaceColorSelector } from "@/components/cart-color-selectors"
import { DiscountBadge, PriceTag } from "@/components/price-tag"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { CartItem } from "@/types"
import { useSession } from "@/lib/auth-client"
import { Loader2, ShoppingBag, ShoppingBagIcon, ShoppingCart, Trash2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import Image from "@/components/app-image"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ScrollArea } from "./ui/scroll-area"

export function CartSidebar() {
    const { data: session } = useSession()
    const isSignedIn = Boolean(session?.user)
    const userId = session?.user?.id ?? null
    const t = useTranslations("cart")
    const locale = useLocale()
    const [isOpen, setIsOpen] = useState(false)
    const [cartItems, setCartItems] = useState<CartItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isUpdating, setIsUpdating] = useState<string | null>(null)

    useEffect(() => {
        const fetchCartItems = async () => {
            if (!isSignedIn || !userId) return
            setIsLoading(true)
            try {
                const response = await fetch(`/${locale}/api/cart`)
                if (response.ok) {
                    const items = await response.json()
                    setCartItems(items)
                } else {
                    const errorData = await response.json()
                    console.error("Failed to fetch cart items:", errorData)
                    toast.error(t("messages.failedToLoad"))
                }
            } catch (error) {
                console.error("Error fetching cart items:", error)
                toast.error(t("messages.errorLoading"))
            } finally {
                setIsLoading(false)
            }
        }

        if (isOpen && isSignedIn) {
            fetchCartItems()
        }
    }, [isOpen, isSignedIn, userId, t])

    const updateQuantity = async (itemId: string, newQuantity: number) => {
        if (newQuantity < 1) return

        const previousItems = [...cartItems]
        setCartItems((prevItems) =>
            prevItems.map((item) =>
                item.id === itemId
                    ? {
                        ...item,
                        quantity: newQuantity,
                        totalPrice: serializeMoney(multiplyMoney(item.price, newQuantity)),
                    }
                    : item,
            ),
        )

        setIsUpdating(itemId)
        try {
            const response = await fetch(`/${locale}/api/cart`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemId, quantity: newQuantity }),
            })

            if (response.ok) {
                const updatedItem = await response.json()
                setCartItems((prevItems) => prevItems.map((item) => (item.id === itemId ? updatedItem : item)))
                localStorage.setItem(`quantity-${itemId}`, newQuantity.toString())
                toast.success(t("messages.quantityUpdated"))
            } else {
                setCartItems(previousItems)
                toast.error(t("messages.failedToUpdate"))
            }
        } catch {
            setCartItems(previousItems)
            toast.error(t("messages.failedToUpdate"))
        } finally {
            setIsUpdating(null)
        }
    }

    const updateColorTemp = async (itemId: string, newColorTemp: string) => {
        const previousItems = [...cartItems]
        setCartItems((prevItems) =>
            prevItems.map((item) =>
                item.id === itemId ? { ...item, selectedColorTemp: newColorTemp } : item
            )
        )

        setIsUpdating(itemId)
        try {
            const response = await fetch(`/${locale}/api/cart/update-options`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemId, selectedColorTemp: newColorTemp }),
            })

            if (response.ok) {
                toast.success(t("messages.colorTempUpdated"))
            } else {
                setCartItems(previousItems)
                toast.error(t("messages.failedToUpdate"))
            }
        } catch {
            setCartItems(previousItems)
            toast.error(t("messages.failedToUpdate"))
        } finally {
            setIsUpdating(null)
        }
    }

    const updateSurfaceColor = async (itemId: string, newColor: string) => {
        const previousItems = [...cartItems]
        setCartItems((prevItems) =>
            prevItems.map((item) =>
                item.id === itemId ? { ...item, selectedColorKey: newColor } : item
            )
        )

        setIsUpdating(itemId)
        try {
            const response = await fetch(`/${locale}/api/cart/update-options`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemId, selectedColorKey: newColor }),
            })

            if (response.ok) {
                toast.success(t("messages.colorUpdated"))
            } else {
                setCartItems(previousItems)
                toast.error(t("messages.failedToUpdate"))
            }
        } catch {
            setCartItems(previousItems)
            toast.error(t("messages.failedToUpdate"))
        } finally {
            setIsUpdating(null)
        }
    }

    const removeItem = async (itemId: string) => {
        const previousItems = [...cartItems]
        setCartItems((prevItems) => prevItems.filter((item) => item.id !== itemId))

        setIsUpdating(itemId)
        try {
            const response = await fetch(`/${locale}/api/cart`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemId }),
            })

            if (response.ok) {
                localStorage.removeItem(`quantity-${itemId}`)
                toast.success(t("messages.itemRemoved"))
            } else {
                setCartItems(previousItems)
                toast.error(t("messages.failedToRemove"))
            }
        } catch {
            setCartItems(previousItems)
            toast.error(t("messages.failedToRemove"))
        } finally {
            setIsUpdating(null)
        }
    }

    const totalItems = cartItems.reduce((total, item) => total + item.quantity, 0)

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="relative h-9 w-9 border-border hover:border-border hover:bg-accent/5 transition-all bg-transparent"
                    aria-label={t("actions.openCart")}
                >
                    <ShoppingCart className="h-4 w-4" />
                    {totalItems > 0 && (
                        <Badge
                            variant="destructive"
                            className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-xs font-semibold"
                        >
                            {totalItems > 99 ? "99+" : totalItems}
                        </Badge>
                    )}
                </Button>
            </SheetTrigger>
            <SheetContent className="h-full">
                <ScrollArea className="h-[calc(100vh-64px)] w-full">
                    <SheetHeader className="border-b border-border pb-2">
                        <SheetTitle className="flex items-center gap-3 text-lg font-semibold">
                            <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                            <span>{t("title")}</span>
                            {totalItems > 0 && (
                                <Badge variant="secondary" className="ml-auto text-xs">
                                    {totalItems}
                                </Badge>
                            )}
                        </SheetTitle>
                    </SheetHeader>
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {!isSignedIn ? (
                            <EmptyState
                                icon={ShoppingCart}
                                title={t("signInRequired.title")}
                                description={t("signInRequired.description")}
                            />
                        ) : isLoading ? (
                            <LoadingState />
                        ) : cartItems.length === 0 ? (
                            <EmptyState icon={ShoppingCart} title={t("emptyCart.title")} description={t("emptyCart.description")} />
                        ) : (
                            <>
                                <CartItemsList
                                    items={cartItems}
                                    isUpdating={isUpdating}
                                    onUpdateQuantity={updateQuantity}
                                    onUpdateColorTemp={updateColorTemp}
                                    onUpdateSurfaceColor={updateSurfaceColor}
                                    onRemoveItem={removeItem}
                                />
                                <div className="border-t px-4 py-4">
                                    <Button asChild variant="outline" className="w-full" onClick={() => setIsOpen(false)}>
                                        <Link href={`/${locale}/cart`}>{t("viewFull")}</Link>
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    )
}

function EmptyState({
    icon: Icon,
    title,
    description,
}: {
    icon: React.ElementType
    title: string
    description: string
}) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <Icon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
        </div>
    )
}

function LoadingState() {
    const t = useTranslations("cart")
    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{t("loading")}</p>
            </div>
        </div>
    )
}

function CartItemsList({
    items,
    isUpdating,
    onUpdateQuantity,
    onUpdateColorTemp,
    onUpdateSurfaceColor,
    onRemoveItem,
}: {
    items: CartItem[]
    isUpdating: string | null
    onUpdateQuantity: (id: string, quantity: number) => Promise<void>
    onUpdateColorTemp: (id: string, colorTemp: string) => Promise<void>
    onUpdateSurfaceColor: (id: string, color: string) => Promise<void>
    onRemoveItem: (id: string) => Promise<void>
}) {
    return (
        <div className="flex-1 overflow-y-auto py-4">
            <div className="space-y-2">
                {items.map((item) => (
                    <CartItemCard
                        key={item.id}
                        item={item}
                        isUpdating={isUpdating === item.id}
                        onUpdateQuantity={onUpdateQuantity}
                        onUpdateColorTemp={onUpdateColorTemp}
                        onUpdateSurfaceColor={onUpdateSurfaceColor}
                        onRemoveItem={onRemoveItem}
                    />
                ))}
            </div>
        </div>
    )
}

function CartItemCard({
    item,
    isUpdating,
    onUpdateQuantity,
    onUpdateColorTemp,
    onUpdateSurfaceColor,
    onRemoveItem,
}: {
    item: CartItem
    isUpdating: boolean
    onUpdateQuantity: (id: string, quantity: number) => Promise<void>
    onUpdateColorTemp: (id: string, colorTemp: string) => Promise<void>
    onUpdateSurfaceColor: (id: string, color: string) => Promise<void>
    onRemoveItem: (id: string) => Promise<void>
}) {
    const t = useTranslations("cart")

    const hasColorTemps = Array.isArray(item.colorTemperatures) && item.colorTemperatures.length > 0
    const hasColors = Array.isArray(item.availableColors) && item.availableColors.length > 0

    return (
        <div className="group relative bg-card border border-border rounded-lg p-3 hover:border-border hover:shadow-sm transition-all duration-200">
            <div className="flex gap-3">
                <Link
                    href={`/preview/${item.productId}`}
                    className="relative shrink-0 w-16 h-16 cursor-pointer"
                >
                    {item.productImages?.[0] ? (
                        <Image
                            src={item.productImages[0]}
                            alt={item.productName}
                            fill
                            sizes="64px"
                            className="object-cover rounded-md hover:opacity-80 transition-opacity"
                        />
                    ) : (
                        <div className="w-full h-full bg-muted rounded-md flex items-center justify-center hover:bg-muted/80 transition-colors">
                            <ShoppingCart className="h-6 w-6 text-muted-foreground" />
                        </div>
                    )}
                    {item.discountPercent > 0 && (
                        <DiscountBadge percent={item.discountPercent} className="absolute -top-2 -end-2 px-1.5 py-0.5" />
                    )}
                </Link>
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div className="space-y-1">
                        <div className="flex justify-between items-start gap-1">
                            <Link
                                href={`/preview/${item.productId}`}
                                className="font-medium text-sm leading-tight line-clamp-2 hover:text-primary transition-colors"
                            >
                                {item.productName}
                            </Link>
                            <Button
                                variant="outline"
                                size="icon"
                                className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 hover:border-danger-border hover:bg-danger-bg hover:text-danger"
                                onClick={() => onRemoveItem(item.id)}
                                disabled={isUpdating}
                            >
                                {isUpdating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Trash2 className="h-3 w-3" />
                                )}
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                            {item.category && <span>{item.category}</span>}
                            {item.category && item.subCategory && <span>•</span>}
                            {item.subCategory && <span>{item.subCategory}</span>}
                        </div>
                        {(hasColorTemps || hasColors) && (
                            <div className="flex flex-col gap-1.5 mt-2">
                                {hasColorTemps && (
                                    <CartColorTempSelector
                                        availableTemps={item.colorTemperatures}
                                        selectedTemp={item.selectedColorTemp || item.colorTemperatures[0]}
                                        onChange={(temp) => onUpdateColorTemp(item.id, temp)}
                                        disabled={isUpdating}
                                    />
                                )}
                                {hasColors && (
                                    <CartSurfaceColorSelector
                                        availableColors={item.availableColors}
                                        selectedColorKey={item.selectedColorKey || item.availableColors[0]}
                                        onChange={(color) => onUpdateSurfaceColor(item.id, color)}
                                        disabled={isUpdating}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <div className="space-y-2 pt-2">
                        <div className="flex items-center justify-between gap-2">
                            <PriceTag
                                price={item.totalPrice}
                                basePrice={serializeMoney(multiplyMoney(item.basePrice, item.quantity))}
                                size="sm"
                                className="flex-col items-start gap-0"
                            />
                            <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-xs"
                                    onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                                    disabled={isUpdating || item.quantity <= 1}
                                >
                                    −
                                </Button>
                                <span className="w-6 text-center text-xs font-medium">
                                    {item.quantity}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-xs"
                                    onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                                    disabled={isUpdating}
                                >
                                    +
                                </Button>
                            </div>
                        </div>
                        <Link
                            href={`/preview/${item.productId}`}
                            className="w-full"
                        >
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full h-7 text-xs gap-1.5 hover:bg-primary hover:text-primary-foreground transition-colors"
                            >
                                <ShoppingBagIcon className="h-3 w-3" />
                                {t("orderNow")}
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}