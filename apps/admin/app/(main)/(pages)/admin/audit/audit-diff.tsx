"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { getAuditDiff } from "@/app/action/audit-actions"

/**
 * The list sends a diff only when it is small. A large one (a bulk reprice has an entry per
 * product) is fetched here, when the admin asks for it.
 */
export function AuditDiff({ id, hasDiff, diff }: { id: string; hasDiff: boolean; diff: unknown }) {
    const [loaded, setLoaded] = useState<{ diff: unknown } | null>(diff == null ? null : { diff })
    const [error, setError] = useState<string | null>(null)
    const [pending, start] = useTransition()

    if (!hasDiff) return <span className="text-muted-foreground">—</span>

    if (!loaded) {
        return (
            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    className="h-6 px-1.5 text-xs"
                    onClick={() =>
                        start(async () => {
                            const result = await getAuditDiff(id)
                            if (result.ok) {
                                setError(null)
                                setLoaded({ diff: result.diff })
                            } else setError(result.error)
                        })
                    }
                >
                    {pending ? "Loading…" : "Show"}
                </Button>
                {error && <span className="text-2xs text-danger">{error}</span>}
            </div>
        )
    }

    return <DiffView diff={loaded.diff} defaultOpen={diff == null} />
}

function DiffView({ diff, defaultOpen }: { diff: unknown; defaultOpen: boolean }) {
    const [open, setOpen] = useState(defaultOpen)

    if (diff === null || diff === undefined) return <span className="text-muted-foreground">—</span>
    if (typeof diff !== "object") return <span className="font-mono text-xs">{String(diff)}</span>

    const record = diff as Record<string, unknown>

    if (Array.isArray(record.changes)) {
        const changes = record.changes as Array<Record<string, unknown>>
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <span className="rounded border px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
                        {changes.length} change{changes.length === 1 ? "" : "s"}
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        className="h-6 px-1.5 text-xs"
                    >
                        {open ? "Hide" : "Show"}
                    </Button>
                </div>
                {open && (
                    <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-2xs">
                        {changes.map((change, i) => (
                            <li key={i} className="text-muted-foreground">
                                {String(change.sku ?? change.key ?? change.productId ?? i)}:{" "}
                                <span className="line-through">{String(change.from ?? "—")}</span>{" "}
                                → <span className="text-foreground">{String(change.to ?? "—")}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        )
    }

    const rows: Array<{ label: string; from?: string; to?: string; value?: string }> = []

    for (const [key, value] of Object.entries(record)) {
        if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v !== "object")) {
            rows.push({ label: key, from: String(value[0]), to: String(value[1]) })
            continue
        }
        if (key === "from" || key === "to") continue
        rows.push({
            label: key,
            value:
                value === null
                    ? "—"
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value),
        })
    }

    if ("from" in record || "to" in record) {
        rows.unshift({ label: "value", from: String(record.from ?? "—"), to: String(record.to ?? "—") })
    }

    return (
        <ul className="space-y-0.5 text-xs">
            {rows.slice(0, open ? rows.length : 4).map((row, i) => (
                <li key={i} className="break-all">
                    <span className="text-muted-foreground">{row.label}:</span>{" "}
                    {row.from !== undefined ? (
                        <>
                            <span className="line-through text-muted-foreground">{row.from}</span>{" "}
                            → <span className="font-medium">{row.to}</span>
                        </>
                    ) : (
                        <span className="font-mono">{row.value}</span>
                    )}
                </li>
            ))}
            {rows.length > 4 && (
                <li>
                    <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={open}
                        className="h-6 px-1 text-xs"
                        onClick={() => setOpen((v) => !v)}
                    >
                        {open ? "less" : `+${rows.length - 4} more`}
                    </Button>
                </li>
            )}
        </ul>
    )
}
