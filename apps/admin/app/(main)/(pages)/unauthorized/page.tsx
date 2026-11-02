import Link from "next/link"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"

export const metadata = { title: "Not allowed" }

export default function UnauthorizedPage() {
    return (
        <main className="grid min-h-screen place-items-center bg-surface-sunk px-4">
            <div className="max-w-md text-center">
                <Lock aria-hidden className="mx-auto size-5 text-muted-foreground" />
                <h1 className="mt-3 text-2xl font-semibold tracking-tight">You do not have access to this</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    This panel is limited to administrators. If you should have access, ask an existing
                    administrator to grant it to your account.
                </p>
                <div className="mt-6 flex justify-center gap-2">
                    <Button asChild size="sm">
                        <Link href="/sign-in">Sign in as somebody else</Link>
                    </Button>
                </div>
            </div>
        </main>
    )
}
