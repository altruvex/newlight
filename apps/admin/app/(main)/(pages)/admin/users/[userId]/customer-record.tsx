"use client"

import Link from "next/link"
import type { OrderStatus, PaymentStatus, SerializedMoney, UserRole } from "@repo/database"

import { RecordLayout, type AuditEntry } from "@/components/record/record-layout"
import { MetadataList, Panel, Section, Stat, StatGrid, TableFrame } from "@/components/page"
import { Money } from "@/components/money"
import { StatusBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export interface CustomerOrder {
    id: string
    orderNumber: string
    status: OrderStatus
    paymentStatus: PaymentStatus
    total: SerializedMoney
    shippingCost: SerializedMoney
    lines: number
    trackingNumber: string | null
    createdAt: string
    deliveredAt: string | null
}

export interface CustomerAddress {
    fullName: string
    phone: string
    email: string | null
    addressLine1: string
    addressLine2: string | null
    city: string
    state: string | null
    postalCode: string
    country: string
}

export interface CustomerStats {
    /** Lifetime spend, cancelled orders excluded — summed by the database. */
    spend: SerializedMoney
    orders: number
    cancelled: number
    lastOrder: string | null
}

export interface Customer {
    id: string
    name: string
    email: string
    phone: string | null
    role: UserRole
    preferredLanguage: string
    preferredCurrency: string
    createdAt: string
    updatedAt: string
    address: CustomerAddress | null
    stats: CustomerStats
    /** The latest orders only; `stats` carries the totals. */
    orders: CustomerOrder[]
}

export function CustomerRecord({ customer, audit }: { customer: Customer; audit: AuditEntry[] }) {
    const lifetime = customer.stats
    const totalOrders = lifetime.orders + lifetime.cancelled
    const ordersHref = `/admin/orders?customer=${encodeURIComponent(customer.id)}`

    return (
        <RecordLayout
            title={customer.address?.fullName || customer.name || customer.email}
            subtitle={customer.email}
            status={{ kind: "role", value: customer.role }}
            identifiers={[
                { label: "Customer", value: customer.id },
                { label: "Prefers", value: `${customer.preferredLanguage.toUpperCase()} · ${customer.preferredCurrency}`, mono: false },
            ]}
            actions={
                customer.phone || customer.address?.phone ? (
                    <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                        <a href={`tel:${customer.phone ?? customer.address?.phone}`}>Call</a>
                    </Button>
                ) : undefined
            }
            rail={{
                createdAt: customer.createdAt,
                updatedAt: customer.updatedAt,
                audit,
                auditHref: `/admin/audit?entity=User&q=${customer.id}`,
            }}
            tabs={[
                {
                    id: "orders",
                    label: "Orders",
                    badge:
                        totalOrders > 0 ? (
                            <span className="tabular-nums text-muted-foreground">{totalOrders}</span>
                        ) : undefined,
                    content: (
                        <div className="flex flex-col gap-5">
                            <StatGrid>
                                <Stat
                                    label="Lifetime spend"
                                    value={<Money value={lifetime.spend} className="text-xl font-semibold" />}
                                    hint="cancelled orders excluded"
                                />
                                <Stat label="Orders placed" value={lifetime.orders} />
                                <Stat
                                    label="Cancelled"
                                    value={lifetime.cancelled}
                                    tone={lifetime.cancelled > 0 ? "warning" : "default"}
                                />
                                <Stat
                                    label="Last order"
                                    value={
                                        lifetime.lastOrder
                                            ? new Date(lifetime.lastOrder).toLocaleDateString("en-GB", {
                                                  day: "2-digit",
                                                  month: "short",
                                                  year: "numeric",
                                              })
                                            : undefined
                                    }
                                    unavailable={lifetime.lastOrder ? undefined : "never ordered"}
                                />
                            </StatGrid>

                            <TableFrame>
                                {customer.orders.length === 0 ? (
                                    <EmptyState
                                        variant="no-data"
                                        title="This customer has not ordered"
                                        description="The account exists — it was created when they signed in — but no order has been placed against it."
                                    />
                                ) : (
                                    <Table>
                                        <caption className="sr-only">The latest orders placed by this customer</caption>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead scope="col">Order</TableHead>
                                                <TableHead scope="col">Placed</TableHead>
                                                <TableHead scope="col" className="text-right">
                                                    Lines
                                                </TableHead>
                                                <TableHead scope="col" className="text-right">
                                                    Shipping
                                                </TableHead>
                                                <TableHead scope="col" className="text-right">
                                                    Total
                                                </TableHead>
                                                <TableHead scope="col">Payment</TableHead>
                                                <TableHead scope="col">Delivered</TableHead>
                                                <TableHead scope="col">Status</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {customer.orders.map((order) => (
                                                <TableRow key={order.id}>
                                                    <TableCell className="font-mono">
                                                        <Link
                                                            href={`/admin/orders/${order.id}`}
                                                            className="underline-offset-2 hover:underline"
                                                        >
                                                            {order.orderNumber}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell className="tabular-nums text-muted-foreground">
                                                        {formatDate(order.createdAt)}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {order.lines}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Money value={order.shippingCost} />
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Money value={order.total} />
                                                    </TableCell>
                                                    <TableCell>
                                                        <StatusBadge kind="payment" value={order.paymentStatus} />
                                                    </TableCell>
                                                    <TableCell className="tabular-nums text-muted-foreground">
                                                        {order.deliveredAt ? formatDate(order.deliveredAt) : "—"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <StatusBadge kind="order" value={order.status} />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </TableFrame>

                            {totalOrders > customer.orders.length && (
                                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                    <span>
                                        Showing the latest {customer.orders.length} of {totalOrders} orders.
                                    </span>
                                    <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                                        <Link href={ordersHref}>View all {totalOrders} orders</Link>
                                    </Button>
                                </div>
                            )}
                        </div>
                    ),
                },
                {
                    id: "profile",
                    label: "Profile",
                    content: (
                        <div className="grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-2">
                            <Section title="Account">
                                <Panel>
                                    <MetadataList
                                        items={[
                                            { label: "Name", value: customer.name || "—" },
                                            { label: "Email", value: customer.email },
                                            { label: "Phone", value: customer.phone ?? "—", mono: true },
                                            { label: "Role", value: <StatusBadge kind="role" value={customer.role} /> },
                                            { label: "Language", value: customer.preferredLanguage.toUpperCase() },
                                            { label: "Currency", value: customer.preferredCurrency },
                                            { label: "Member since", value: formatDate(customer.createdAt) },
                                        ]}
                                    />
                                </Panel>
                            </Section>

                            <Section
                                title="Shipping address"
                                description="One address per customer — this is the one orders are delivered to."
                            >
                                <Panel>
                                    {customer.address ? (
                                        <MetadataList
                                            items={[
                                                { label: "Recipient", value: <bdi dir="auto">{customer.address.fullName}</bdi> },
                                                { label: "Phone", value: customer.address.phone, mono: true },
                                                {
                                                    label: "Street",
                                                    value: (
                                                        <bdi dir="auto">
                                                            {[customer.address.addressLine1, customer.address.addressLine2]
                                                                .filter(Boolean)
                                                                .join(", ")}
                                                        </bdi>
                                                    ),
                                                },
                                                {
                                                    label: "City",
                                                    value: (
                                                        <bdi dir="auto">
                                                            {[customer.address.city, customer.address.state]
                                                                .filter(Boolean)
                                                                .join(", ")}
                                                        </bdi>
                                                    ),
                                                },
                                                { label: "Postal code", value: customer.address.postalCode, mono: true },
                                                { label: "Country", value: customer.address.country },
                                            ]}
                                        />
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            No address has been captured. Orders from this customer cannot be
                                            dispatched until one is — the storefront asks for it at checkout.
                                        </p>
                                    )}
                                </Panel>
                            </Section>
                        </div>
                    ),
                },
            ]}
        />
    )
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}
