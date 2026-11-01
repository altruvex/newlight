import type { Metadata } from "next"
import { cache } from "react"
import { ProductStrip } from "@/components/product-strip"
import { JsonLd, breadcrumbSchema, productSchema } from "@/lib/structured-data"
import { PurchaseAssurance } from "@/components/purchase-assurance"
import { RecentlyViewed, RecordView } from "@/components/recently-viewed"
import { relatedProducts } from "@/lib/services/merchandising-service"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { notFound, permanentRedirect } from "next/navigation"
import { encodeSlug, resolveLocale } from "@repo/database"
import { ProductService, toProductPageView } from "@/lib/services/product-service"
import { constructMetadata } from "@/lib/metadata"
import { createProductCanonicalUrl } from "@/lib/canonical-url"
import { alternateCategorySlug, alternateSubCategorySlug, resolveProductSlug } from "@/lib/services/taxonomy"
import ProductPage from "./product-page"

export const revalidate = 900

type Props = { params: Promise<{ category: string; subCategory: string; product: string; locale: string }> }

// generateMetadata and the page both need this; cache() lets the second call reuse the
// first one's queries within a render instead of running them again.
const loadCached = cache(async (category: string, subCategory: string, product: string) => {
    const locale = resolveLocale(await getLocale())
    const slug = decodeURIComponent(product)

    const resolution = await resolveProductSlug(slug)
    if (resolution.kind === "moved") {
        permanentRedirect(
            `/${locale}/category/${encodeSlug(decodeURIComponent(category))}/${encodeSlug(decodeURIComponent(subCategory))}/${encodeSlug(resolution.to)}`
        )
    }
    if (resolution.kind === "missing") notFound()

    const view = await ProductService.getProductBySlug(slug, locale)
    if (!view) notFound()
    return { view, locale }
})

async function load(params: Props["params"]) {
    const resolved = await params
    setRequestLocale(resolved.locale)
    return loadCached(resolved.category, resolved.subCategory, resolved.product)
}

// No product is prebuilt (the catalogue is too large to render at every deploy): each one
// renders on its first visit and is then served from cache until `revalidate` or a purge.
export function generateStaticParams() {
    return []
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { view, locale } = await load(params)
    const t = await getTranslations("metadatas.product-page")
    const translation = view.translations[0]
    const name = translation?.name ?? view.productId
    const categoryName = view.subCategory.translations[0]?.name ?? ""
    const specs = view.specs
        .slice(0, 3)
        .map((row) => `${row.spec.labelEn}: ${row.valueEn}`)
        .join(", ")
    // The product's own slug is locale-invariant; only its category and sub-category are
    // translated, so those are the only pieces the other language's URL needs resolved.
    const otherLocale = locale === "ar" ? "en" : "ar"
    const [otherCategorySlug, otherSubCategorySlug] = await Promise.all([
        alternateCategorySlug(view.subCategory.category.id, otherLocale),
        alternateSubCategorySlug(view.subCategory.id, otherLocale),
    ])

    return constructMetadata({
        title: translation?.metaTitle || t("title", { name, category: categoryName }),
        description:
            translation?.metaDescription || translation?.description || t("description", { name, category: categoryName, specs }),
        locale,
        canonicalUrl: createProductCanonicalUrl({
            locale,
            categorySlug: view.subCategory.category.translations[0]?.slug ?? "",
            subCategorySlug: view.subCategory.translations[0]?.slug ?? "",
            productId: view.slug,
        }),
        alternateUrls:
            otherCategorySlug && otherSubCategorySlug
                ? {
                      [otherLocale]: createProductCanonicalUrl({
                          locale: otherLocale,
                          categorySlug: otherCategorySlug,
                          subCategorySlug: otherSubCategorySlug,
                          productId: view.slug,
                      }),
                  }
                : undefined,
        image: view.images[0]?.url,
    })
}

export default async function Page({ params }: Props) {
    const { view, locale } = await load(params)
    const [t, related] = await Promise.all([
        getTranslations("merchandising"),
        relatedProducts({ id: view.id, familyId: view.familyId, subCategoryId: view.subCategoryId }, locale),
    ])
    const section = view.subCategory.translations[0]
    const category = view.subCategory.category.translations[0]

    const productName = view.translations[0]?.name ?? view.productId
    const categoryPath = `/${locale}/category/${encodeSlug(category?.slug ?? "")}`
    const sectionPath = `${categoryPath}/${encodeSlug(section?.slug ?? "")}`
    const productPath = `${sectionPath}/${encodeSlug(view.slug)}`

    const specs = view.specs.flatMap((row) => {
        const value = locale === "ar" ? row.valueAr : row.valueEn
        if (!value || value === "-") return []
        const unit = locale === "ar" ? row.spec.unitAr : row.spec.unitEn
        return [{
            label: locale === "ar" ? row.spec.labelAr : row.spec.labelEn,
            value: unit ? `${value} ${unit}` : value,
        }]
    })

    return (
        <>
            <JsonLd
                data={[
                    productSchema(
                        {
                            name: productName,
                            description: view.translations[0]?.description,
                            sku: view.productId,
                            images: view.images.map((image) => image.url),
                            url: productPath,
                            price: view.price,
                            stock: view.stockStatus,
                            category: section?.name,
                            specs,
                        },
                        locale
                    ),
                    breadcrumbSchema([
                        { name: category?.name ?? "", path: categoryPath },
                        { name: section?.name ?? "", path: sectionPath },
                        { name: productName, path: productPath },
                    ]),
                ]}
            />
            <ProductPage product={toProductPageView(view)} assurance={<PurchaseAssurance />} />
            <RecordView sku={view.productId} />
            <ProductStrip
                cards={related}
                eyebrow={t("related.eyebrow", { section: section?.name ?? "" })}
                title={t("related.title")}
                href={`/category/${encodeSlug(category?.slug ?? "")}/${encodeSlug(section?.slug ?? "")}`}
                hrefLabel={t("related.link", { section: section?.name ?? "" })}
                tone="sunk"
            />
            <RecentlyViewed exclude={view.productId} />
        </>
    )
}
