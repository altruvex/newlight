import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { resolveLocale } from "@repo/database"
import { CategoryService } from "@/lib/services/category-service"
import { constructMetadata } from "@/lib/metadata"
import { createPageCanonicalUrl } from "@/lib/canonical-url"
import CategoriesSection from "./category"

export const revalidate = 900

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("metadatas.category-page")
    const locale = resolveLocale(await getLocale())
    return constructMetadata({
        title: t("title"),
        description: t("description"),
        locale,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "category" }),
    })
}

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const locale = resolveLocale(await getLocale())
    const all = await CategoryService.getAllCategories(locale)

    const images = await CategoryService.resolveCategoryImages(all)

    const categories = all.flatMap((category) => {
        const translation = category.translations[0]
        if (!translation) {
            console.warn(`[category] ${category.id} has no ${locale} translation; omitted`)
            return []
        }
        return [
            {
                key: category.id,
                slug: translation.slug,
                name: translation.name,
                description: translation.description ?? "",
                imageUrl: images.get(category.id) ?? "",
            },
        ]
    })

    return <CategoriesSection categories={categories} />
}
