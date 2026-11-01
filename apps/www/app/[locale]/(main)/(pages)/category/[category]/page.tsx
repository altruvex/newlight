import type { Metadata } from "next"
import { cache } from "react"
import { JsonLd, breadcrumbSchema, itemListSchema } from "@/lib/structured-data"
import { ProductStrip } from "@/components/product-strip"
import { categoryHighlights, categoryOffers } from "@/lib/services/merchandising-service"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { notFound, permanentRedirect } from "next/navigation"
import { encodeSlug, resolveLocale, type Locale } from "@repo/database"
import { CategoryService } from "@/lib/services/category-service"
import { offersForSection } from "@/lib/services/offers-service"
import { OfferBanner } from "@/components/offer-banner"
import { constructMetadata } from "@/lib/metadata"
import { createCategoryCanonicalUrl } from "@/lib/canonical-url"
import { allTaxonomyPaths, alternateCategorySlug } from "@/lib/services/taxonomy"
import CategoryPage from "./category-page"

export const revalidate = 900

type Props = { params: Promise<{ category: string; locale: string }> }

// generateMetadata and the page both need this; cache() lets the second call reuse the
// first one's queries within a render instead of running them again.
const loadCached = cache(async (slug: string) => {
    const locale = resolveLocale(await getLocale())
    const resolution = await CategoryService.resolveCategory(locale, decodeURIComponent(slug))

    if (resolution.kind === "moved") {
        permanentRedirect(`/${locale}/category/${encodeSlug(resolution.to)}`)
    }
    if (resolution.kind === "missing") notFound()

    const category = await CategoryService.getCategoryBySlug(locale, resolution.value.translations[0]!.slug)
    if (!category) notFound()

    // The tiles on this page, and this page's own OG image (via subCategories[0] below), fall
    // back to a product photo when an admin left a sub-category's own image blank.
    const subCategories = await CategoryService.withSubCategoryImageFallback(category.subCategories)
    const enriched = { ...category, subCategories }

    const offer = await offersForSection({ categoryId: category.id })
    return { category: enriched, locale, offer }
})

async function load(params: Props["params"]) {
    const resolved = await params
    setRequestLocale(resolved.locale)
    return loadCached(resolved.category)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { category, locale } = await load(params)
    const t = await getTranslations("metadatas.sub-category-page")
    const translation = category.translations[0]
    const name = translation?.name ?? ""
    const otherLocale = locale === "ar" ? "en" : "ar"
    const otherCategorySlug = await alternateCategorySlug(category.id, otherLocale)

    return constructMetadata({
        title: t("title", { category: name }),
        description: translation?.description || t("description", { category: name }),
        locale,
        canonicalUrl: createCategoryCanonicalUrl({ locale, categorySlug: translation?.slug ?? "" }),
        alternateUrls: otherCategorySlug
            ? { [otherLocale]: createCategoryCanonicalUrl({ locale: otherLocale, categorySlug: otherCategorySlug }) }
            : undefined,
        image: (await CategoryService.resolveCategoryImage(category)) ?? undefined,
        keywords: category.subCategories
            .slice(0, 8)
            .map((sub) => sub.translations[0]?.name)
            .filter(Boolean)
            .join(", "),
    })
}

export async function generateStaticParams() {
    const locales: Locale[] = ["en", "ar"]
    const params = await Promise.all(
        locales.map(async (locale) => {
            const { categories } = await allTaxonomyPaths(locale)
            return categories.map((row) => ({ locale, category: row.slug }))
        })
    )
    return params.flat()
}

export default async function Page({ params }: Props) {
    const { category, offer, locale } = await load(params)
    const translation = category.translations[0]
    const name = translation?.name ?? ""
    const slug = translation?.slug ?? ""
    const number = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB")

    const [t, highlights, offers] = await Promise.all([
        getTranslations("merchandising"),
        categoryHighlights(category.id, locale),
        offer ? categoryOffers(locale, category.id) : Promise.resolve(null),
    ])

    const categoryPath = `/${locale}/category/${encodeSlug(slug)}`

    return (
        <>
            <JsonLd
                data={[
                    breadcrumbSchema([{ name, path: categoryPath }]),
                    itemListSchema(
                        category.subCategories.flatMap((subCategory) => {
                            const sub = subCategory.translations[0]
                            return sub ? [{ name: sub.name, path: `${categoryPath}/${encodeSlug(sub.slug)}` }] : []
                        }),
                        name
                    ),
                ]}
            />
            {offer && <OfferBanner {...offer} section={name} />}
            <CategoryPage category={category} />
            {offers && (
                <ProductStrip
                    cards={offers.cards}
                    eyebrow={t("offersIn.eyebrow")}
                    title={t("offersIn.title", { percent: number.format(offers.percentOff), category: name })}
                    href="/offers"
                    hrefLabel={t("offersIn.link")}
                    tone="sunk"
                />
            )}
            <ProductStrip
                cards={highlights}
                eyebrow={t("popularIn.eyebrow")}
                title={t("popularIn.title", { category: name })}
                description={t("popularIn.description")}
                className="border-t"
            />
        </>
    )
}
