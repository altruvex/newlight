import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { resolveLocale } from "@repo/database"

import { Footer } from "@/components/navigation/footer"
import { Nav } from "@/components/navigation/nav"
import { OffersBar } from "@/components/offers-bar"
import { cachedOffersHighlight } from "@/lib/services/offers-service"
import { JsonLd, organisationSchema, webSiteSchema } from "@/lib/structured-data"

// The offers bar and the footer's section list are read from the database on every page
// below, so no page here may be cached longer than this. Admin edits purge sooner through
// /api/revalidate, and an offer starting or ending shortens it (see cachedOffersHighlight).
export const revalidate = 900

export default async function MainLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: Promise<{ locale: string }>
}) {
    setRequestLocale((await params).locale)
    const [t, offers, locale] = await Promise.all([
        getTranslations("Common"),
        cachedOffersHighlight(),
        getLocale().then(resolveLocale),
    ])

    return (
        <div style={offers ? { "--announcement-height": "36px" } as React.CSSProperties : undefined}>
            <JsonLd data={[organisationSchema(locale), webSiteSchema(locale)]} />

            <a
                href="#content"
                className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
            >
                {t("skipToContent")}
            </a>

            {offers && <OffersBar {...offers} />}

            <Nav hasOffers={Boolean(offers)} />
            <main
                id="content"
                role="main"
                className="pt-[calc(var(--header-height)+var(--announcement-height))]"
            >
                {children}
            </main>
            <Footer />
        </div>
    )
}
