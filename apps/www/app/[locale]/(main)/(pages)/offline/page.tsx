import { constructMetadata } from "@/lib/metadata";
import { createPageCanonicalUrl } from "@/lib/canonical-url";
import { SupportedLanguage } from "@/types";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("metadatas.offline");

    const locale = await getLocale() as SupportedLanguage
    return constructMetadata({
        title: t("title"),
        description: t("description"),
        locale: locale as SupportedLanguage,
        canonicalUrl: createPageCanonicalUrl({ locale, path: "offline" }),
        // A PWA fallback shell, not content — never worth a place in the index.
        noIndex: true,
    });
}

export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations("offline");
    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="text-center">
                <h1 className="text-4xl font-bold">{t("title")}</h1>
                <p className="mt-4 text-muted-foreground">
                    {t("description")}
                </p>
            </div>
        </div>
    );
}