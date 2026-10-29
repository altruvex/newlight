export type RevalidationTarget =
    | { kind: "product"; slug: string; categorySlug?: string; subCategorySlug?: string }
    | { kind: "category" }
    | { kind: "subCategory" }
    | { kind: "all" }

export async function revalidateStorefront(target: RevalidationTarget): Promise<{ ok: boolean; error?: string }> {
    // On Vercel the admin -> www service binding injects STOREFRONT_URL (internal and
    // deployment-aware, so a preview admin revalidates its own preview storefront).
    // STOREFRONT_REVALIDATION_URL stays as the fallback for running admin with plain `next dev`.
    const url = process.env.STOREFRONT_URL
        ? new URL("api/revalidate", process.env.STOREFRONT_URL)
        : process.env.STOREFRONT_REVALIDATION_URL
    const secret = process.env.STOREFRONT_REVALIDATION_SECRET

    if (!url || !secret) {
        console.warn("[revalidate] STOREFRONT_URL (or STOREFRONT_REVALIDATION_URL) or STOREFRONT_REVALIDATION_SECRET is not set; the storefront will serve stale pages until its own timer expires.")
        return { ok: false, error: "not configured" }
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify(target),
        })
        if (!response.ok) {
            const body = await response.text()
            console.error(`[revalidate] ${response.status}: ${body}`)
            return { ok: false, error: `${response.status}` }
        }
        return { ok: true }
    } catch (error) {
        console.error(`[revalidate] ${error instanceof Error ? error.message : String(error)}`)
        return { ok: false, error: "unreachable" }
    }
}
