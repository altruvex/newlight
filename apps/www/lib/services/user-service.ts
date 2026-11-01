import { prisma, serializeMoney, translationsFor, type Locale, ShippingAddress, User } from "@repo/database"

export interface UserWithAddress extends User {
    shippingAddress: ShippingAddress | null
}

export class UserService {

    static async getUserWithAddress(userId: string): Promise<UserWithAddress | null> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                shippingAddress: true,
            },
        })

        return user
    }

    static async getShippingAddress(userId: string): Promise<ShippingAddress | null> {
        const address = await prisma.shippingAddress.findUnique({
            where: { userId },
        })

        return address
    }

    static async saveShippingAddress(
        userId: string,
        data: {
            fullName: string
            phone: string
            email?: string
            addressLine1: string
            addressLine2?: string
            city: string
            state?: string
            postalCode: string
            country?: string
        }
    ): Promise<{ success: boolean; address: ShippingAddress }> {
        const existingAddress = await prisma.shippingAddress.findUnique({
            where: { userId },
        })

        let address: ShippingAddress

        if (existingAddress) {
            address = await prisma.shippingAddress.update({
                where: { userId },
                data: {
                    ...data,
                    country: data.country || "Egypt",
                },
            })
        } else {
            address = await prisma.shippingAddress.create({
                data: {
                    userId,
                    ...data,
                    country: data.country || "Egypt",
                    isDefault: true,
                },
            })
        }

        return { success: true, address }
    }

    static async deleteShippingAddress(userId: string): Promise<{ success: boolean }> {
        const address = await prisma.shippingAddress.findUnique({
            where: { userId },
        })

        if (!address) {
            return { success: true }
        }

        await prisma.shippingAddress.delete({
            where: { userId },
        })

        return { success: true }
    }

    static async hasShippingAddress(userId: string): Promise<boolean> {
        const address = await prisma.shippingAddress.findUnique({
            where: { userId },
            select: { id: true },
        })

        return !!address
    }

    static async getOrderHistory(
        userId: string,
        locale: Locale,
        options?: {
            skip?: number
            take?: number
        }
    ) {
        const { skip = 0, take = 10 } = options || {}

        const [rows, total] = await Promise.all([
            prisma.order.findMany({
                where: { userId },
                include: {
                    items: {
                        include: {
                            product: {
                                include: {
                                    translations: translationsFor(locale),
                                    images: { orderBy: { order: "asc" }, take: 1 },
                                },
                            },
                        },
                    },
                    shippingAddress: true,
                },
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prisma.order.count({
                where: { userId },
            }),
        ])

        const orders = rows.map((order) => ({
            ...order,
            subtotal: serializeMoney(order.subtotal),
            shippingCost: serializeMoney(order.shippingCost),
            tax: order.tax === null ? null : serializeMoney(order.tax),
            total: serializeMoney(order.total),
            items: order.items.map((item) => ({
                ...item,
                price: serializeMoney(item.price),
                product: {
                    productId: item.product.productId,
                    slug: item.product.slug,
                    name: item.product.translations[0]?.name ?? item.product.productId,
                    image: item.product.images[0]?.url ?? null,
                },
            })),
        }))

        return {
            orders,
            pagination: {
                total,
                skip,
                take,
                hasMore: skip + take < total,
            },
        }
    }

    static async getUserStats(userId: string) {
        const [orderCount, totalSpent, orders] = await Promise.all([
            prisma.order.count({
                where: { userId },
            }),
            // A cancellation is not money spent — the same rule the admin's customer record applies.
            prisma.order.aggregate({
                where: { userId, status: { not: "cancelled" } },
                _sum: { total: true },
            }),
            prisma.order.findMany({
                where: { userId },
                select: { status: true },
            }),
        ])

        const statusCounts = orders.reduce((acc, order) => {
            acc[order.status] = (acc[order.status] || 0) + 1
            return acc
        }, {} as Record<string, number>)

        return {
            orderCount,
            totalSpent: serializeMoney(totalSpent._sum.total ?? 0),
            statusCounts,
        }
    }
}