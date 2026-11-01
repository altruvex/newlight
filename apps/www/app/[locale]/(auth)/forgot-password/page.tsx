import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import { resolveLocale } from "@repo/database"

import { AuthCentered } from "@/components/auth/auth-split"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { constructMetadata } from "@/lib/metadata"
import { createPageCanonicalUrl } from "@/lib/canonical-url"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    setRequestLocale((await params).locale)
    const t = await getTranslations("auth")
    const locale = resolveLocale(await getLocale())
    return constructMetadata({
        title: t("forgotTitle"),
        description: t("forgotSubtitle"),
        locale,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "forgot-password" }),
        // A utility step in the sign-in flow, not content — unlike the other auth pages it
        // isn't in robots.txt, so the noindex tag here is the only thing keeping it out.
        noIndex: true,
    })
}

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return (
        <AuthCentered>
            <ForgotPasswordForm />
        </AuthCentered>
    )
}
