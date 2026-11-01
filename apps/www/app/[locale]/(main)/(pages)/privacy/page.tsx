import { constructMetadata } from "@/lib/metadata";
import { createPageCanonicalUrl } from "@/lib/canonical-url"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { PrivacyClient } from "./privacy";
import { SupportedLanguage } from "@/types";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("metadatas.privacy-page");
    const locale = await getLocale() as SupportedLanguage
    return constructMetadata({
        title: t("title"),
        description: t("description"),
        locale: locale as SupportedLanguage,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "privacy" }),
    });
}

export const revalidate = 86400

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return <PrivacyClient />
}