import { ThemedSignIn } from "@/components/theme-sign-in"

export const metadata = { title: "Sign in" }

const DEFAULT_NEXT = "/admin/dashboard"

// Accept only a path on this site. "//host" and "/\\host" are read by
// browsers as another site, so a crafted link could send a fresh session away.
function safeNext(value: string | string[] | undefined) {
    const next = Array.isArray(value) ? value[0] : value
    if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT
    if (next === "/sign-in" || next.startsWith("/sign-in/") || next.startsWith("/sign-in?")) return DEFAULT_NEXT
    return next
}

export default async function SignInPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const next = safeNext((await searchParams).next)
    return (
        <main className="grid min-h-svh place-items-center bg-surface-sunk px-4 py-12">
            <div className="w-full max-w-[380px]">
                <div className="mb-6 flex items-center justify-center gap-2">
                    <div
                        aria-hidden
                        className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
                    >
                        N
                    </div>
                    <span className="text-sm font-semibold tracking-tight">NewLight</span>
                    <span className="rounded border px-1.5 py-px font-mono text-2xs text-muted-foreground">ERP</span>
                </div>

                <ThemedSignIn next={next} />

                <p className="mt-5 text-center text-2xs leading-relaxed text-muted-foreground">
                    Access is granted by an existing administrator.
                    <br />
                    There is no self-service sign-up.
                </p>
            </div>
        </main>
    )
}
