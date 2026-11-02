import { prisma } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { NewProductForm } from "./new-product-form"
import { PageBody, PageHeader } from "@/components/page"

export const metadata = { title: "New product" }

export const dynamic = "force-dynamic"

export default async function NewProductPage() {
    await requireCurrentAdmin()

    const [subCategories, families] = await Promise.all([
        prisma.subCategory.findMany({
            where: { deletedAt: null },
            select: {
                id: true,
                translations: { where: { locale: "en" }, select: { name: true }, take: 1 },
                category: { select: { translations: { where: { locale: "en" }, select: { name: true }, take: 1 } } },
            },
            orderBy: { order: "asc" },
        }),
        prisma.productFamily.findMany({
            select: { id: true, slug: true, subCategoryId: true, variantType: true },
            orderBy: { slug: "asc" },
        }),
    ])

    return (
        <>
            <PageHeader
                title="New product"
                description="A product exists as soon as it has a SKU and a sub-category. Everything else — pricing, images, specifications, the Arabic name — is edited on the record afterwards."
            />

            <PageBody>
                <NewProductForm
                    subCategories={subCategories.map((s) => ({
                        id: s.id,
                        name: `${s.category.translations[0]?.name ?? "—"} / ${s.translations[0]?.name ?? s.id}`,
                    }))}
                    families={families.map((f) => ({
                        id: f.id,
                        subCategoryId: f.subCategoryId,
                        name: f.slug,
                        variantType: f.variantType,
                    }))}
                />
            </PageBody>
        </>
    )
}
