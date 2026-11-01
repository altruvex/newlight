import { encodeSlug, resolveLocale } from "@repo/database"
import { Container } from "@/components/layout/section";
import { Link } from "@/i18n/navigation";
import { cachedFooterSubCategories } from "@/lib/services/category-service";
import { convertToArabicNumerals } from "@/lib/utils";
import { getLocale, getTranslations } from "next-intl/server";
import { FaFacebook, FaInstagram } from "react-icons/fa";

export async function Footer() {
    const t = await getTranslations("footer");
    const locale = await getLocale();

    const subCategories = await cachedFooterSubCategories(resolveLocale(locale));

    const columns = subCategories.reduce<Map<string, { name: string; slug: string; items: typeof subCategories }>>(
        (groups, subCategory) => {
            const group = groups.get(subCategory.categorySlug) ?? {
                name: subCategory.categoryName,
                slug: subCategory.categorySlug,
                items: [],
            };
            group.items.push(subCategory);
            groups.set(subCategory.categorySlug, group);
            return groups;
        },
        new Map()
    );

    const currentYear = new Date().getFullYear();
    const localizedYear =
        locale === "ar" ? convertToArabicNumerals(currentYear) : currentYear;

    const socialLinks = {
        facebook: "https://www.facebook.com/share/17vq5UgeWM/",
        instagram: "https://www.instagram.com/newl_ight0/"
    };

    return (
        <footer className="border-t bg-surface-sunk">
            <Container>
                <div className="py-12">
                    <div className="grid grid-cols-2 gap-10 md:grid-cols-3 lg:grid-cols-[1.2fr_repeat(auto-fit,minmax(9rem,1fr))]">
                        <div className="flex flex-col items-center md:items-start space-y-4">
                            <div className="flex items-baseline gap-1">
                                <span className="text-xl font-extrabold tracking-tight uppercase">
                                    {t("logo.part1")}
                                </span>
                                <span className="text-xl font-light tracking-wordmark uppercase">
                                    {t("logo.part2")}
                                </span>
                            </div>
                        </div>
                        {[...columns.values()].map((column) => (
                            <div key={column.slug}>
                                <h2 className="mb-4 text-xs font-medium tracking-label uppercase">
                                    {column.name}
                                </h2>
                                <ul className="space-y-3 text-sm text-muted-foreground">
                                    {column.items.length > 0 ? (
                                        column.items.map((subCategory) => (
                                            <li key={subCategory.id}>
                                                <Link
                                                    href={`/category/${encodeSlug(column.slug)}/${encodeSlug(subCategory.slug)}`}
                                                    className="hover:text-foreground transition-colors"
                                                >
                                                    {subCategory.name}
                                                </Link>
                                            </li>
                                        ))
                                    ) : (
                                        null
                                    )}
                                </ul>
                            </div>
                        ))}
                        <div>
                            <h2 className="mb-4 text-xs font-medium tracking-label uppercase">
                                {t("sections.company.title")}
                            </h2>
                            <ul className="space-y-3 text-sm text-muted-foreground">
                                <li>
                                    <Link
                                        href="/about"
                                        className="hover:text-foreground transition-colors"
                                    >
                                        {t("sections.company.about")}
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/contact"
                                        className="hover:text-foreground transition-colors"
                                    >
                                        {t("sections.company.contact")}
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/technical-resources"
                                        className="transition-colors hover:text-foreground"
                                    >
                                        {t("sections.resources.technical")}
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/privacy"
                                        className="transition-colors hover:text-foreground"
                                    >
                                        {t("sections.company.privacy")}
                                    </Link>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h2 className="mb-4 text-xs font-medium tracking-label uppercase">
                                {t("sections.account.title")}
                            </h2>
                            <ul className="space-y-3 text-sm text-muted-foreground">
                                <li>
                                    <Link href="/account" className="transition-colors hover:text-foreground">
                                        {t("sections.account.account")}
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/cart" className="transition-colors hover:text-foreground">
                                        {t("sections.account.cart")}
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/orders" className="transition-colors hover:text-foreground">
                                        {t("sections.account.orders")}
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/offers" className="transition-colors hover:text-foreground">
                                        {t("sections.account.offers")}
                                    </Link>
                                </li>
                            </ul>
                        </div>
                        <div className="flex items-start flex-col ">
                            <div>
                                <h2 className="mb-4 text-xs font-medium tracking-label uppercase">
                                    {t("social-header")}
                                </h2>
                            </div>
                            <div className="flex gap-4 pt-2">
                                <Link
                                    href={socialLinks.facebook}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="grid size-10 place-items-center rounded-md border transition-colors duration-(--duration-fast) hover:bg-accent"
                                    aria-label="Facebook"
                                >
                                    <FaFacebook aria-hidden className="size-5" />
                                </Link>
                                <Link
                                    href={socialLinks.instagram}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="grid size-10 place-items-center rounded-md border transition-colors duration-(--duration-fast) hover:bg-accent"
                                    aria-label="Instagram"
                                >
                                    <FaInstagram aria-hidden className="size-5" />
                                </Link>
                            </div>
                        </div>
                    </div>
                    <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
                        &copy; {localizedYear} {t("copyright")}
                    </div>
                </div>
            </Container>
        </footer>
    );
}