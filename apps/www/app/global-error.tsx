"use client"

import { useEffect } from "react"
import { reportError } from "@/lib/report-error"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        reportError(error, { boundary: "global" })
    }, [error])

    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    minHeight: "100vh",
                    display: "grid",
                    placeItems: "center",
                    padding: "2rem",
                    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
                    background: "#fff",
                    color: "#111",
                }}
            >
                <main style={{ maxWidth: "28rem", textAlign: "center" }}>
                    <h1 style={{ fontSize: "1.5rem", fontWeight: 400, marginBottom: "0.5rem" }}>
                        Something went wrong
                    </h1>
                    <p dir="rtl" style={{ fontSize: "1.25rem", fontWeight: 400, margin: "0 0 1.5rem" }}>
                        حصل خطأ
                    </p>

                    <button
                        onClick={reset}
                        style={{
                            padding: "0.6rem 1.4rem",
                            borderRadius: "0.4rem",
                            border: "1px solid #111",
                            background: "#111",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: "0.95rem",
                        }}
                    >
                        Try again · حاول تاني
                    </button>

                    {error.digest && (
                        <p style={{ marginTop: "2rem", fontSize: "0.75rem", color: "#666" }}>
                            Reference <code>{error.digest}</code>
                        </p>
                    )}
                </main>
            </body>
        </html>
    )
}
