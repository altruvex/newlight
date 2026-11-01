/* eslint-disable @typescript-eslint/no-explicit-any */

import {
    addMoney,
    DEFAULT_LOCATION_ID,
    encodeSlug,
    getShippingRates,
    InsufficientStockError,
    Prisma,
    prisma,
    multiplyMoney,
    reserve,
    resolveEffectivePrice,
    resolveLocale,
    serializeMoney,
    type ShippingOption,
} from "@repo/database"
import type { Locale } from "@repo/database"
import { activeDiscounts } from "@/lib/discounts"
import { dispatchDeliveriesAfterResponse } from "@/lib/deliveries"
import { logger } from "@/lib/logger"
import { OrderError, type OrderErrorCode } from "@/lib/services/order-errors"
import { isUniqueViolationOn, withSerializableRetry } from "@/lib/services/transaction-retry"
import { queueMail } from "@repo/mail/outbox"
import { adminRecipients, notifyRecipients } from "@repo/notifications"

export type CreateOrderResult =
    | {
        success: true
        orderId: string
        orderNumber: string
        isDuplicate: boolean
    }
    | {
        success: false
        code: OrderErrorCode
    }

const CREATE_ORDER_ATTEMPTS = 3

export class OrderService {
    static async createOrder(params: {
        userId: string
        configurationId: string
        shippingAddressId: string
        shippingOption: ShippingOption
        idempotencyKey: string
    }): Promise<CreateOrderResult> {
        const { userId, configurationId, shippingOption, idempotencyKey } = params

        try {
            const existingOrder = await this.findOrderByIdempotencyKey(userId, idempotencyKey)
            if (existingOrder) {
                return {
                    success: true,
                    orderId: existingOrder.id,
                    orderNumber: existingOrder.orderNumber,
                    isDuplicate: true,
                }
            }

            const recipients = await adminRecipients(prisma)

            const result = await withSerializableRetry(
                () =>
                    prisma.$transaction(
                        (tx) => this.createOrderInTransaction(tx, { ...params, recipients }),
                        {
                            maxWait: 15000,
                            timeout: 30000,
                            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                        }
                    ),
                {
                    attempts: CREATE_ORDER_ATTEMPTS,
                    onRetry: (attempt, error) =>
                        logger.warn({ err: error, attempt, configurationId }, "order transaction serialization conflict; retrying"),
                }
            )

            dispatchDeliveriesAfterResponse("order-created")

            return result
        } catch (error) {
            if (isUniqueViolationOn(error, "idempotencyKey")) {
                // A concurrent attempt with the same key won the race: that order is this one.
                const existingOrder = await this.findOrderByIdempotencyKey(userId, idempotencyKey)
                if (existingOrder) {
                    return {
                        success: true,
                        orderId: existingOrder.id,
                        orderNumber: existingOrder.orderNumber,
                        isDuplicate: true,
                    }
                }
            }

            if (error instanceof OrderError) {
                logger.warn({ code: error.code, configurationId, shippingOption }, "order creation refused")
                return { success: false, code: error.code }
            }
            if (error instanceof InsufficientStockError) {
                logger.warn({ configurationId, requested: error.requested, available: error.available }, "order creation refused: out of stock")
                return { success: false, code: "OUT_OF_STOCK" }
            }

            logger.error({ err: error, configurationId, shippingOption }, "order creation failed")
            return { success: false, code: "FAILED" }
        }
    }

