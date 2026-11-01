import {
    ContactFormStatus,
    OrderStatus,
    countLowStock,
    prisma,
    serializeMoney,
    type SerializedMoney,
} from "@repo/database"

import { unstable_cache } from "next/cache"

import { requireCurrentAdmin } from "@/lib/auth"

export interface AttentionItem {
    id: string
    label: string
    detail: string
    count: number
    href: string
    tone: "danger" | "warning" | "neutral"
}

export interface RecentOrder {
    id: string
    orderNumber: string
    customer: string
    total: SerializedMoney
    status: OrderStatus
    createdAt: string
    ageDays: number
}

export interface ActivityEntry {
    id: string
    action: string
    entity: string
    entityId: string
    actorEmail: string | null
    actorType: string | null
    createdAt: string
}

export interface Overview {
    attention: AttentionItem[]
    today: {
        orders: number
        revenue: SerializedMoney
    }
    week: {
        orders: number
        revenue: SerializedMoney
    }
    fulfilment: {
        awaiting: number
        oldestWaitDays: number | null
        inTransit: number
    }
    recentOrders: RecentOrder[]
    activity: ActivityEntry[]
    openingCountPending: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(from: Date, to: Date) {
    return Math.floor((to.getTime() - from.getTime()) / DAY_MS)
}

type OverviewStats = Pick<Overview, "attention" | "today" | "week" | "fulfilment" | "openingCountPending">

// The counts and aggregates behind the tiles. Auth stays in getOverview(), outside the cache:
// the result is shared by every admin, and a failure throws so no page of zeros is held for 60s.
const readOverviewStats = unstable_cache(
    async (): Promise<OverviewStats> => {
        const now = new Date()
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const weekAgo = new Date(now.getTime() - 7 * DAY_MS)
        const threeDaysAgo = new Date(now.getTime() - 3 * DAY_MS)

        const [
            todayAggregate,
            weekAggregate,
            awaiting,
            oldestAwaiting,
            inTransit,
            untracked,
            noAddress,
            unreadContacts,
            staleContacts,
            lowStock,
            withoutCost,
            untranslated,
            openingSetting,
        ] = await Promise.all([
            prisma.order.aggregate({
                where: { createdAt: { gte: startOfToday }, status: { not: OrderStatus.cancelled } },
                _count: { _all: true },
                _sum: { total: true },
            }),
            prisma.order.aggregate({
                where: { createdAt: { gte: weekAgo }, status: { not: OrderStatus.cancelled } },
                _count: { _all: true },
                _sum: { total: true },
            }),
            prisma.order.count({ where: { status: OrderStatus.awaiting_shipment } }),
            prisma.order.findFirst({
                where: { status: OrderStatus.awaiting_shipment },
                orderBy: { createdAt: "asc" },
                select: { createdAt: true },
            }),
            prisma.order.count({ where: { status: OrderStatus.shipped } }),
            prisma.order.count({
                where: { status: OrderStatus.shipped, OR: [{ trackingNumber: null }, { trackingNumber: "" }] },
            }),
            prisma.order.count({
                where: { shippingAddressId: null, status: { in: [OrderStatus.awaiting_shipment, OrderStatus.shipped] } },
            }),
            prisma.contactForm.count({ where: { isRead: false } }),
            prisma.contactForm.count({
                where: {
                    isRead: false,
                    createdAt: { lt: threeDaysAgo },
                    status: { notIn: [ContactFormStatus.CLOSED, ContactFormStatus.SPAM] },
                },
            }),
            countLowStock(prisma, 10),
            prisma.product.count({ where: { deletedAt: null, averageCost: null } }),
            prisma.product.count({ where: { deletedAt: null, translations: { none: { locale: "ar" } } } }),
            prisma.systemSetting.findUnique({ where: { key: "inventory.opening_count_pending" } }),
        ])

        const oldestWaitDays = oldestAwaiting ? daysBetween(oldestAwaiting.createdAt, now) : null

        const attention: AttentionItem[] = ([
            {
                id: "no-address",
                label: "Orders with no address",
                detail: "Cannot be dispatched at all until somebody captures one.",
                count: noAddress,
                href: "/admin/orders?address=missing",
                tone: "danger",
            },
            {
                id: "stale-contacts",
                label: "Enquiries unopened over 3 days",
                detail: "Nobody has read them.",
                count: staleContacts,
                href: "/admin/contact?read=unread",
                tone: "danger",
            },
            {
                id: "awaiting",
                label: "Orders awaiting shipment",
                detail:
                    oldestWaitDays === null
                        ? "Nothing waiting."
                        : `The oldest has waited ${oldestWaitDays === 0 ? "less than a day" : `${oldestWaitDays} day${oldestWaitDays === 1 ? "" : "s"}`}.`,
                count: awaiting,
                href: "/admin/shipping",
                tone: oldestWaitDays !== null && oldestWaitDays >= 3 ? "danger" : "warning",
            },
            {
                id: "untracked",
                label: "Shipped without tracking",
                detail: "Nobody can answer a question about where the parcel is.",
                count: untracked,
                href: "/admin/orders?tracking=missing",
                tone: "warning",
            },
            {
                id: "unread-contacts",
                label: "Unread enquiries",
                detail: "Submissions nobody has opened yet.",
                count: unreadContacts,
                href: "/admin/contact?read=unread",
                tone: "warning",
            },
            {
                id: "low-stock",
                label: "Products low on stock",
                detail: "Fewer than 10 available after reservations.",
                count: lowStock,
                href: "/admin/inventory",
                tone: "warning",
            },
            {
                id: "untranslated",
                label: "Products with no Arabic",
                detail: "They fall back to the English name on an Arabic page.",
                count: untranslated,
                href: "/admin/translations",
                tone: "neutral",
            },
            {
                id: "no-cost",
                label: "Products with no cost",
                detail: "Margin cannot be reported until a cost is recorded.",
                count: withoutCost,
                href: "/admin/inventory",
                tone: "neutral",
            },
        ] satisfies AttentionItem[]).filter((item) => item.count > 0)

        return {
            attention,
            today: {
                orders: todayAggregate._count._all,
                revenue: serializeMoney(todayAggregate._sum.total ?? 0),
            },
            week: {
                orders: weekAggregate._count._all,
                revenue: serializeMoney(weekAggregate._sum.total ?? 0),
            },
            fulfilment: { awaiting, oldestWaitDays, inTransit },
            openingCountPending: openingSetting?.value === "true",
        }
    },
    ["admin-overview-stats"],
    { revalidate: 60, tags: ["dashboard-stats"] }
)

export async function getOverview(): Promise<Overview> {
    await requireCurrentAdmin()

    // The two feeds stay live (8 and 10 rows); only the aggregates are cached.
    const now = new Date()
    const [stats, recentOrderRows, activityRows] = await Promise.all([
        readOverviewStats(),
        prisma.order.findMany({
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
                id: true,
                orderNumber: true,
                total: true,
                status: true,
                createdAt: true,
                user: { select: { name: true, email: true } },
                shippingAddress: { select: { fullName: true } },
            },
        }),
        prisma.adminAuditLog.findMany({
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
                id: true,
                action: true,
                entity: true,
                entityId: true,
                actorEmail: true,
                actorType: true,
                createdAt: true,
            },
        }),
    ])

    return {
        ...stats,
        recentOrders: recentOrderRows.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            customer: order.shippingAddress?.fullName || order.user.name || order.user.email,
            total: serializeMoney(order.total),
            status: order.status,
            createdAt: order.createdAt.toISOString(),
            ageDays: daysBetween(order.createdAt, now),
        })),
        activity: activityRows.map((row) => ({
            id: row.id,
            action: row.action,
            entity: row.entity,
            entityId: row.entityId,
            actorEmail: row.actorEmail,
            actorType: row.actorType,
            createdAt: row.createdAt.toISOString(),
        })),
    }
}
