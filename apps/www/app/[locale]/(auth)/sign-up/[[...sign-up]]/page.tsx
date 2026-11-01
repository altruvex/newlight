import { Suspense } from "react"
import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { resolveLocale } from "@repo/database"

import { AuthSplit } from "@/components/auth/auth-split"
import { ThemedSignUp } from "@/components/themed-sign-up"
import { constructMetadata } from "@/lib/metadata"
import { createPageCanonicalUrl } from "@/lib/canonical-url"

// No catch-all segments are prebuilt; the bare page renders on its first visit per locale
// and is then served from cache (it reads no request data).
export function generateStaticParams() {
    return []
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    setRequestLocale((await params).locale)
    const t = await getTranslations("auth")
    const locale = resolveLocale(await getLocale())
    return constructMetadata({
        title: t("signUpTitle"),
        description: t("signUpSubtitle"),
        locale,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "sign-up" }),
        // Also blocked in robots.txt; noindex is belt-and-suspenders for a link-only path in.
        noIndex: true,
    })
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("auth")

    return (
        <AuthSplit headline={t("joinUs")} body={t("joinUsBody")} imageClassName="object-[50%_20%]">
            <Suspense
                fallback={
                    <div role="status" aria-live="polite" className="flex items-center justify-center py-16">
                        <span className="text-sm text-muted-foreground">{t("loading")}</span>
                    </div>
                }
            >
                <ThemedSignUp />
            </Suspense>
        </AuthSplit>
    )
}
