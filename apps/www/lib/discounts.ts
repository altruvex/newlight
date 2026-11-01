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
