import TechnicalResources from "@/components/technical-resources";
import { constructMetadata } from "@/lib/metadata";
import { createPageCanonicalUrl } from "@/lib/canonical-url"
import { SupportedLanguage } from "@/types";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("metadatas.technical-resources");
    const locale = await getLocale() as SupportedLanguage
    return constructMetadata({
        title: t("title"),
        description: t("description"),
        locale: locale as SupportedLanguage,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "technical-resources" }),
    });
}

export default async function TechnicalPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    return <TechnicalResources />
}