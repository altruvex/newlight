import type { Prisma } from "@repo/database"

export type { NotificationType, NotificationPriority } from "@repo/database"

export type OrderWithDetails = Prisma.OrderGetPayload<{
    include: {
        items: {
            include: {
                product: { include: { translations: true } }
                configuration: true
            }
        }
        shippingAddress: true
        configuration: true
    }
}>

export type OrderWithCustomer = Prisma.OrderGetPayload<{
    include: {
        shippingAddress: true
        user: { select: { id: true; email: true; phoneNumber: true } }
        items: {
            include: {
                product: { include: { translations: true } }
                configuration: true
            }
        }
        configuration: true
    }
}>

export type DashboardStats = {
    orders: number
    shipping: number
    lowStock: number
    products: number
    customers: number
    contacts: number
    untranslated: number
}
