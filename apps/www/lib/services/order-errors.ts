// Stable codes the order actions return instead of error text. The customer-facing message
// for each lives under `confirm.errors.<code>` in messages/en.json and messages/ar.json; the
// raw cause is logged server-side and never crosses to the client.
export const ORDER_ERROR_CODES = [
    "UNAUTHENTICATED",
    "INVALID_INPUT",
    "CONFIG_NOT_FOUND",
    "PRODUCT_NOT_FOUND",
    "OUT_OF_STOCK",
    "SHIPPING_ADDRESS_REQUIRED",
    "ORDER_NOT_FOUND",
    "ORDER_NOT_CANCELLABLE",
    "FAILED",
] as const

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number]

export function isOrderErrorCode(value: unknown): value is OrderErrorCode {
    return typeof value === "string" && (ORDER_ERROR_CODES as readonly string[]).includes(value)
}

export class OrderError extends Error {
    constructor(readonly code: OrderErrorCode, detail?: string) {
        super(detail ?? code)
        this.name = "OrderError"
    }
}
