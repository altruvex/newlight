import Link from "next/link"
import { requireCurrentAdmin } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { TaxonomyService } from "@/lib/services/taxonomy-service"
import { ArchiveButtons } from "./archive-buttons"
import { PageBody, PageHeader, PageStack, Panel } from "@/components/page"
import { EmptyState } from "@/components/states"
import { cn } from "@/lib/utils"

export const metadata = { title: "Categories" }

export const dynamic = "force-dynamic"

function nameFor(translations: Array<{ locale: string; name: string; slug: string }>, locale: string) {
    const t = translations.find((x) => x.locale === locale)
    return t ? { name: t.name.trim(), slug: t.slug } : null
}

function Mark({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "danger"; children: React.ReactNode }) {
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-2xs leading-none font-medium",
                tone === "danger" && "border-danger-border bg-danger-bg text-danger",
                tone === "warning" && "border-warning-border bg-warning-bg text-warning",
                tone === "neutral" && "border-neutral-border bg-neutral-bg text-neutral"
            )}
        >
            {children}
        </span>
    )
}

export default async function TaxonomyPage() {
    await requireCurrentAdmin()
    const categories = await TaxonomyService.tree()

    return (
        <>
            <PageHeader
                title="Categories"
                description="A category is its two translation rows — it has no name of its own. Both languages are required, and renaming a URL retires the old one to a redirect rather than breaking it."
                actions={
                    <Button size="sm" asChild>
                        <Link href="/admin/taxonomy/category/new">New category</Link>
                    </Button>
                }
            />

            <PageBody>
                {categories.length === 0 ? (
                    <Panel padded={false}>
                        <EmptyState
                            variant="no-data"
                            title="No categories yet"
                            description="The storefront's navigation is this tree. Nothing appears on the site until a category holds a visible sub-category."
                            action={
                                <Button size="sm" asChild>
                                    <Link href="/admin/taxonomy/category/new">New category</Link>
                                </Button>
                            }
                        />
                    </Panel>
                ) : (
                    <PageStack className="gap-3">
                        {categories.map((category) => {
                            const en = nameFor(category.translations, "en")
                            const ar = nameFor(category.translations, "ar")
                            return (
                                <section key={category.id} className="rounded-lg border bg-card">
                                    <header className="flex flex-wrap items-start justify-between gap-3 border-b p-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h2 className="text-base font-semibold">
                                                    <bdi dir="auto">{en?.name ?? "—"}</bdi>
                                                </h2>
                                                <span className="text-muted-foreground" lang="ar" dir="rtl">
                                                    {ar?.name ?? "—"}
                                                </span>
                                                {category.deletedAt ? (
                                                    <Mark tone="danger">Archived</Mark>
                                                ) : !category.isActive ? (
                                                    <Mark tone="warning">Hidden</Mark>
                                                ) : null}
                                                {(!en || !ar) && <Mark tone="danger">Missing a language</Mark>}
                                            </div>
                                            <p className="mt-0.5 font-mono text-2xs text-muted-foreground">
                                                /{en?.slug ?? "?"} · /{ar?.slug ?? "?"}
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                                                <Link href={`/admin/taxonomy/category/${category.id}`}>Edit</Link>
                                            </Button>
                                            <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                                                <Link href={`/admin/taxonomy/sub-category/new?category=${category.id}`}>
                                                    Add sub-category
                                                </Link>
                                            </Button>
                                            <ArchiveButtons
                                                kind="category"
                                                id={category.id}
                                                archived={category.deletedAt !== null}
                                            />
                                        </div>
                                    </header>

                                    {category.subCategories.length === 0 ? (
                                        <p className="p-3 text-xs text-muted-foreground">
                                            No sub-categories. Products hang from sub-categories, not from categories —
                                            this branch of the storefront menu is empty until one exists.
                                        </p>
                                    ) : (
                                        <ul className="divide-y">
                                            {category.subCategories.map((sub) => {
                                                const subEn = nameFor(sub.translations, "en")
                                                const subAr = nameFor(sub.translations, "ar")
                                                return (
                                                    <li
                                                        key={sub.id}
                                                        className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="font-medium">
                                                                    <bdi dir="auto">{subEn?.name ?? "—"}</bdi>
                                                                </span>
                                                                <span
                                                                    className="text-xs text-muted-foreground"
                                                                    lang="ar"
                                                                    dir="rtl"
                                                                >
                                                                    {subAr?.name ?? "—"}
                                                                </span>
                                                                <Mark>
                                                                    {sub._count.products} product
                                                                    {sub._count.products === 1 ? "" : "s"}
                                                                </Mark>
                                                                {sub.deletedAt ? (
                                                                    <Mark tone="danger">Archived</Mark>
                                                                ) : !sub.isActive ? (
                                                                    <Mark tone="warning">Hidden</Mark>
                                                                ) : null}
                                                                {(!subEn || !subAr) && (
                                                                    <Mark tone="danger">Missing a language</Mark>
                                                                )}
                                                            </div>
                                                            <p className="mt-0.5 font-mono text-2xs text-muted-foreground">
                                                                /{subEn?.slug ?? "?"} · /{subAr?.slug ?? "?"}
                                                            </p>
                                                        </div>

                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                asChild
                                                                className="h-7 text-xs"
                                                            >
                                                                <Link href={`/admin/taxonomy/sub-category/${sub.id}`}>
                                                                    Edit
                                                                </Link>
                                                            </Button>
                                                            <ArchiveButtons
                                                                kind="subCategory"
                                                                id={sub.id}
                                                                archived={sub.deletedAt !== null}
                                                            />
                                                        </div>
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </section>
                            )
                        })}
                    </PageStack>
                )}
            </PageBody>
        </>
    )
}
