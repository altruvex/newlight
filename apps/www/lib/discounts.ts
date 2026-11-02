import { cache } from "react"
import { loadActiveDiscounts, prisma, type ActiveDiscount } from "@repo/database"
import { logger } from "@/lib/logger"

export const activeDiscounts = cache(async (): Promise<ActiveDiscount[]> => {
    try {
        return await loadActiveDiscounts(prisma, new Date())
    } catch (error) {
        logger.error({ err: error }, "discounts unavailable; falling back to base prices")
        return []
    }
})

/**
 * The next moment a discount starts or ends, or null when none is scheduled. No admin action
 * happens at that moment, so nothing purges the cache then; cached pages use this to expire
 * on time instead (see `cachedOffersHighlight`). A failed read returns null, which leaves the
 * normal cache timer in charge.
 */
export const nextDiscountBoundary = cache(async (): Promise<Date | null> => {
    const now = new Date()
    try {
        const [starting, ending] = await Promise.all([
            prisma.discount.findFirst({
                where: { isActive: true, startsAt: { gt: now } },
                orderBy: { startsAt: "asc" },
                select: { startsAt: true },
            }),
            prisma.discount.findFirst({
                where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
                orderBy: { endsAt: "asc" },
                select: { endsAt: true },
            }),
        ])
        const times = [starting?.startsAt, ending?.endsAt].filter((date): date is Date => date instanceof Date)
        if (times.length === 0) return null
        return new Date(Math.min(...times.map((date) => date.getTime())))
    } catch (error) {
        logger.error({ err: error }, "next discount boundary unavailable")
        return null
    }
})
