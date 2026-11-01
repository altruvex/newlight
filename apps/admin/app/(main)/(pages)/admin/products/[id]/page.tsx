import { notFound } from "next/navigation"
import { prisma, serializeMoney } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { TranslationService } from "@/lib/services/translation-service"
import { InventoryService } from "@/lib/services/inventory-service"
import { SpecService } from "@/lib/services/spec-service"
import { MediaService } from "@/lib/services/media-service"
import { PricingService } from "@/lib/services/pricing-service"
import { AuditService } from "@/lib/services/audit-service"
import { ProductWorkbench } from "./product-workbench"

export const dynamic = "force-dynamic"

const TABS = ["translations", "images", "inventory", "price", "specs", "settings"] as const
type Tab = (typeof TABS)[number]

export default async function ProductDetail({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ tab?: string }>
}) {
    await requireCurrentAdmin()
    const { id } = await params
    const { tab } = await searchParams
    const initialTab: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : "translations"

    // Header, rail and tab badges only. Each tab's own data is loaded below only when that tab is
    // the active one — switching tabs changes ?tab=, which re-renders this page on the server.
    const product = await prisma.product.findUnique({
        where: { id },
        include: {
            stockLevels: { select: { onHand: true, reserved: true } },
            family: { include: { translations: { where: { locale: "en" }, take: 1 } } },
            subCategory: {
                include: {
                    translations: { where: { locale: "en" }, take: 1 },
                    category: { include: { translations: { where: { locale: "en" }, take: 1 } } },
                },
            },
            ...(initialTab === "images" && {
                availableColors: { select: { colorId: true }, orderBy: { order: "asc" } },
            }),
            ...(initialTab === "settings" && { slugHistory: { orderBy: { createdAt: "desc" } } }),
            _count: {
                select: {
                    images: true,
                    orderItems: true,
                    // Deletion blockers: only the Settings tab's delete control reads these.
                    cartItems: initialTab === "settings",
                    configurations: initialTab === "settings",
                },
            },
        },
    })

    if (!product) notFound()

    const [translations, movements, priceHistory, specs, media, audit] = await Promise.all([
        // Always: the Languages tab badge (two rows).
        TranslationService.forProduct(product.id),
        initialTab === "inventory" ? InventoryService.history(product.id, 50) : null,
        initialTab === "price" ? PricingService.priceHistory(product.id) : null,
        initialTab === "specs" ? SpecService.forProduct(product.id) : null,
        initialTab === "images" ? MediaService.forProduct(product.id) : null,
        AuditService.forEntity("Product", product.id, 12),
    ])

    const onHand = product.stockLevels.reduce((sum, l) => sum + l.onHand, 0)
    const reserved = product.stockLevels.reduce((sum, l) => sum + l.reserved, 0)

    const categoryPath = [
        product.subCategory?.category?.translations[0]?.name,
        product.subCategory?.translations[0]?.name,
        product.family?.translations[0]?.name ?? product.family?.slug,
    ]
        .filter(Boolean)
        .join(" › ")

    return (
        <ProductWorkbench
            initialTab={initialTab}
            productId={product.id}
            sku={product.productId}
            slug={product.slug}
            isActive={product.isActive}
            isArchived={product.deletedAt !== null}
            price={serializeMoney(product.price)}
            averageCost={product.averageCost ? serializeMoney(product.averageCost) : null}
            onHand={onHand}
            reserved={reserved}
            translations={translations}
            blockers={
                initialTab === "settings"
                    ? {
                          orderItems: product._count.orderItems,
                          cartItems: product._count.cartItems,
                          configurations: product._count.configurations,
                      }
                    : null
            }
            movements={movements?.map((m) => ({
                id: m.id,
                type: m.type,
                quantity: m.quantity,
                reason: m.reason,
                unitCost: m.unitCost ? serializeMoney(m.unitCost) : null,
                actorType: m.actorType,
                createdAt: m.createdAt.toISOString(),
            })) ?? null}
            priceHistory={priceHistory}
            specs={specs}
            imageCount={product._count.images}
            images={media?.images.map((image) => ({
                id: image.id,
                url: image.url,
                publicId: image.publicId,
                order: image.order,
                colorId: image.colorId,
                colorKey: image.color?.key ?? null,
                width: image.width,
                height: image.height,
                altEn: image.altEn,
                altAr: image.altAr,
            })) ?? null}
            colors={media?.colors ?? null}
            offeredColorIds={product.availableColors?.map((a) => a.colorId) ?? null}
            slugHistory={product.slugHistory?.map((h) => h.slug) ?? null}
            categoryPath={categoryPath}
            variantValue={product.variantValue}
            orderLineCount={product._count.orderItems}
            createdAt={product.createdAt.toISOString()}
            updatedAt={product.updatedAt.toISOString()}
            audit={audit.map((row) => ({
                id: row.id,
                action: row.action,
                actorEmail: row.actorEmail,
                actorType: row.actorType,
                createdAt: row.createdAt,
            }))}
        />
    )
}
