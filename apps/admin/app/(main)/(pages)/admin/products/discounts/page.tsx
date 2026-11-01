import { prisma } from "@repo/database"

import { requireCurrentAdmin } from "@/lib/auth"
import { DiscountService } from "@/lib/services/discount-service"
import { PageBody, PageHeader } from "@/components/page"
import { DiscountsClient } from "./discounts-client"

export const dynamic = "force-dynamic"

export default async function DiscountsPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; page?: string }>
}) {
    await requireCurrentAdmin()
    const params = await searchParams
    const view = params.status === "ended" ? "ended" : "current"

    // The picker below still gets every active product: the catalogue is bounded (~190) and the
    // "specific products" scope needs the whole list to search client-side.
    const [discounts, categories, subCategories, families, products] = await Promise.all([
        DiscountService.list({ view, page: Number(params.page ?? 1) || 1 }),
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
            where: { deletedAt: null },
            select: { id: true, slug: true, subCategoryId: true, _count: { select: { products: true } } },
            orderBy: { slug: "asc" },
        }),
        prisma.product.findMany({
            where: { deletedAt: null, isActive: true },
            select: {
                id: true,
                productId: true,
                subCategoryId: true,
                familyId: true,
                translations: { where: { locale: "en" }, select: { name: true }, take: 1 },
            },
            orderBy: { productId: "asc" },
        }),
    ])

    return (
        <>
            <PageHeader
                title="Discounts"
                description="A discount is a period, not a price change. The product keeps its price, sells for less while the discount runs, and goes back on its own when it ends — nothing has to be undone."
            />

            <PageBody>
                <DiscountsClient
                    discounts={discounts.rows}
                    view={discounts.view}
                    page={discounts.page}
                    totalPages={discounts.totalPages}
                    total={discounts.total}
                    categories={categories.map((category) => ({
                        id: category.id,
                        name: category.translations[0]?.name ?? category.id,
                    }))}
                    subCategories={subCategories.map((subCategory) => ({
                        id: subCategory.id,
                        categoryId: subCategory.categoryId,
                        name: subCategory.translations[0]?.name ?? subCategory.id,
                        productCount: subCategory._count.products,
                    }))}
                    families={families.map((family) => ({
                        id: family.id,
                        subCategoryId: family.subCategoryId,
                        name: family.slug,
                        productCount: family._count.products,
                    }))}
                    products={products.map((product) => ({
                        id: product.id,
                        sku: product.productId,
                        name: product.translations[0]?.name ?? product.productId,
                    }))}
                />
            </PageBody>
        </>
    )
}
