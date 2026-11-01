import { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { redirect } from "next/navigation"
import Image from "@/components/app-image"
import { resolveLocale } from "@repo/database"
import { Link } from "@/i18n/navigation"
import { currentUserId } from "@/lib/auth"
import { UserService } from "@/lib/services/user-service"
import { constructMetadata } from "@/lib/metadata"
import { createPageCanonicalUrl } from "@/lib/canonical-url"
import { Container, PageHeader } from "@/components/layout/section"
import { Button } from "@/components/ui/button"
import { Pager } from "@/components/pager"
import { EmptyState } from "@/components/states"
import { StatusBadge } from "@/components/status-badge"
import type { SupportedLanguage } from "@/types"
import { CancelOrderButton } from "./cancel-order-button"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 10

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("metadatas.orders-page")
    const locale = (await getLocale()) as SupportedLanguage
    return constructMetadata({
        title: t("title"),
        description: t("description"),
        locale,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "orders" }),
        // Requires sign-in (see the redirect below) and is different for every visitor.
        noIndex: true,
    })
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
    const userId = await currentUserId()
    if (!userId) redirect("/sign-in")

    const locale = resolveLocale(await getLocale())
    const t = await getTranslations("orders-page")
    const { page: pageParam } = await searchParams
    const page = Math.max(1, Number(pageParam ?? 1) || 1)

    const { orders, pagination } = await UserService.getOrderHistory(userId, locale, {
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
    })
    const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE))

    return (
        <>
            <PageHeader eyebrow={t("eyebrow")} title={t("heading")} description={t("subheading", { count: pagination.total })} />

            <Container className="py-10 lg:py-14">
                {orders.length === 0 ? (
                    <EmptyState
                        variant="no-data"
                        title={t("empty")}
                        description={t("emptyBody")}
                        action={
                            <Button asChild size="lg">
                                <Link href="/category">{t("emptyAction")}</Link>
                            </Button>
                        }
                        className="rounded-lg border bg-surface-sunk"
                    />
                ) : (
                    <ul className="space-y-4">
                        {orders.map((order) => (
                            <li key={order.id} className="rounded-lg border bg-card p-5">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="font-mono font-medium">{order.orderNumber}</span>
                                            <StatusBadge kind="order" value={order.status} locale={locale} />
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            {t("placed")}{" "}
                                            <time dateTime={order.createdAt.toISOString()}>
                                                {order.createdAt.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB")}
                                            </time>
                                            {" · "}
                                            {t("items", { count: order.itemCount })}
                                        </p>
                                    </div>

                                    <div className="text-end">
                                        <p className="text-sm text-muted-foreground">{t("total")}</p>
                                        <p className="text-xl font-semibold tabular-nums">{order.total}</p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2 mt-4">
                                    {order.items.slice(0, 5).map((item) =>
                                        item.product.image ? (
                                            <Image
                                                key={item.id}
                                                src={item.product.image}
                                                alt={item.product.name}
                                                width={56}
                                                height={56}
                                                className="size-14 rounded-md border bg-surface-sunk object-contain"
                                            />
                                        ) : null
                                    )}
                                    {order.itemCount > 5 && (
                                        <span className="grid size-14 place-items-center rounded-md border text-sm text-muted-foreground">
                                            +{order.itemCount - 5}
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-wrap gap-3 mt-5">
                                    <Button variant="outline" asChild>
                                        <Link href={`/orders/${order.id}`}>{t("view")}</Link>
                                    </Button>
                                    {order.status === "awaiting_shipment" && (
                                        <CancelOrderButton
                                            orderId={order.id}
                                            orderNumber={order.orderNumber}
                                            labels={{
                                                cancel: t("cancel"),
                                                cancelling: t("cancelling"),
                                                title: t("cancelTitle", { orderNumber: order.orderNumber }),
                                                body: t("cancelBody"),
                                                confirm: t("cancelConfirm"),
                                                keep: t("cancelKeep"),
                                                done: t("cancelled"),
                                                failed: t("cancelFailed"),
                                            }}
                                        />
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                <Pager page={page} totalPages={totalPages} basePath="/orders" label={t("heading")} />
            </Container>
        </>
    )
}
