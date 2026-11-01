"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { allowedTransitionsFrom, OrderStatus } from "@repo/database"

import { CellIdentity, CellText } from "@/components/data-table/cell-text"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableToolbar, type FilterDef } from "@/components/data-table/toolbar"
import { ConfirmAction } from "@/components/confirm-action"
import { Money } from "@/components/money"
import { StatusBadge } from "@/components/status-badge"
import StatusDropdown from "@/components/status-dropdown-menu"
import { Button } from "@/components/ui/button"
import { statusLabel } from "@/lib/status"
import type { OrderListResult, OrderRow } from "@/lib/services/order-list-service"
import type { TableState } from "@/lib/table-params"

interface Props extends OrderListResult {
    state: TableState
}

export function OrdersTable({ rows, total, counts, state }: Props) {
    const router = useRouter()
    const [hidden, setHidden] = useState<Record<string, boolean>>({ city: true, tracking: true })
    const [cancelling, setCancelling] = useState<string | null>(null)

    async function cancelOrder(order: OrderRow) {
        setCancelling(order.id)
        try {
            const response = await fetch(`/api/orders/${order.id}/cancel`, { method: "PATCH" })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Failed to cancel order")
            toast.success(`Order ${order.orderNumber} cancelled.`)
            router.refresh()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to cancel order")
        } finally {
            setCancelling(null)
        }
    }

    const columns: ColumnDef<OrderRow, unknown>[] = [
        {
            id: "orderNumber",
            header: "Order",
            cell: ({ row }) => (
                <span className="font-mono font-medium">{row.original.orderNumber}</span>
            ),
        },
        {
            id: "customer",
            header: "Customer",
            cell: ({ row }) => (
                <CellIdentity name={row.original.customerName} identifier={row.original.customerEmail} />
            ),
        },
        {
            id: "phone",
            header: "Phone",
            cell: ({ row }) => (
                <CellText className="font-mono text-2xs">{row.original.phone ?? "—"}</CellText>
            ),
        },
        {
            id: "city",
            header: "City",
            cell: ({ row }) =>
                row.original.city ? (
                    <CellText>{row.original.city}</CellText>
                ) : (
                    <span className="text-2xs text-danger">No address</span>
                ),
        },
        {
            id: "items",
            header: "Lines",
            meta: { numeric: true },
            cell: ({ row }) => (
                <span className="tabular-nums">
                    {row.original.items}
                    <span className="ml-1 text-2xs text-muted-foreground">
                        ({row.original.units} u)
                    </span>
                </span>
            ),
        },
        {
            id: "total",
            header: "Total",
            meta: { numeric: true },
            cell: ({ row }) => <Money value={row.original.total} />,
        },
        {
            id: "paymentStatus",
            header: "Payment",
            cell: ({ row }) => <StatusBadge kind="payment" value={row.original.paymentStatus} />,
        },
        {
            id: "tracking",
            header: "Tracking",
            cell: ({ row }) =>
                row.original.trackingNumber ? (
                    <CellText className="font-mono text-2xs">{row.original.trackingNumber}</CellText>
                ) : row.original.status === OrderStatus.shipped ? (
                    <span className="text-2xs text-warning">Not recorded</span>
                ) : (
                    <span className="text-2xs text-muted-foreground">—</span>
                ),
        },
        {
            id: "createdAt",
            header: "Placed",
            cell: ({ row }) => (
                <span className="tabular-nums text-muted-foreground">
                    {new Date(row.original.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                    })}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            cell: ({ row }) => (
                <div onClick={(event) => event.stopPropagation()}>
                    <StatusDropdown id={row.original.id} orderStatus={row.original.status} compact />
                </div>
            ),
        },
        {
            id: "actions",
            header: "",
            size: 84,
            cell: ({ row }) => {
                const cancellable = allowedTransitionsFrom(row.original.status, "ADMIN").includes("cancelled")
                if (!cancellable) return null
                return (
                    <div onClick={(event) => event.stopPropagation()} className="text-right">
                        <ConfirmAction
                            severity="consequential"
                            title={`Cancel order ${row.original.orderNumber}?`}
                            description="Cancelled is a terminal state — the order cannot be reopened, and a replacement has to be placed as a new one."
                            confirmLabel="Cancel order"
                            impact={{
                                affectedCount: 1,
                                financialImpact: row.original.total,
                                sideEffects: [
                                    "Reserved stock is released back to available.",
                                    "The customer is notified that the order was cancelled.",
                                ],
                            }}
                            onConfirm={() => cancelOrder(row.original)}
                        >
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={cancelling === row.original.id}
                                className="h-7 text-xs text-destructive hover:text-destructive"
                            >
                                {cancelling === row.original.id ? "Cancelling…" : "Cancel"}
                            </Button>
                        </ConfirmAction>
                    </div>
                )
            },
        },
    ]

    const customerFilter = state.filters.customer
    const filters: FilterDef[] = useMemo(
        () => [
            {
                key: "status",
                label: "Status",
                options: (Object.keys(counts) as OrderStatus[]).map((status) => ({
                    value: status,
                    label: `${statusLabel("order", status)} (${counts[status]})`,
                })),
                width: "w-52",
            },
            {
                key: "payment",
                label: "Payment",
                options: [
                    { value: "PENDING", label: "Pending" },
                    { value: "PAID", label: "Paid" },
                    { value: "REFUNDED", label: "Refunded" },
                    { value: "FAILED", label: "Failed" },
                ],
                width: "w-36",
            },
            {
                key: "tracking",
                label: "Tracking",
                options: [{ value: "missing", label: "Shipped, untracked" }],
                width: "w-44",
            },
            {
                key: "address",
                label: "Address",
                options: [{ value: "missing", label: "No address" }],
                width: "w-36",
            },
            // Only reachable from a customer record's "View all" link; shown so it can be cleared.
            ...(customerFilter
                ? [{
                    key: "customer",
                    label: "Customer",
                    options: [{ value: customerFilter, label: "This customer only" }],
                    width: "w-44",
                }]
                : []),
        ],
        [counts, customerFilter]
    )

    const visibleColumns = columns
        .filter((column) => column.id !== "__select" && column.id !== "actions")
        .map((column) => ({
            id: column.id!,
            label: String(column.header) || column.id!,
            visible: !hidden[column.id!],
            toggle: () => setHidden((current) => ({ ...current, [column.id!]: !current[column.id!] })),
        }))

    const shown = columns.filter((column) => !hidden[column.id!])

    return (
        <DataTable<OrderRow>
            caption={`Orders, ${total} total`}
            columns={shown}
            data={rows}
            rowCount={total}
            state={state}
            getRowId={(row) => row.orderNumber}
            sortableColumns={["orderNumber", "total", "status", "createdAt"]}
            onRowOpen={(row) => router.push(`/admin/orders/${row.id}`)}
            filtered={Object.keys(state.filters).length > 0}
            selection={{ bulkActions: [{ id: "export", label: "Export CSV", run: exportCsv }] }}
            toolbar={
                <DataTableToolbar
                    searchPlaceholder="Order, customer, phone or product…"
                    filters={filters}
                    columns={visibleColumns}
                />
            }
            emptyState={{
                noData: {
                    variant: "no-data",
                    title: "No orders yet",
                    description: "Orders appear here the moment a customer checks out on the storefront.",
                },
                noResults: {
                    variant: "no-results",
                    title: "No orders match these filters",
                    description: "Clear a filter or widen the search to see more.",
                },
            }}
        />
    )
}

function exportCsv(rows: OrderRow[]) {
    const headers = [
        "Order",
        "Placed",
        "Customer",
        "Email",
        "Phone",
        "City",
        "Lines",
        "Units",
        "Total",
        "Shipping",
        "Status",
        "Payment",
        "Tracking",
    ]
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`

    const body = rows.map((row) =>
        [
            row.orderNumber,
            new Date(row.createdAt).toISOString().slice(0, 10),
            row.customerName,
            row.customerEmail,
            row.phone ?? "",
            row.city ?? "",
            row.items,
            row.units,
            row.total,
            row.shippingCost,
            statusLabel("order", row.status),
            statusLabel("payment", row.paymentStatus),
            row.trackingNumber ?? "",
        ]
            .map(escape)
            .join(",")
    )

    const csv = `﻿${[headers.map(escape).join(","), ...body].join("\r\n")}`
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
}
