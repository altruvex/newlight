import { ChevronLeft, ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

interface PagerProps {
    page: number
    totalPages: number
    /** Builds the href for a page number. Use this or `basePath`. */
    hrefFor?: (page: number) => string
    /** Path to page through; `params` are kept and `page` is added (omitted for page 1). */
    basePath?: string
    params?: Record<string, string | undefined>
    /** Accessible name of the <nav>. */
    label?: string
    className?: string
}

/**
 * Previous / "Page X of Y" / Next for server-paged lists. Renders nothing for a single page.
 * The DOM order is Previous, label, Next; flex flips it in RTL and the chevrons rotate with it.
 */
export async function Pager({ page, totalPages, hrefFor, basePath, params, label, className }: PagerProps) {
    if (totalPages <= 1) return null

    const t = await getTranslations("pager")
    const current = Math.min(Math.max(1, page), totalPages)

    function href(target: number) {
        if (hrefFor) return hrefFor(target)
        const search = new URLSearchParams()
        for (const [key, value] of Object.entries(params ?? {})) {
            if (value) search.set(key, value)
        }
        if (target > 1) search.set("page", String(target))
        const query = search.toString()
        return query ? `${basePath ?? ""}?${query}` : (basePath ?? "")
    }

    return (
        <nav
            className={className ?? "mt-10 flex items-center justify-between gap-4"}
            aria-label={label ?? t("label")}
        >
            {current > 1 ? (
                <Button variant="outline" asChild>
                    <Link href={href(current - 1)} rel="prev">
                        <ChevronLeft aria-hidden className="rtl:rotate-180" />
                        {t("previous")}
                    </Link>
                </Button>
            ) : (
                <Button variant="outline" disabled>
                    <ChevronLeft aria-hidden className="rtl:rotate-180" />
                    {t("previous")}
                </Button>
            )}
            <span className="text-sm tabular-nums text-muted-foreground">
                {t("page", { page: current, total: totalPages })}
            </span>
            {current < totalPages ? (
                <Button variant="outline" asChild>
                    <Link href={href(current + 1)} rel="next">
                        {t("next")}
                        <ChevronRight aria-hidden className="rtl:rotate-180" />
                    </Link>
                </Button>
            ) : (
                <Button variant="outline" disabled>
                    {t("next")}
                    <ChevronRight aria-hidden className="rtl:rotate-180" />
                </Button>
            )}
        </nav>
    )
}
