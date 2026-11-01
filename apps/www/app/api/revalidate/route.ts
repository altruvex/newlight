import { NextResponse, type NextRequest } from "next/server"
import { revalidatePath, revalidateTag } from "next/cache"

export const dynamic = "force-dynamic"

type Target =
    | { kind: "product"; slug: string; categorySlug?: string; subCategorySlug?: string }
    | { kind: "category" }
    | { kind: "subCategory" }
    | { kind: "all" }

export async function POST(request: NextRequest) {
    const secret = process.env.STOREFRONT_REVALIDATION_SECRET
    if (!secret) {
        console.error("[revalidate] STOREFRONT_REVALIDATION_SECRET is not set; refusing to run unauthenticated.")
        return NextResponse.json({ error: "not configured" }, { status: 503 })
    }

    const header = request.headers.get("authorization")
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : null
    if (provided !== secret) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    let target: Target
    try {
        target = (await request.json()) as Target
    } catch {
        return NextResponse.json({ error: "invalid body" }, { status: 400 })
    }

    // Next 16 tags each cached page with its route *pattern* (`/[locale]/(main)/layout`), not
    // with the concrete URL plus "layout", so `revalidatePath("/en", "layout")` matched nothing
    // and `revalidateTag` hit tags no fetch in this app sets. Purging by pattern is what reaches
    // the ISR cache. A product or taxonomy edit purges every storefront page, not one URL: the
    // offers bar, the footer's subcategory list, the home strips and related products all show
    // names and prices on pages other than the product's own.
    const revalidated: string[] = []
    const purge = (pattern: string) => {
        revalidatePath(pattern, "layout")
        revalidated.push(`${pattern} (layout)`)
    }

    switch (target.kind) {
        case "product":
        case "category":
        case "subCategory":
            purge("/[locale]/(main)")
            break
        case "all":
            purge("/[locale]")
            break
        default:
            return NextResponse.json({ error: "unknown target kind" }, { status: 400 })
    }

    revalidatePath("/sitemap.xml")
    revalidated.push("/sitemap.xml")

    // Shared reads cached with unstable_cache (offers bar, footer sections) outlive the page
    // purge above; they carry this tag instead. Expired outright, not "max": under
    // stale-while-revalidate the pages purged above would regenerate around the stale copy and
    // keep it for another ISR window.
    revalidateTag("catalog", { expire: 0 })
    revalidated.push("tag:catalog")

    return NextResponse.json({ revalidated, at: new Date().toISOString() })
}
