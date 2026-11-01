import type { AbstractIntlMessages } from "next-intl"

/**
 * Top-level message namespaces that client components read.
 *
 * `NextIntlClientProvider` serialises whatever it is given into the HTML/RSC payload of every
 * page. Server components resolve their messages on the server (via `i18n/request.ts`) and
 * never touch the provider, so only namespaces read by `"use client"` code (or by modules a
 * client file imports) belong here.
 *
 * `test/client-namespaces.test.ts` scans the app and fails when a client file uses a
 * namespace missing from this list (or one that does not exist in en.json / ar.json).
 * Add a namespace here when that test says so; do not add server-only ones.
 */
export const CLIENT_NAMESPACES = [
    "CategoryCard",
    "account",
    "auth",
    "auth-section",
    "bulkOrder",
    "cart",
    "cart-page",
    "compare",
    "confirm",
    "contact",
    "error-page",
    "language-selector",
    "merchandising",
    "nav",
    "offers",
    "plp",
    "product-card",
    "product-page",
    "search",
    "section-type-page",
    "shipping",
    "stock",
    "technical-resources",
] as const

export function pickMessages(
    messages: AbstractIntlMessages,
    namespaces: readonly string[] = CLIENT_NAMESPACES,
): AbstractIntlMessages {
    const picked: AbstractIntlMessages = {}
    for (const ns of namespaces) {
        if (ns in messages) picked[ns] = messages[ns]
    }
    return picked
}
