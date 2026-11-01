"use server"

import { currentUserId } from "@/lib/auth"
import {
    multiplyMoney,
    prisma,
    resolveEffectivePrice,
    serializeMoney,
    type MoneyInput,
} from "@repo/database"
import { activeDiscounts } from "@/lib/discounts"
import { logger } from "@/lib/logger"
import {
    accessibleConfigurationWhere,
    claimConfiguration,
    findAccessibleConfiguration,
} from "@/lib/services/configuration-access"
import { updateConfigurationQuantitySchema } from "@/lib/validation/schema"
import { revalidatePath } from "next/cache"

interface SaveConfigurationArgs {
    productId: string
    quantity: number
    selectedColorTemp?: string
    selectedColorKey?: string
    configId?: string
}

async function safeRevalidatePath(path: string): Promise<boolean> {
    try {
        revalidatePath(path)
        return true
    } catch (error) {
        logger.warn({ err: error, path }, "failed to revalidate path")
        return false
    }
}

export async function saveConfiguration(args: SaveConfigurationArgs) {
    try {
        const userId = await currentUserId()

        const product = await prisma.product.findFirst({
            where: { productId: args.productId, isActive: true, deletedAt: null },
            select: { id: true, productId: true, price: true, familyId: true, subCategoryId: true },
        })

        if (!product) {
            return {
                success: false,
                error: "Product not found",
            }
        }

        const unitPrice = resolveEffectivePrice(product.price, product, await activeDiscounts()).effective
        const lineTotal = multiplyMoney(unitPrice, args.quantity)

        if (userId) {

            if (args.configId) {
                const existingConfig = await prisma.productConfiguration.findFirst({
                    where: {
                        id: args.configId,
                        users: {
                            some: { id: userId },
                        },
                    },
                })

                if (existingConfig) {
                    const updatedConfig = await prisma.productConfiguration.update({
                        where: { id: args.configId },
                        data: {
                            quantity: args.quantity,
                            totalPrice: lineTotal,
                            selectedColorTemp: args.selectedColorTemp,
                            selectedColorKey: args.selectedColorKey,
                        },
                    })

                    const revalidated = await safeRevalidatePath(`/preview/${args.configId}`)

                    return {
                        success: true,
                        configId: updatedConfig.id,
                        productId: args.productId,
                        cacheCleared: revalidated,
                    }
                }
            }

            const configuration = await prisma.productConfiguration.create({
                data: {
                    productId: product.id,
                    productSku: product.productId,
                    configPrice: unitPrice,
                    quantity: args.quantity,
                    totalPrice: lineTotal,
                    currency: "EGP",
                    selectedColorTemp: args.selectedColorTemp,
                    selectedColorKey: args.selectedColorKey,
                    users: {
                        connect: { id: userId },
                    },
                },
            })

            const revalidated = await safeRevalidatePath(`/preview/${configuration.id}`)

            return {
                success: true,
                configId: configuration.id,
                productId: args.productId,
                cacheCleared: revalidated,
            }
        }

        const configuration = await prisma.productConfiguration.create({
            data: {
                productId: product.id,
                productSku: product.productId,
                configPrice: unitPrice,
                quantity: args.quantity,
                totalPrice: lineTotal,
                currency: "EGP",
                selectedColorTemp: args.selectedColorTemp,
                selectedColorKey: args.selectedColorKey,
            },
        })

        const revalidated = await safeRevalidatePath(`/preview/${configuration.id}`)

        return {
            success: true,
            configId: configuration.id,
            productId: args.productId,
            cacheCleared: revalidated,
        }

    } catch (error) {
        logger.error({ err: error, productId: args.productId }, "failed to save configuration")

        return {
            success: false,
            error: "Failed to save configuration",
        }
    }
}

async function repriceConfiguration<
    T extends { id: string; productId: string; quantity: number; configPrice: MoneyInput },
>(
    configuration: T
): Promise<T> {
    const product = await prisma.product.findUnique({
        where: { id: configuration.productId },
        select: { id: true, price: true, familyId: true, subCategoryId: true },
    })
    if (!product) return configuration

    const unitPrice = resolveEffectivePrice(product.price, product, await activeDiscounts()).effective
    if (unitPrice === serializeMoney(configuration.configPrice)) return configuration

    const updated = await prisma.productConfiguration.update({
        where: { id: configuration.id },
        data: { configPrice: unitPrice, totalPrice: multiplyMoney(unitPrice, configuration.quantity) },
    })

    return { ...configuration, ...updated }
}

export async function getConfiguration(configId: string) {
    try {
        const configuration = await findAccessibleConfiguration(configId, await currentUserId())
        if (!configuration) return null
        return await repriceConfiguration(configuration)
    } catch (error) {
        logger.error({ err: error, configId }, "failed to load configuration")
        return null
    }
}

export async function updateConfigurationQuantity(input: { configId: string; quantity: number }) {
    const parsed = updateConfigurationQuantitySchema.safeParse(input)
    if (!parsed.success) {
        return { success: false, error: "Invalid quantity" }
    }
    const { configId, quantity } = parsed.data

    try {
        const userId = await currentUserId()
        const config = await findAccessibleConfiguration(configId, userId)
        if (!config) {
            return { success: false, error: "Configuration not found" }
        }

        const updatedConfig = await prisma.productConfiguration.update({
            // Re-checked in the write so an owner claiming it between the read and here still wins.
            where: accessibleConfigurationWhere(configId, userId),
            data: { quantity, totalPrice: multiplyMoney(config.configPrice, quantity) },
        })

        const revalidated = await safeRevalidatePath(`/preview/${configId}`)

        return { success: true, configuration: updatedConfig, cacheCleared: revalidated }
    } catch (error) {
        logger.error({ err: error, configId }, "failed to update configuration quantity")
        return { success: false, error: "Failed to update configuration quantity" }
    }
}

/** Claims an unowned configuration for the signed-in user. The owner is always the session. */
export async function associateConfigurationWithUser(configId: string) {
    try {
        const userId = await currentUserId()
        if (!userId) {
            return { success: false, error: "Authentication required" }
        }

        const configuration = await claimConfiguration(configId, userId)
        if (!configuration) {
            return { success: false, error: "Configuration not found" }
        }

        return { success: true, message: "Configuration associated with user" }
    } catch (error) {
        logger.error({ err: error, configId }, "failed to associate configuration with user")
        return { success: false, error: "Failed to associate configuration with user" }
    }
}
