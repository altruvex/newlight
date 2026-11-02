import { prisma } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { TaxonomyForm } from "../../taxonomy-form"
import { PageBody, PageHeader } from "@/components/page"

export const metadata = { title: "New sub-category" }

export const dynamic = "force-dynamic"

export default async function NewSubCategoryPage({
    searchParams,
}: {
    searchParams: Promise<{ category?: string }>
}) {
    await requireCurrentAdmin()
    const { category } = await searchParams

    const categories = await prisma.category.findMany({
        where: { deletedAt: null },
        select: { id: true, translations: { where: { locale: "en" }, select: { name: true }, take: 1 } },
        orderBy: { order: "asc" },
    })

    return (
        <>
            <PageHeader
                title="New sub-category"
            />

            <PageBody>
                <TaxonomyForm
                    kind="subCategory"
                    existing={null}
                    categoryId={category}
                    categories={categories.map((c) => ({ id: c.id, name: c.translations[0]?.name ?? c.id }))}
                />
            </PageBody>
        </>
    )
}
