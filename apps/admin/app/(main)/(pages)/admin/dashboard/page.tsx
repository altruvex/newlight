import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { requireCurrentAdmin } from "@/lib/auth"
import { getOverview, type AttentionItem } from "@/lib/services/overview-service"
import { InlineAlert, PageBody, PageHeader, PageStack, Panel, Section, Stat, StatGrid, TableFrame } from "@/components/page"
import { Money } from "@/components/money"
import { StatusBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/states"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const revalidate = 0

const TONE_CLASS: Record<AttentionItem["tone"], string> = {
    danger: "border-danger-border bg-danger-bg text-danger",
    warning: "border-warning-border bg-warning-bg text-warning",
    neutral: "border-border bg-card text-foreground",
}

export default async function DashboardPage() {
    const admin = await requireCurrentAdmin()
    const overview = await getOverview()

    const firstName = admin.email.split("@")[0]

    return (
        <>
            <PageHeader
                title="Overview"
                description={`Signed in as ${firstName}. The tiles refresh every minute; recent orders and activity are live.`}
            />

            <PageBody>
                <PageStack>
                    {overview.openingCountPending && (
                        <InlineAlert
                            tone="warning"
                            title="Opening stock count still pending"
                            action={
                                <Link
                                    href="/admin/inventory"
                                    className="text-xs font-medium text-warning underline-offset-2 hover:underline"
                                >
                                    Go to Inventory
                                </Link>
                            }
                        >
                            Stock levels arrived from the migration as an opening balance nobody has physically
                            counted. Valuation and margin refuse to report a number until a real stocktake closes it.
                        </InlineAlert>
                    )}

                    <Section
                        title="Needs attention"
                        description={
                            overview.attention.length === 0
                                ? undefined
                                : "Ordered by urgency. Each one opens the surface that resolves it."
                        }
                    >
                        {overview.attention.length === 0 ? (
                            <Panel padded={false}>
                                <EmptyState
                                    variant="no-data"
                                    title="Nothing needs attention"
                                    description="No unshipped backlog, no unread enquiries, no stock below the threshold, and every product has a cost and an Arabic name."
                                />
                            </Panel>
                        ) : (
                            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {overview.attention.map((item) => (
                                    <li key={item.id}>
                                        <Link
                                            href={item.href}
                                            className={cn(
                                                "group flex items-start gap-3 rounded-lg border p-3",
                                                "transition-colors duration-(--duration-fast) hover:border-border-strong",
                                                TONE_CLASS[item.tone]
                                            )}
                                        >
                                            <span className="text-xl font-semibold tabular-nums">{item.count}</span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-xs font-medium">{item.label}</span>
                                                <span className="mt-0.5 block text-2xs text-muted-foreground">
                                                    {item.detail}
                                                </span>
                                            </span>
                                            <ArrowRight
                                                aria-hidden
                                                className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                                            />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section
                        title="Trading"
                        description="Cancelled orders are excluded — a cancellation is not revenue."
                    >
                        <StatGrid>
                            <Stat label="Orders today" value={overview.today.orders} />
                            <Stat
                                label="Revenue today"
                                value={<Money value={overview.today.revenue} className="text-xl font-semibold" />}
                            />
                            <Stat label="Orders" value={overview.week.orders} hint="last 7 days" />
                            <Stat
                                label="Revenue"
                                hint="last 7 days"
                                value={<Money value={overview.week.revenue} className="text-xl font-semibold" />}
                            />
                        </StatGrid>
                    </Section>

                    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
                        <Section
                            title="Latest orders"
                            description="The eight most recent, whatever their state."
                            actions={
                                <Link
                                    href="/admin/orders"
                                    className="text-xs text-primary underline-offset-2 hover:underline"
                                >
                                    All orders
                                </Link>
                            }
                        >
                            <TableFrame>
                                {overview.recentOrders.length === 0 ? (
                                    <EmptyState
                                        variant="no-data"
                                        title="No orders yet"
                                        description="Orders appear here the moment a customer checks out on the storefront."
                                    />
                                ) : (
                                    <Table>
                                        <caption className="sr-only">The eight most recent orders</caption>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead scope="col">Order</TableHead>
                                                <TableHead scope="col">Customer</TableHead>
                                                <TableHead scope="col">Placed</TableHead>
                                                <TableHead scope="col">Status</TableHead>
                                                <TableHead scope="col" className="text-right">
                                                    Total
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {overview.recentOrders.map((order) => (
                                                <TableRow key={order.id}>
                                                    <TableCell className="font-mono">
                                                        <Link
                                                            href={`/admin/orders/${order.id}`}
                                                            className="underline-offset-2 hover:underline"
                                                        >
                                                            {order.orderNumber}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell className="max-w-[22ch] truncate">
                                                        <bdi dir="auto">{order.customer}</bdi>
                                                    </TableCell>
                                                    <TableCell className="tabular-nums text-muted-foreground">
                                                        {order.ageDays === 0
                                                            ? "today"
                                                            : `${order.ageDays}d ago`}
                                                    </TableCell>
                                                    <TableCell>
                                                        <StatusBadge kind="order" value={order.status} />
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Money value={order.total} />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </TableFrame>
                        </Section>

                        <Section
                            title="Recent changes"
                            description="Who changed what, from the audit trail."
                            actions={
                                <Link
                                    href="/admin/audit"
                                    className="text-xs text-primary underline-offset-2 hover:underline"
                                >
                                    Full log
                                </Link>
                            }
                        >
                            <Panel padded={false} className="overflow-hidden">
                                {overview.activity.length === 0 ? (
                                    <EmptyState
                                        variant="no-data"
                                        title="Nothing recorded yet"
                                        description="Every change made through this panel is logged here as it happens."
                                    />
                                ) : (
                                    <ol className="divide-y">
                                        {overview.activity.map((entry) => (
                                            <li key={entry.id} className="px-3 py-2">
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <span className="truncate font-mono text-xs">{entry.action}</span>
                                                    <time
                                                        dateTime={entry.createdAt}
                                                        suppressHydrationWarning
                                                        className="shrink-0 tabular-nums text-2xs text-muted-foreground"
                                                    >
                                                        {new Date(entry.createdAt).toLocaleTimeString("en-GB", {
                                                            hour: "2-digit",
                                                            minute: "2-digit",
                                                        })}
                                                    </time>
                                                </div>
                                                <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                                                    <span className="truncate">{entry.actorEmail ?? "system"}</span>
                                                    <span aria-hidden>·</span>
                                                    <span className="truncate">{entry.entity}</span>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </Panel>
                        </Section>
                    </div>
                </PageStack>
            </PageBody>
        </>
    )
}
