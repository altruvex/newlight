"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { DataTablePagination } from "@/components/data-table/pagination"
import { buildTableQuery, parseTableState } from "@/lib/table-params"

export function QueuePager({ total }: { total: number }) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const state = parseTableState(Object.fromEntries(searchParams.entries()))

    return (
        <DataTablePagination
            state={state}
            total={total}
            onChange={(patch) =>
                router.push(`${pathname}${buildTableQuery(new URLSearchParams(searchParams.toString()), patch)}`, {
                    scroll: false,
                })
            }
        />
    )
}