    private static async createOrderInTransaction(
        tx: Prisma.TransactionClient,
        params: {
            userId: string
            configurationId: string
            shippingAddressId: string
            shippingOption: ShippingOption
            idempotencyKey: string
            recipients: readonly string[]
        }
    ) {
        const { userId, configurationId, shippingAddressId, shippingOption, idempotencyKey, recipients } = params

        const config = await tx.productConfiguration.findUnique({
            where: { id: configurationId },
        })

        if (!config) {
            throw new OrderError("CONFIG_NOT_FOUND")
        }

        const product = await tx.product.findUnique({
            where: { id: config.productId },
            include: {
                translations: { where: { locale: resolveLocale(undefined) }, take: 1 },
                images: { orderBy: { order: "asc" }, take: 1 },
            },
        })

        if (!product) {
            throw new OrderError("PRODUCT_NOT_FOUND")
        }

        const level = await tx.stockLevel.findUnique({
            where: { productId_locationId: { productId: product.id, locationId: DEFAULT_LOCATION_ID } },
            select: { onHand: true, reserved: true },
        })
        if (Math.max(0, (level?.onHand ?? 0) - (level?.reserved ?? 0)) < config.quantity) {
            throw new OrderError("OUT_OF_STOCK")
        }

        const shippingRates = await getShippingRates(tx)
        const shippingCost = shippingRates[shippingOption]

        const unitPrice = resolveEffectivePrice(
            product.price,
            product,
            await activeDiscounts()
        ).effective
        const subtotal = multiplyMoney(unitPrice, config.quantity)
        const total = addMoney(subtotal, shippingCost)

        const orderNumber = await this.generateOrderNumber(tx)

        const order = await tx.order.create({
            data: {
                userId,
                orderNumber,
                subtotal,
                shippingCost,
                total,
                idempotencyKey,
                status: "awaiting_shipment",
                shippingOption,
                shippingAddressId,
                configurationId,
                customerNotes: `idempotency:${idempotencyKey}`,
                items: {
                    create: {
                        productId: product.id,
                        productName: product.translations[0]?.name || product.productId,
                        productImage: product.images[0]?.url ?? "",
                        price: unitPrice,
                        quantity: config.quantity,
                        selectedColorTemp: config.selectedColorTemp as any,
                        selectedColorKey: config.selectedColorKey,
                        configurationId,
                    },
                },
            },
        })

        await reserve(tx, product.id, config.quantity)

        const [customer, address] = await Promise.all([
            tx.user.findUnique({
                where: { id: userId },
                select: { email: true, name: true, preferredLanguage: true },
            }),
            shippingAddressId
                ? tx.shippingAddress.findUnique({ where: { id: shippingAddressId } })
                : Promise.resolve(null),
        ])

        if (customer?.email && address) {
            const locale = resolveLocale(customer.preferredLanguage)

            const details = await describeOrderedProduct(tx, {
                productId: product.id,
                locale,
                selectedColorTemp: config.selectedColorTemp,
                selectedColorKey: config.selectedColorKey,
                fallbackName: product.translations[0]?.name || product.productId,
                fallbackSku: product.productId,
            })

            await queueMail(tx, {
                template: "order-confirmation",
                to: customer.email,
                locale,
                payload: {
                    orderNumber: order.orderNumber,
                    items: [
                        {
                            name: details.name,
                            quantity: config.quantity,
                            price: serializeMoney(unitPrice),
                            lineTotal: serializeMoney(subtotal),
                            sku: details.sku,
                            imageUrl: details.imageUrl,
                            productUrl: details.productUrl,
                            attributes: details.attributes,
                        },
                    ],
                    subtotal: serializeMoney(subtotal),
                    shippingCost: serializeMoney(shippingCost),
                    total: serializeMoney(total),
                    currency: config.currency ?? "EGP",
                    address: {
                        fullName: address.fullName,
                        phone: address.phone,
                        addressLine1: address.addressLine1,
                        addressLine2: address.addressLine2 ?? undefined,
                        city: address.city,
                        country: address.country,
                    },
                    orderUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${locale}/orders/${order.id}`,
                },
                dedupeKey: `order-confirmation:${order.id}`,
            })
        } else {
            logger.warn({ orderNumber: order.orderNumber }, "no confirmation queued: missing customer email or address")
        }

        await notifyRecipients(tx, recipients, {
            type: "NEW_ORDER",
            title: `New order ${order.orderNumber}`,
            message: `${serializeMoney(total)} ${config.currency ?? "EGP"} · ${config.quantity} × ${product.translations[0]?.name || product.productId}`,
            actionUrl: `/admin/orders/${order.id}`,
            priority: "HIGH",
            metadata: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                total: serializeMoney(total),
                currency: config.currency ?? "EGP",
                productId: product.id,
            },
        })

        return {
            success: true as const,
            orderId: order.id,
            orderNumber: order.orderNumber,
            isDuplicate: false,
        }
    }

    private static async findOrderByIdempotencyKey(userId: string, idempotencyKey: string) {
        return await prisma.order.findFirst({
            where: { idempotencyKey, userId },
            select: { id: true, orderNumber: true, userId: true },
        })
    }

    private static async generateOrderNumber(
        tx: Prisma.TransactionClient,
        maxRetries = 3
    ): Promise<string> {
        for (let i = 0; i < maxRetries; i++) {
            const orderNumber = `ORD-${Date.now()}-${Math.random()
                .toString(36)
                .substr(2, 9)
                .toUpperCase()}`

            const exists = await tx.order.findUnique({
                where: { orderNumber },
                select: { id: true },
            })

            if (!exists) return orderNumber
        }

        throw new Error("Failed to generate unique order number")
    }

}

async function describeOrderedProduct(
    tx: Prisma.TransactionClient,
    input: {
        productId: string
        locale: Locale
        selectedColorTemp: string | null
        selectedColorKey: string | null
        fallbackName: string
        fallbackSku: string
    }
): Promise<{
    name: string
    sku: string
    imageUrl?: string
    productUrl?: string
    attributes: Array<{ label: string; value: string }>
}> {
    const product = await tx.product.findUnique({
        where: { id: input.productId },
        select: {
            productId: true,
            slug: true,
            translations: { where: { locale: input.locale }, take: 1, select: { name: true } },
            images: { orderBy: { order: "asc" }, select: { url: true, colorId: true } },
            specs: {
                select: {
                    valueNumber: true,
                    valueEn: true,
                    valueAr: true,
                    valueBool: true,
                    spec: { select: { labelEn: true, labelAr: true, unitEn: true, unitAr: true, order: true } },
                },
            },
            availableColors: {
                select: { color: { select: { id: true, key: true, nameEn: true, nameAr: true } } },
            },
            subCategory: {
                select: {
                    translations: { where: { locale: input.locale }, take: 1, select: { slug: true } },
                    category: {
                        select: { translations: { where: { locale: input.locale }, take: 1, select: { slug: true } } },
                    },
                },
            },
        },
    })

    if (!product) return { name: input.fallbackName, sku: input.fallbackSku, attributes: [] }

    const arabic = input.locale === "ar"
    const attributes: Array<{ label: string; value: string }> = []

    if (input.selectedColorTemp) {
        const copy = COLOR_TEMP_COPY[input.selectedColorTemp]
        attributes.push({
            label: arabic ? "درجة حرارة اللون" : "Colour temperature",
            value: copy ? (arabic ? copy.ar : copy.en) : input.selectedColorTemp,
        })
    }

    const color = product.availableColors.find((row) => row.color.key === input.selectedColorKey)?.color
    if (color) {
        attributes.push({ label: arabic ? "اللون" : "Colour", value: arabic ? color.nameAr : color.nameEn })
    }

    for (const spec of [...product.specs].sort((a, b) => a.spec.order - b.spec.order)) {
        const value = formatSpecValue(spec, arabic)
        if (value) attributes.push({ label: arabic ? spec.spec.labelAr : spec.spec.labelEn, value })
    }

    const image = (color ? product.images.find((row) => row.colorId === color.id) : undefined) ?? product.images[0]

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? ""
    const categorySlug = product.subCategory.category.translations[0]?.slug
    const subCategorySlug = product.subCategory.translations[0]?.slug

    return {
        name: product.translations[0]?.name || input.fallbackName || product.productId,
        sku: product.productId,
        imageUrl: origin && image?.url ? absolute(origin, image.url) : undefined,
        productUrl:
            origin && categorySlug && subCategorySlug
                ? `${origin}/${input.locale}/category/${encodeSlug(categorySlug)}/${encodeSlug(subCategorySlug)}/${encodeSlug(product.slug)}`
                : undefined,
        attributes,
    }
}

function absolute(origin: string, url: string): string {
    return /^https?:\/\//i.test(url) ? url : `${origin}${url.startsWith("/") ? "" : "/"}${url}`
}

const COLOR_TEMP_COPY: Record<string, { en: string; ar: string }> = {
    WARM_3000K: { en: "Warm white (3000K)", ar: "أبيض دافئ (3000 كلفن)" },
    COOL_4000K: { en: "Cool white (4000K)", ar: "أبيض محايد (4000 كلفن)" },
    WHITE_6500K: { en: "Daylight (6500K)", ar: "أبيض نهاري (6500 كلفن)" },
}

function formatSpecValue(
    spec: {
        valueNumber: Prisma.Decimal | null
        valueEn: string | null
        valueAr: string | null
        valueBool: boolean | null
        spec: { unitEn: string | null; unitAr: string | null }
    },
    arabic: boolean
): string | null {
    if (spec.valueBool !== null) return arabic ? (spec.valueBool ? "نعم" : "لا") : spec.valueBool ? "Yes" : "No"

    if (spec.valueNumber !== null) {
        const unit = arabic ? spec.spec.unitAr : spec.spec.unitEn
        return unit ? `${spec.valueNumber.toString()} ${unit}` : spec.valueNumber.toString()
    }

    const text = arabic ? (spec.valueAr ?? spec.valueEn) : (spec.valueEn ?? spec.valueAr)
    return text && text.trim().length > 0 ? text : null
}
