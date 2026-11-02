import { requireCurrentAdmin } from "@/lib/auth"
import { listCustomers } from "@/lib/services/customer-list-service"
import { parseTableState } from "@/lib/table-params"
import { CustomersTable } from "./customers-table"

export const metadata = { title: "Customers" }

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function CustomersPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    await requireCurrentAdmin()

    const state = parseTableState(await searchParams, { sort: "createdAt", dir: "desc" })
    const result = await listCustomers(state)

    return (
        <div className="flex h-full flex-col">
            <CustomersTable {...result} state={state} />
        </div>
    )
}
