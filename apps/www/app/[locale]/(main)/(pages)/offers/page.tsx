import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { encodeSlug, numericLocale, resolveLocale } from "@repo/database"

import { Container, PageHeader, Section, SectionHeader } from "@/components/layout/section"
import { EmptyState } from "@/components/states"
import { ProductCard } from "@/components/product-card"
import { Link } from "@/i18n/navigation"
import { constructMetadata } from "@/lib/metadata"
import { createPageCanonicalUrl } from "@/lib/canonical-url"
import { allOffers } from "@/lib/services/offers-service"
import { stockStatusOfLevels } from "@/lib/stock"

export const revalidate = 900

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    setRequestLocale((await params).locale)
    const locale = resolveLocale(await getLocale())
    const t = await getTranslations("offers")

    return constructMetadata({
        title: t("metaTitle"),
        description: t("metaDescription"),
        locale,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "offers" }),
    })
}

export default async function OffersPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const locale = resolveLocale(await getLocale())
    const t = await getTranslations("offers")
    const offers = await allOffers(locale)

    const tag = numericLocale(locale)
    const number = new Intl.NumberFormat(tag)
    const date = new Intl.DateTimeFormat(tag, { day: "numeric", month: "long" })

    return (
        <>
            <PageHeader
                title={t("pageTitle")}
                description={
                    offers
                        ? t("pageSummary", {
                              percent: number.format(offers.summary.percentOff),
                              count: offers.summary.productCount,
                              formattedCount: number.format(offers.summary.productCount),
                          })
                        : t("pageDescription")
                }
            />

            {!offers ? (
                <Section spacing="tight">
                    <Container>
                        <EmptyState
                            variant="no-data"
                            title={t("emptyTitle")}
                            description={t("emptyDescription")}
                            action={
                                <Link
                                    href="/category"
                                    className="text-sm font-medium underline underline-offset-4"
                                >
                                    {t("browseCatalogue")}
                                </Link>
                            }
                        />
                    </Container>
                </Section>
            ) : (
                offers.groups.map((group) => (
                    <Section key={group.subCategoryId} spacing="tight">
                        <Container>
                            <SectionHeader
                                eyebrow={group.categoryName}
                                title={group.name}
                                description={t("sectionMeta", {
                                    percent: number.format(group.summary.percentOff),
                                    date: date.format(new Date(group.summary.endsAt)),
                                })}
                                action={
                                    <Link
                                        href={`/category/${encodeSlug(group.categorySlug)}/${encodeSlug(group.slug)}`}
                                        className="text-sm font-medium underline underline-offset-4"
                                    >
                                        {t("browseSection")}
                                    </Link>
                                }
                            />

                            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {group.products.map((product) => (
                                    <Link
                                        key={product.id}
                                        href={`/category/${encodeSlug(group.categorySlug)}/${encodeSlug(group.slug)}/${encodeSlug(product.slug)}`}
                                        className="block"
                                    >
                                        <ProductCard
                                            image={product.images[0]?.url ?? "/lighting-product.jpg"}
                                            title={product.translations[0]?.name ?? product.productId}
                                            category={group.name}
                                            price={product.price}
                                            basePrice={product.basePrice}
                                            discountPercent={product.discountPercent}
                                            stock={stockStatusOfLevels(product.stockLevels)}
                                        />
                                    </Link>
                                ))}
                            </div>
                        </Container>
                    </Section>
                ))
            )}
        </>
    )
}
