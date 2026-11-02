import { prisma } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { PricingEditor } from "./pricing-editor"
import { PageBody, PageHeader } from "@/components/page"

export const metadata = { title: "Bulk repricing" }

export const dynamic = "force-dynamic"

export default async function PricingPage() {
    await requireCurrentAdmin()

    const [categories, subCategories, families] = await Promise.all([
        prisma.category.findMany({
            where: { deletedAt: null },
            select: { id: true, translations: { where: { locale: "en" }, select: { name: true }, take: 1 } },
            orderBy: { order: "asc" },
        }),
        prisma.subCategory.findMany({
            where: { deletedAt: null },
            select: {
                id: true,
                categoryId: true,
                translations: { where: { locale: "en" }, select: { name: true }, take: 1 },
                _count: { select: { products: true } },
            },
            orderBy: { order: "asc" },
        }),
        prisma.productFamily.findMany({
            select: { id: true, slug: true, subCategoryId: true, _count: { select: { products: true } } },
            orderBy: { slug: "asc" },
        }),
    ])

    return (
        <>
            <PageHeader
                title="Bulk repricing"
                description="Preview first, apply second. Nothing is written until the preview is confirmed, and every changed price is recorded against the person who changed it."
            />

            <PageBody>
                <PricingEditor
                    categories={categories.map((c) => ({ id: c.id, name: c.translations[0]?.name ?? c.id }))}
                    subCategories={subCategories.map((s) => ({
                        id: s.id,
                        categoryId: s.categoryId,
                        name: s.translations[0]?.name ?? s.id,
                        productCount: s._count.products,
                    }))}
                    families={families.map((f) => ({
                        id: f.id,
                        subCategoryId: f.subCategoryId,
                        name: f.slug,
                        productCount: f._count.products,
                    }))}
                />
            </PageBody>
        </>
    )
}
