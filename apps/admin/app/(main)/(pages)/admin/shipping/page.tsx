import Link from "next/link"
import { requireCurrentAdmin } from "@/lib/auth"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ShippingService } from "@/lib/services/shipping-service"
import { RateEditor } from "./rate-editor"
import { TrackingInput } from "./tracking-input"
import { InlineAlert, PageBody, PageHeader, PageStack, Section, Stat, StatGrid, TableFrame } from "@/components/page"
import { EmptyState } from "@/components/states"

export const metadata = { title: "Shipping" }

export const dynamic = "force-dynamic"

export default async function ShippingPage() {
    await requireCurrentAdmin()

    const [rates, queue, destinations, untracked] = await Promise.all([
        ShippingService.rates(),
        ShippingService.fulfilmentQueue(),
        ShippingService.destinations(),
        ShippingService.shippedWithoutTracking(),
    ])

    const awaiting = queue.counts.awaiting_shipment ?? 0
    const inTransitCount = queue.counts.shipped ?? 0

    return (
        <>
            <PageHeader
                title="Shipping"
                description="What delivery costs, and what is waiting to go out. Changing a rate never touches an order already taken — what a customer was charged is a snapshot."
            />

            <PageBody>
                <PageStack>
                    {untracked > 0 && (
                        <InlineAlert tone="warning" title={`${untracked} shipped without a tracking number`}>
                            Tracking numbers are entered by hand under COD, so a blank one is normal — and still a
                            parcel nobody can answer a question about. They are listed under In transit below.
                        </InlineAlert>
                    )}

                    <StatGrid>
                        <Stat
                            label="Awaiting shipment"
                            value={awaiting}
                            hint={awaiting > 0 ? "oldest first, below" : "nothing waiting"}
                            tone={awaiting > 0 ? "warning" : "default"}
                        />
                        <Stat label="In transit" value={inTransitCount} />
                        <Stat label="Delivered" value={queue.counts.delivered ?? 0} />
                        <Stat
                            label="Shipped, untracked"
                            value={untracked}
                            tone={untracked > 0 ? "warning" : "default"}
                        />
                    </StatGrid>

                    <Section
                        title="Awaiting shipment"
                        description="Oldest first — the top row has waited longest."
                    >
                        <TableFrame>
                            {queue.awaiting.length === 0 ? (
                                <EmptyState
                                    variant="no-data"
                                    title="Nothing is waiting to ship"
                                    description="Every order that has been paid for is either in transit or delivered."
                                />
                            ) : (
                                <Table>
                                    <caption className="sr-only">Orders awaiting shipment, oldest first</caption>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead scope="col">Order</TableHead>
                                            <TableHead scope="col">Waiting</TableHead>
                                            <TableHead scope="col">Destination</TableHead>
                                            <TableHead scope="col">Method</TableHead>
                                            <TableHead scope="col" className="text-right">
                                                Shipping
                                            </TableHead>
                                            <TableHead scope="col" className="text-right">
                                                Total
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {queue.awaiting.map((order) => (
                                            <TableRow key={order.id}>
                                                <TableCell className="font-mono">
                                                    <Link
                                                        href={`/admin/orders/${order.id}`}
                                                        className="underline-offset-2 hover:underline"
                                                    >
                                                        {order.orderNumber}
                                                    </Link>
                                                </TableCell>
                                                <TableCell
                                                    className={
                                                        order.waitingDays >= 3
                                                            ? "font-medium tabular-nums text-warning"
                                                            : "tabular-nums"
                                                    }
                                                >
                                                    {order.waitingDays === 0 ? "today" : `${order.waitingDays}d`}
                                                </TableCell>
                                                <TableCell>
                                                    {order.shippingAddress ? (
                                                        <>
                                                            <span className="font-medium">
                                                                <bdi dir="auto">{order.shippingAddress.city}</bdi>
                                                            </span>
                                                            <span className="text-muted-foreground">
                                                                {" · "}
                                                                <bdi dir="auto">{order.shippingAddress.fullName}</bdi>
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="text-danger">No address</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {order.shippingOption.replace("Shipping", "")}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {order.shippingCost}
                                                </TableCell>
                                                <TableCell className="text-right font-medium tabular-nums">
                                                    {order.total}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </TableFrame>
                        {awaiting > queue.awaiting.length && (
                            <p className="mt-2 text-sm">
                                <Link
                                    href="/admin/orders?status=awaiting_shipment&sort=createdAt&dir=asc"
                                    className="text-muted-foreground underline-offset-2 hover:underline"
                                >
                                    View all ({awaiting})
                                </Link>
                            </p>
                        )}
                    </Section>

                    <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
                        <Section
                            title="In transit"
                            description="A blank tracking number is normal under COD, and still a parcel nobody can answer a question about."
                        >
                            <TableFrame>
                                {queue.inTransit.length === 0 ? (
                                    <EmptyState
                                        variant="no-data"
                                        title="Nothing is in transit"
                                        description="No order has been marked shipped and not yet delivered."
                                    />
                                ) : (
                                    <Table>
                                        <caption className="sr-only">Orders in transit</caption>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead scope="col">Order</TableHead>
                                                <TableHead scope="col">Shipped</TableHead>
                                                <TableHead scope="col">Tracking</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {queue.inTransit.map((order) => (
                                                <TableRow key={order.id}>
                                                    <TableCell className="font-mono">
                                                        <Link
                                                            href={`/admin/orders/${order.id}`}
                                                            className="underline-offset-2 hover:underline"
                                                        >
                                                            {order.orderNumber}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell className="tabular-nums whitespace-nowrap">
                                                        {order.shippedAt
                                                            ? new Date(order.shippedAt).toLocaleDateString("en-GB")
                                                            : "—"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <TrackingInput
                                                            orderId={order.id}
                                                            current={order.trackingNumber}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </TableFrame>
                            {inTransitCount > queue.inTransit.length && (
                                <p className="mt-2 text-sm">
                                    <Link
                                        href="/admin/orders?status=shipped&sort=createdAt&dir=asc"
                                        className="text-muted-foreground underline-offset-2 hover:underline"
                                    >
                                        View all ({inTransitCount})
                                    </Link>
                                </p>
                            )}
                        </Section>

                        <Section
                            title="Destinations"
                            description="Where orders went in the last 90 days. Rates are flat today; this is what a per-city rate would be built on."
                        >
                            <TableFrame>
                                {destinations.length === 0 ? (
                                    <EmptyState
                                        variant="no-data"
                                        title="No orders with an address in the last 90 days"
                                        description="A destination appears here once an order carrying a shipping address is placed."
                                    />
                                ) : (
                                    <Table>
                                        <caption className="sr-only">Orders by destination city</caption>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead scope="col">City</TableHead>
                                                <TableHead scope="col" className="text-right">
                                                    Orders
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {destinations.map((row) => (
                                                <TableRow key={row.city}>
                                                    <TableCell className="font-medium">
                                                        <bdi dir="auto">{row.city}</bdi>
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {Number(row.orders)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </TableFrame>
                        </Section>
                    </div>

                    <Section
                        title="Rates"
                        description="Applied when an order is placed. Changing a rate never touches an order already taken."
                    >
                        <RateEditor rates={rates} />
                    </Section>
                </PageStack>
            </PageBody>
        </>
    )
}
