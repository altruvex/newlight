"use server"

import { OrderStatus, prisma, countLowStock } from "@repo/database"
import { unstable_cache } from "next/cache"
import { requireCurrentAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"
import type { DashboardStats } from "@/types"

const EMPTY_STATS: DashboardStats = {
    orders: 0,
    shipping: 0,
    lowStock: 0,
    products: 0,
    customers: 0,
    contacts: 0,
    untranslated: 0,
}

// Auth lives in the exported actions, not here: the cached function is shared by every admin,
// and a failure must throw so that unstable_cache does not hold on to a page of zeros for 60s.
const readDashboardStats = unstable_cache(
    async (): Promise<DashboardStats> => {
        const [shippedCount, awaitingShipmentCount, lowStock, totalProducts, totalCustomers, unreadContactForms, untranslated] =
            await Promise.all([
                prisma.order.count({ where: { status: OrderStatus.shipped } }),
                prisma.order.count({ where: { status: OrderStatus.awaiting_shipment } }),
                countLowStock(prisma, 10),
                prisma.product.count({ where: { isActive: true } }),
                prisma.user.count({ where: { role: "CUSTOMER" } }),
                prisma.contactForm.count({ where: { isRead: false } }),
                prisma.product.count({
                    where: { deletedAt: null, translations: { none: { locale: "ar" } } },
                }),
            ])

        return {
            orders: shippedCount + awaitingShipmentCount,
            shipping: awaitingShipmentCount,
            lowStock,
            products: totalProducts,
            customers: totalCustomers,
            contacts: unreadContactForms,
            untranslated,
        }
    },
    ["dashboard-stats"],
    {
        revalidate: 60,
        tags: ["dashboard-stats"],
    }
)

export const getDashboardStats = async (): Promise<DashboardStats> => {
    await requireCurrentAdmin()
    try {
        return await readDashboardStats()
    } catch (error) {
        logger.error({ err: error }, "dashboard stats could not be read")
        return EMPTY_STATS
    }
}

export const getOrderStats = async () => {
    await requireCurrentAdmin()
    try {
        const stats = await prisma.order.groupBy({
            by: ["status"],
            _count: {
                id: true,
            },
        })

        return stats.reduce(
            (acc, stat) => {
                acc[stat.status] = stat._count.id
                return acc
            },
            {} as Record<OrderStatus, number>
        )
    } catch (error) {
        logger.error({ err: error }, "order stats could not be read")
        return {} as Record<OrderStatus, number>
    }
}

export const getLowStockCount = async (threshold: number = 10) => {
    await requireCurrentAdmin()
    try {
        return await countLowStock(prisma, threshold)
    } catch (error) {
        logger.error({ err: error }, "low stock count could not be read")
        return 0
    }
}
