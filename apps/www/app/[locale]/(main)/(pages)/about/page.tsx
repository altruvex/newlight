import { constructMetadata } from "@/lib/metadata";
import { createPageCanonicalUrl } from "@/lib/canonical-url"
import { SupportedLanguage } from "@/types";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { AboutUsClient } from "./about";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("metadatas.about-us-page");

    const locale = await getLocale() as SupportedLanguage
    return constructMetadata({
        title: t("title"),
        description: t("description"),
        locale: locale as SupportedLanguage,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "about" }),
    });
}

export default async function AboutUsPage({
    params,
}: {
    params: Promise<{ locale: string }>
}) {
    const { locale } = await params
    setRequestLocale(locale)

    return <AboutUsClient />
}
