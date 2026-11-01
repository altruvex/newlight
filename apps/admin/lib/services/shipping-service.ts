import {
    prisma,
    money,
    serializeMoney,
    getShippingRates,
    shippingRateKey,
    SHIPPING_OPTIONS,
    DEFAULT_SHIPPING_RATES,
    type ShippingOption,
    type SerializedMoney,
} from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { revalidateStorefront } from "@/lib/revalidate"

export class ShippingError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "ShippingError"
    }
}

export class ShippingService {
    static async rates(): Promise<Array<{ option: ShippingOption; amount: SerializedMoney; isDefault: boolean }>> {
        await requireCurrentAdmin()
        const rates = await getShippingRates(prisma)
        return SHIPPING_OPTIONS.map((option) => ({
            option,
            amount: serializeMoney(rates[option]),
            isDefault: serializeMoney(rates[option]) === DEFAULT_SHIPPING_RATES[option],
        }))
    }

    static async setRate(option: ShippingOption, amount: string) {
        const admin = await requireCurrentAdmin()

        let parsed
        try {
            parsed = money(amount)
        } catch {
            throw new ShippingError(`"${amount}" is not an amount.`)
        }
        if (parsed.isNegative()) throw new ShippingError("A shipping rate cannot be negative.")

        const value = serializeMoney(parsed)
        const key = shippingRateKey(option)

        await prisma.$transaction(async (tx) => {
            const before = await tx.systemSetting.findUnique({ where: { key }, select: { value: true } })
            await tx.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
            await tx.adminAuditLog.create({
                data: {
                    actorType: "ADMIN",
                    actorId: admin.id,
                    actorEmail: admin.email,
                    action: "shipping.set_rate",
                    entity: "SystemSetting",
                    entityId: key,
                    diff: { option, from: before?.value ?? DEFAULT_SHIPPING_RATES[option], to: value },
                },
            })
        })

        await revalidateStorefront({ kind: "all" })
        return value
    }

    static async fulfilmentQueue(limit = 50) {
        await requireCurrentAdmin()

        const [awaiting, inTransit, counts] = await Promise.all([
            prisma.order.findMany({
                where: { status: "awaiting_shipment" },
                orderBy: { createdAt: "asc" },
                take: limit,
                select: {
                    id: true,
                    orderNumber: true,
                    createdAt: true,
                    shippingOption: true,
                    shippingCost: true,
                    total: true,
                    shippingAddress: { select: { fullName: true, city: true, phone: true } },
                },
            }),
            prisma.order.findMany({
                where: { status: "shipped" },
                orderBy: { shippedAt: "asc" },
                take: limit,
                select: {
                    id: true,
                    orderNumber: true,
                    shippedAt: true,
                    trackingNumber: true,
                    shippingAddress: { select: { fullName: true, city: true } },
                },
            }),
            prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
        ])

        return {
            awaiting: awaiting.map((o) => ({
                ...o,
                createdAt: o.createdAt.toISOString(),
                shippingCost: serializeMoney(o.shippingCost),
                total: serializeMoney(o.total),
                waitingDays: Math.floor((Date.now() - o.createdAt.getTime()) / 86_400_000),
            })),
            inTransit: inTransit.map((o) => ({
                ...o,
                shippedAt: o.shippedAt?.toISOString() ?? null,
            })),
            counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>,
        }
    }

    static async destinations(limit = 15, days = 90) {
        await requireCurrentAdmin()
        const since = new Date(Date.now() - days * 86_400_000)
        return prisma.$queryRaw<Array<{ city: string; orders: bigint }>>`
            SELECT a.city, count(*) AS orders
              FROM orders o
              JOIN shipping_addresses a ON a.id = o."shippingAddressId"
             WHERE o.status <> 'cancelled'
               AND o."createdAt" >= ${since}
             GROUP BY a.city
             ORDER BY count(*) DESC
             LIMIT ${limit}`
    }

    static async shippedWithoutTracking() {
        await requireCurrentAdmin()
        return prisma.order.count({
            where: { status: "shipped", OR: [{ trackingNumber: null }, { trackingNumber: "" }] },
        })
    }
}
