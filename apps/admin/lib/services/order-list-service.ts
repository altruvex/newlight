import {
    OrderStatus,
    PaymentStatus,
    Prisma,
    prisma,
    serializeMoney,
    type SerializedMoney,
} from "@repo/database"

import { toPrismaPage, type TableState } from "@/lib/table-params"

export const ORDER_SORT_COLUMNS = ["orderNumber", "total", "status", "createdAt"] as const
export type OrderSortColumn = (typeof ORDER_SORT_COLUMNS)[number]

export interface OrderRow {
    id: string
    orderNumber: string
    customerId: string
    customerName: string
    customerEmail: string
    phone: string | null
    city: string | null
    items: number
    units: number
    total: SerializedMoney
    shippingCost: SerializedMoney
    status: OrderStatus
    paymentStatus: PaymentStatus
    trackingNumber: string | null
    createdAt: string
}

export interface OrderListResult {
    rows: OrderRow[]
    total: number
    counts: Record<OrderStatus, number>
}

function buildWhere(state: TableState): Prisma.OrderWhereInput {
    const { filters } = state
    const and: Prisma.OrderWhereInput[] = []

    const query = filters.q?.trim()
    if (query) {
        and.push({
            OR: [
                { orderNumber: { contains: query, mode: "insensitive" } },
                { trackingNumber: { contains: query, mode: "insensitive" } },
                { user: { email: { contains: query, mode: "insensitive" } } },
                { user: { name: { contains: query, mode: "insensitive" } } },
                { shippingAddress: { fullName: { contains: query, mode: "insensitive" } } },
                { shippingAddress: { phone: { contains: query } } },
                { items: { some: { productName: { contains: query, mode: "insensitive" } } } },
            ],
        })
    }

    if (filters.status && filters.status in OrderStatus) {
        and.push({ status: filters.status as OrderStatus })
    }
    if (filters.payment && filters.payment in PaymentStatus) {
        and.push({ paymentStatus: filters.payment as PaymentStatus })
    }

    if (filters.tracking === "missing") {
        and.push({ status: OrderStatus.shipped, OR: [{ trackingNumber: null }, { trackingNumber: "" }] })
    }
    if (filters.address === "missing") and.push({ shippingAddressId: null })
    // Exact owner, from a customer record's "View all" link; `q` would also match look-alike emails.
    if (filters.customer) and.push({ userId: filters.customer })

    return and.length > 0 ? { AND: and } : {}
}

function buildOrderBy(state: TableState): Prisma.OrderOrderByWithRelationInput[] {
    switch (state.sort as OrderSortColumn | null) {
        case "orderNumber":
            return [{ orderNumber: state.dir }]
        case "total":
            return [{ total: state.dir }]
        case "status":
            return [{ status: state.dir }, { createdAt: "asc" }]
        case "createdAt":
        default:
            return [{ createdAt: state.dir }]
    }
}

const EMPTY_COUNTS: Record<OrderStatus, number> = {
    awaiting_shipment: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
}

export async function listOrders(state: TableState): Promise<OrderListResult> {
    const where = buildWhere(state)

    const [total, grouped] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    ])

    const { skip, take } = toPrismaPage(state, total)

    const orders = await prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(state),
        select: {
            id: true,
            orderNumber: true,
            total: true,
            shippingCost: true,
            status: true,
            paymentStatus: true,
            trackingNumber: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true, phoneNumber: true } },
            shippingAddress: { select: { fullName: true, phone: true, city: true } },
            items: { select: { quantity: true } },
        },
    })

    const counts = { ...EMPTY_COUNTS }
    for (const row of grouped) counts[row.status] = row._count._all

    const rows: OrderRow[] = orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        customerId: order.user.id,
        customerName: order.shippingAddress?.fullName || order.user.name || order.user.email,
        customerEmail: order.user.email,
        phone: order.shippingAddress?.phone ?? order.user.phoneNumber ?? null,
        city: order.shippingAddress?.city ?? null,
        items: order.items.length,
        units: order.items.reduce((sum, item) => sum + item.quantity, 0),
        total: serializeMoney(order.total),
        shippingCost: serializeMoney(order.shippingCost),
        status: order.status,
        paymentStatus: order.paymentStatus,
        trackingNumber: order.trackingNumber,
        createdAt: order.createdAt.toISOString(),
    }))

    return { rows, total, counts }
}
