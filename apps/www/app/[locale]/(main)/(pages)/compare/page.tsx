import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { resolveLocale } from "@repo/database"

import { CompareTable } from "@/components/compare/compare-table"
import { Container, PageHeader } from "@/components/layout/section"
import { constructMetadata } from "@/lib/metadata"
import { createPageCanonicalUrl } from "@/lib/canonical-url"

export const dynamic = "force-static"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    setRequestLocale((await params).locale)
    const t = await getTranslations("compare")
    const locale = resolveLocale(await getLocale())
    return constructMetadata({
        title: t("metaTitle"),
        description: t("metaDescription"),
        locale,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "compare" }),
        // Built from whatever is in the visitor's own localStorage — there is no shared
        // content here for a search result to point at.
        noIndex: true,
    })
}

export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("compare")

    return (
        <>
            <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
            <Container className="py-10 lg:py-14">
                <CompareTable />
            </Container>
        </>
    )
}
