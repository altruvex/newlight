import { resolveLocale } from "@repo/database"
import { SearchService } from "@/lib/services/search-service"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
    try {
        const { locale } = await params
        const searchParams = request.nextUrl.searchParams
        const query = searchParams.get("q") || ""
        const requested = Number.parseInt(searchParams.get("limit") ?? "", 10)
        const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 1), 24)

        if (query.trim().length < 2) {
            return NextResponse.json({ products: [], categories: [], subCategories: [] })
        }

        const results = await SearchService.searchContent(query, resolveLocale(locale), limit)
        return NextResponse.json(results)
    } catch (error) {
        console.error("Search error:", error)
        return NextResponse.json({ error: "Failed to perform search" }, { status: 500 })
    }
}
