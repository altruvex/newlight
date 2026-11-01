import type { Metadata } from "next"
import { cache } from "react"
import { JsonLd, breadcrumbSchema, itemListSchema } from "@/lib/structured-data"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { notFound, permanentRedirect } from "next/navigation"
import { encodeSlug, resolveLocale, type Locale } from "@repo/database"
import { CategoryService } from "@/lib/services/category-service"
import { offersForSection } from "@/lib/services/offers-service"
import { OfferBanner } from "@/components/offer-banner"
import { constructMetadata } from "@/lib/metadata"
import { createSubCategoryCanonicalUrl } from "@/lib/canonical-url"
import { allTaxonomyPaths, alternateCategorySlug, alternateSubCategorySlug } from "@/lib/services/taxonomy"
import { LISTING_PAGE_SIZE } from "@/lib/services/product-facets"
import SubCategoryPage from "./sub-category-page"

export const revalidate = 900

type Props = { params: Promise<{ category: string; subCategory: string; locale: string }> }

// generateMetadata and the page both need this; cache() lets the second call reuse the
// first one's queries within a render instead of running them again.
const loadCached = cache(async (category: string, subCategory: string) => {
    const locale = resolveLocale(await getLocale())
    const categorySlug = decodeURIComponent(category)
    const subCategorySlug = decodeURIComponent(subCategory)

    const resolution = await CategoryService.resolveSubCategory(locale, categorySlug, subCategorySlug)
    if (resolution.kind === "moved") {
        const [nextCategory, nextSub] = resolution.to.split("/")
        permanentRedirect(`/${locale}/category/${encodeSlug(nextCategory!)}/${encodeSlug(nextSub!)}`)
    }
    if (resolution.kind === "missing") notFound()

    const view = await CategoryService.getProductsWithUniqueVariants(locale, categorySlug, subCategorySlug)
    if (!view) notFound()

    const [offer, siblings] = await Promise.all([
        offersForSection({ subCategoryId: view.id }),
        CategoryService.getSubCategories(locale, categorySlug),
    ])
    return { view, locale, categorySlug, offer, siblings }
})

async function load(params: Props["params"]) {
    const resolved = await params
    setRequestLocale(resolved.locale)
    return loadCached(resolved.category, resolved.subCategory)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { view, locale, categorySlug } = await load(params)
    const t = await getTranslations("metadatas.section-type-page")
    const translation = view.translations[0]
    const name = translation?.name ?? ""
    const categoryName = view.category.translations[0]?.name ?? ""
    const otherLocale = locale === "ar" ? "en" : "ar"
    const [otherCategorySlug, otherSubCategorySlug] = await Promise.all([
        alternateCategorySlug(view.category.id, otherLocale),
        alternateSubCategorySlug(view.id, otherLocale),
    ])

    return constructMetadata({
        title: t("title", { section: name, category: categoryName }),
        description: translation?.description || t("description", { section: name, category: categoryName }),
        locale,
        canonicalUrl: createSubCategoryCanonicalUrl({ locale, categorySlug, subCategorySlug: translation?.slug ?? "" }),
        alternateUrls:
            otherCategorySlug && otherSubCategorySlug
                ? {
                      [otherLocale]: createSubCategoryCanonicalUrl({
                          locale: otherLocale,
                          categorySlug: otherCategorySlug,
                          subCategorySlug: otherSubCategorySlug,
                      }),
                  }
                : undefined,
        image: (view.imageUrl ?? (await CategoryService.firstProductImageForSubCategory(view.id))) ?? undefined,
    })
}

export async function generateStaticParams() {
    const locales: Locale[] = ["en", "ar"]
    const params = await Promise.all(
        locales.map(async (locale) => {
            const { subCategories } = await allTaxonomyPaths(locale)
            return subCategories.flatMap((row) => {
                const categorySlug = row.subCategory.category.translations[0]?.slug
                return categorySlug ? [{ locale, category: categorySlug, subCategory: row.slug }] : []
            })
        })
    )
    return params.flat()
}

export default async function Page({ params }: Props) {
    const { view, locale, categorySlug, offer, siblings } = await load(params)

    const alsoIn = siblings.flatMap((sibling) => {
        const translation = sibling.translations[0]
        return translation ? [{ id: sibling.id, name: translation.name, slug: translation.slug }] : []
    })

    const sectionName = view.translations[0]?.name ?? ""
    const categoryPath = `/${locale}/category/${encodeSlug(categorySlug)}`
    const sectionPath = `${categoryPath}/${encodeSlug(view.translations[0]?.slug ?? "")}`

    return (
        <>
            <JsonLd
                data={[
                    breadcrumbSchema([
                        { name: view.category.translations[0]?.name ?? categorySlug, path: categoryPath },
                        { name: sectionName, path: sectionPath },
                    ]),
                    itemListSchema(
                        view.listing.slice(0, LISTING_PAGE_SIZE).map((product) => ({
                            name: product.name,
                            path: `${sectionPath}/${encodeSlug(product.slug)}`,
                        })),
                        sectionName
                    ),
                ]}
            />
            {offer && (
                <OfferBanner
                    {...offer}
                    section={view.translations[0]?.name ?? ""}
                />
            )}
            <SubCategoryPage
                subCategory={{
                    // Only what the client listing reads: not the sub-category and category rows.
                    id: view.id,
                    name: sectionName,
                    slug: view.translations[0]?.slug ?? "",
                    description: view.translations[0]?.description ?? null,
                    categoryName: view.category.translations[0]?.name ?? "",
                    listing: view.listing,
                    facets: view.facets,
                    definitions: view.definitions,
                }}
                categorySlug={categorySlug}
                siblings={alsoIn}
            />
        </>
    )
}
