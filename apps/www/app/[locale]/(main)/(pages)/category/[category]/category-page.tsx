import { encodeSlug } from "@repo/database"
import { Breadcrumbs } from "@/components/breadcrumbs"
import CategoryCard from "@/components/category-card"
import { Container } from "@/components/layout/section"
import { EmptyState } from "@/components/states"
import { Link } from "@/i18n/navigation"
import type { CategoryWithSubCategories } from "@/lib/services/category-service"
import { useTranslations } from "next-intl"

interface CategoryPageProps {
    category: CategoryWithSubCategories
}

export default function CategoryPage({ category }: CategoryPageProps) {
    const t = useTranslations("sub-category-page")
    const categoryTranslation = category.translations[0]
    const categoryName = categoryTranslation?.name ?? ""
    const categorySlug = categoryTranslation?.slug ?? ""

    return (
        <div className="min-h-screen">
            <section className="pt-6 pb-12 lg:pt-8 lg:pb-20">
                <Container>
                    <Breadcrumbs
                        className="mb-8"
                        items={[{ name: t("catalogue"), href: "/category" }, { name: categoryName }]}
                    />
                    <div className="max-w-3xl space-y-6">
                        <div className="space-y-4">
                            <h1 className="font-display text-3xl leading-[1.1] font-light tracking-tight text-balance sm:text-4xl lg:text-6xl">
                                {categoryName}
                            </h1>
                            <div className="h-px w-20 bg-accent" />
                        </div>
                        {categoryTranslation?.description && (
                            <p className="text-lg md:text-xl font-light text-muted-foreground tracking-wide max-w-2xl leading-relaxed">
                                {categoryTranslation.description}
                            </p>
                        )}
                    </div>
                </Container>
            </section>
            <section className="pb-20 lg:pb-28">
                <Container>
                    {category.subCategories.length === 0 ? (
                        <EmptyState
                            variant="no-data"
                            title={t("noSubcategories")}
                            className="rounded-lg border bg-surface-sunk"
                        />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-12 lg:gap-x-8 lg:gap-y-16">
                            {category.subCategories.map((subCategory, index) => {
                                const subCategoryTranslation = subCategory.translations[0]
                                const subCategoryName = subCategoryTranslation?.name ?? ""
                                return (
                                    <CategoryCard
                                        key={subCategory.id}
                                        title={subCategoryName}
                                        subtitle={categoryName}
                                        description={
                                            subCategoryTranslation?.description || t("exploreCollection", { name: subCategoryName })
                                        }
                                        imageUrl={subCategory.imageUrl || ""}
                                        href={`/category/${encodeSlug(categorySlug)}/${encodeSlug(subCategoryTranslation?.slug ?? "")}`}
                                        index={index}
                                    />
                                )
                            })}
                        </div>
                    )}
                </Container>
            </section>
        </div>
    )
}