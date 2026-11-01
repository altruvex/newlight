import Image from "@/components/app-image"
import { DirectionalArrow } from "@/components/directional-arrow"
import { Link } from "@/i18n/navigation"
import { CategoryService } from "@/lib/services/category-service"
import { encodeSlug, resolveLocale } from "@repo/database"
import { getLocale, getTranslations } from "next-intl/server"
import { HeroMotion } from "./hero-motion"

const TILE_FALLBACK = "/category/indoor-lighting-1.png"

export async function Hero() {
    const t = await getTranslations("hero-section")
    const locale = resolveLocale(await getLocale())

    const category = await CategoryService.getFirstCategoryTile(locale)
    const categoryHref = category?.slug ? `/category/${encodeSlug(category.slug)}` : "/category"
    const categoryImage = category?.imageUrl || TILE_FALLBACK

    return (
        <HeroMotion>
            <section className="-mt-16 grid min-h-[80svh] grid-cols-1 border-b pt-16 lg:grid-cols-12">
                <div data-hero-media className="hero-anim relative min-h-[48svh] overflow-hidden lg:col-span-7 lg:min-h-0">
                    <div data-hero-image className="absolute inset-0 will-change-transform">
                        <Image
                            src="/hero/hero.jpg"
                            alt=""
                            fill
                            priority
                            sizes="(max-width: 1024px) 100vw, 58vw"
                            className="object-cover object-center"
                        />
                    </div>
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-linear-to-r from-black/80 via-black/45 via-55% to-black/10 rtl:bg-gradient-to-l"
                    />
                    <div
                        data-hero-text
                        className="hero-anim relative z-10 flex h-full flex-col justify-center px-5 py-20 sm:px-12 lg:px-16 xl:px-20"
                    >
                        <div className="max-w-2xl space-y-5">
                            <h1 className="font-display text-5xl leading-[0.95] text-balance text-on-media italic md:text-6xl xl:text-7xl">
                                {t("illuminate")}
                            </h1>
                            <p className="text-sm font-medium text-on-media-muted uppercase ltr:tracking-hero md:text-base">
                                {t("inspirationGlow")}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col bg-card lg:col-span-5">
                    <div
                        data-hero-inspiration
                        className="hero-anim flex flex-1 items-center justify-center border-b p-12 lg:p-16"
                    >
                        <div className="space-y-5 text-center">
                            <h2 className="font-display text-5xl leading-tight italic lg:text-6xl">{t("inspiration")}</h2>
                            <div aria-hidden className="mx-auto h-px w-12 bg-primary" />
                        </div>
                    </div>
                    <div className="grid flex-1 grid-cols-2">
                        <div
                            data-hero-links
                            className="hero-anim flex flex-col justify-center border-e p-6 transition-colors duration-(--duration-slow) hover:bg-muted/40 sm:p-8 lg:p-12"
                        >
                            <div className="space-y-8">
                                <Link href="/technical-resources" className="group block">
                                    <p className="mb-2 text-base font-medium transition-colors duration-(--duration-fast) group-hover:text-primary">
                                        {t("technicalResources")
                                            .split(" ")
                                            .map((word) => (
                                                <span key={word} className="block">
                                                    {word}
                                                </span>
                                            ))}
                                    </p>
                                    <div
                                        aria-hidden
                                        className="h-px w-8 bg-border-strong transition-all duration-(--duration-slow) group-hover:w-full group-hover:bg-primary motion-reduce:transition-none"
                                    />
                                </Link>
                                <Link href="/about" className="group block">
                                    <p className="mb-2 text-base font-medium transition-colors duration-(--duration-fast) group-hover:text-primary">
                                        <span className="block">{t("weAre")}</span>
                                        <span className="block font-display text-lg italic">{t("weAreNewLight")}</span>
                                    </p>
                                    <div
                                        aria-hidden
                                        className="h-px w-8 bg-border-strong transition-all duration-(--duration-slow) group-hover:w-full group-hover:bg-primary motion-reduce:transition-none"
                                    />
                                </Link>
                            </div>
                        </div>
                        <Link
                            href={categoryHref}
                            data-hero-tile
                            className="hero-anim group relative flex min-h-[28svh] overflow-hidden"
                        >
                            <Image
                                src={categoryImage}
                                alt=""
                                fill
                                sizes="(max-width: 1024px) 50vw, 21vw"
                                className="object-cover transition-transform duration-(--duration-slow) group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                            />
                            <div aria-hidden className="absolute inset-0 bg-linear-to-t from-black/80 via-black/25 to-black/5" />
                            <div
                                aria-hidden
                                className="absolute inset-0 bg-primary/20 opacity-0 transition-opacity duration-(--duration-slow) group-hover:opacity-100"
                            />
                            <span className="relative z-10 mt-auto flex w-full items-center justify-between gap-3 p-6 lg:p-8">
                                <span className="font-display text-2xl text-on-media italic lg:text-3xl">{t("category")}</span>
                                <DirectionalArrow variant="circled" className="border-on-media/40 text-on-media" />
                            </span>
                        </Link>
                    </div>
                </div>
            </section>
        </HeroMotion>
    )
}
