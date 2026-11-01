import { notFound } from "next/navigation"
import { OrderStatus, prisma, serializeMoney } from "@repo/database"

import { requireCurrentAdmin } from "@/lib/auth"
import { CustomerRecord } from "./customer-record"

export const dynamic = "force-dynamic"
export const revalidate = 0

// The tab shows the latest orders only; the totals are computed by the database, and the
// full history lives in the orders table (filtered to this customer).
const RECENT_ORDERS = 20

export default async function CustomerPage({ params }: { params: Promise<{ userId: string }> }) {
    await requireCurrentAdmin()
    const { userId } = await params

    const [user, audit, billable, cancelled] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                phoneNumber: true,
                role: true,
                preferredLanguage: true,
                preferredCurrency: true,
                createdAt: true,
                updatedAt: true,
                shippingAddress: true,
                orders: {
                    orderBy: { createdAt: "desc" },
                    take: RECENT_ORDERS,
                    select: {
                        id: true,
                        orderNumber: true,
                        status: true,
                        paymentStatus: true,
                        total: true,
                        shippingCost: true,
                        trackingNumber: true,
                        createdAt: true,
                        deliveredAt: true,
                        _count: { select: { items: true } },
                    },
                },
            },
        }),
        prisma.adminAuditLog.findMany({
            where: { entity: "User", entityId: userId },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
                id: true,
                action: true,
                actorEmail: true,
                actorType: true,
                createdAt: true,
            },
        }),
        prisma.order.aggregate({
            where: { userId, status: { not: OrderStatus.cancelled } },
            _count: { _all: true },
            _sum: { total: true },
        }),
        prisma.order.count({ where: { userId, status: OrderStatus.cancelled } }),
    ])

    if (!user) notFound()

    return (
        <CustomerRecord
            customer={{
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phoneNumber,
                role: user.role,
                preferredLanguage: user.preferredLanguage,
                preferredCurrency: user.preferredCurrency,
                createdAt: user.createdAt.toISOString(),
                updatedAt: user.updatedAt.toISOString(),
                address: user.shippingAddress
                    ? {
                          fullName: user.shippingAddress.fullName,
                          phone: user.shippingAddress.phone,
                          email: user.shippingAddress.email,
                          addressLine1: user.shippingAddress.addressLine1,
                          addressLine2: user.shippingAddress.addressLine2,
                          city: user.shippingAddress.city,
                          state: user.shippingAddress.state,
                          postalCode: user.shippingAddress.postalCode,
                          country: user.shippingAddress.country,
                      }
                    : null,
                stats: {
                    spend: serializeMoney(billable._sum.total ?? 0),
                    orders: billable._count._all,
                    cancelled,
                    lastOrder: user.orders[0]?.createdAt.toISOString() ?? null,
                },
                orders: user.orders.map((order) => ({
                    id: order.id,
                    orderNumber: order.orderNumber,
                    status: order.status,
                    paymentStatus: order.paymentStatus,
                    total: serializeMoney(order.total),
                    shippingCost: serializeMoney(order.shippingCost),
                    lines: order._count.items,
                    trackingNumber: order.trackingNumber,
                    createdAt: order.createdAt.toISOString(),
                    deliveredAt: order.deliveredAt?.toISOString() ?? null,
                })),
            }}
            audit={audit.map((entry) => ({
                id: entry.id,
                action: entry.action,
                actorEmail: entry.actorEmail,
                actorType: entry.actorType,
                createdAt: entry.createdAt.toISOString(),
            }))}
        />
    )
}
