import { requireCurrentAdmin } from "@/lib/auth"
import { listOrders } from "@/lib/services/order-list-service"
import { parseTableState } from "@/lib/table-params"
import { OrdersTable } from "./orders-table"

export const metadata = { title: "Orders" }

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function OrdersPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    await requireCurrentAdmin()

    const state = parseTableState(await searchParams, { sort: "createdAt", dir: "desc" })
    const result = await listOrders(state)

    return (
        <div className="flex h-full flex-col">
            <OrdersTable {...result} state={state} />
        </div>
    )
}
