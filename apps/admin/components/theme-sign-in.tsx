"use client"

import { Eye, EyeOff, LoaderCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { signIn } from "@/lib/auth-client"

export function ThemedSignIn({ next = "/admin/dashboard" }: { next?: string }) {
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const [revealed, setRevealed] = useState(false)
    const [capsLock, setCapsLock] = useState(false)

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        setPending(true)

        const form = new FormData(event.currentTarget)
        const result = await signIn.email({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
        })
        setPending(false)

        if (result.error) return setError("Email or password is incorrect.")

        router.push(next)
        router.refresh()
    }

    return (
        <div className="w-full rounded-lg border bg-card p-6 shadow-overlay sm:p-7">
            <h1 className="text-base font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 mb-6 text-xs text-muted-foreground">Use your administrator credentials to continue.</p>

            <form onSubmit={onSubmit} noValidate>
                {error ? (
                    <p
                        role="alert"
                        className="mb-4 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger"
                    >
                        {error}
                    </p>
                ) : null}

                <div className="mb-4 space-y-1.5">
                    <Label htmlFor="email" className="text-xs">
                        Email address
                    </Label>
                    <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        autoFocus
                        className="h-9"
                    />
                </div>

                <div className="mb-5 space-y-1.5">
                    <Label htmlFor="password" className="text-xs">
                        Password
                    </Label>
                    <div className="relative">
                        <Input
                            id="password"
                            name="password"
                            type={revealed ? "text" : "password"}
                            autoComplete="current-password"
                            required
                            aria-describedby={capsLock ? "admin-caps" : undefined}
                            onKeyUp={(event) => setCapsLock(event.getModifierState?.("CapsLock") ?? false)}
                            onBlur={() => setCapsLock(false)}
                            className="h-9 pe-10"
                        />
                        <button
                            type="button"
                            onClick={() => setRevealed((value) => !value)}
                            aria-label={revealed ? "Hide password" : "Show password"}
                            aria-pressed={revealed}
                            className="absolute inset-y-0 end-0 grid w-10 place-items-center text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground"
                        >
                            {revealed ? (
                                <EyeOff aria-hidden className="size-4" />
                            ) : (
                                <Eye aria-hidden className="size-4" />
                            )}
                        </button>
                    </div>
                    {capsLock ? (
                        <p id="admin-caps" role="status" className="text-xs text-warning">
                            Caps Lock is on.
                        </p>
                    ) : null}
                </div>

                <Button type="submit" disabled={pending} className={cn("h-9 w-full")}>
                    {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
                    {pending ? "Signing in…" : "Sign in"}
                </Button>
            </form>
        </div>
    )
}
