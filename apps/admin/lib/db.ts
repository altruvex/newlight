import { prisma, type OrderStatus, type Prisma } from "@repo/database"

const orderInclude = {
    user: { select: { id: true, name: true, email: true, phoneNumber: true } },
    items: true,
    shippingAddress: true,
} satisfies Prisma.OrderInclude

export type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>

export async function getOrdersByStatus(status: OrderStatus): Promise<OrderWithItems[]> {
    return prisma.order.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
        include: orderInclude,
    })
}

export async function getOrderById(id: string): Promise<OrderWithItems | null> {
    return prisma.order.findUnique({ where: { id }, include: orderInclude })
}
