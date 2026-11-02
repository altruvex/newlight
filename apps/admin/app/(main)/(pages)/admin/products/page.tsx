import { requireCurrentAdmin } from "@/lib/auth"
import { listProducts } from "@/lib/services/product-list-service"
import { parseTableState } from "@/lib/table-params"
import { ProductsTable } from "./products-table"

export const metadata = { title: "Products" }

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ProductsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    await requireCurrentAdmin()

    const state = parseTableState(await searchParams, { sort: "createdAt", dir: "desc" })
    const result = await listProducts(state)

    return (
        <div className="flex h-full flex-col">
            <ProductsTable {...result} state={state} />
        </div>
    )
}
