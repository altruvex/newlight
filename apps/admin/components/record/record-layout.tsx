"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { formatDistanceToNowStrict } from "date-fns"

import { StatusBadge } from "@/components/status-badge"
import { StaleNotice } from "@/components/states"
import { pageTabsTriggerClass } from "@/components/page"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { StatusKind, StatusValue } from "@/lib/status"

export interface RecordIdentifier {
    label: string
    value: string
    mono?: boolean
}

export interface RecordTab {
    id: string
    label: string
    badge?: React.ReactNode
    content: React.ReactNode
}

export interface AuditEntry {
    id: string
    action: string
    actorEmail: string | null
    actorType: string | null
    createdAt: string
}

interface RecordLayoutProps {
    title: string
    subtitle?: string
    identifiers?: RecordIdentifier[]
    status?: { kind: StatusKind; value: string }
    marks?: React.ReactNode
    actions?: React.ReactNode
    tabs: RecordTab[]
    defaultTab?: string
    rail: {
        createdAt: string
        updatedAt: string
        audit: AuditEntry[]
        auditHref?: string
        extra?: React.ReactNode
    }
    stale?: boolean
    onReload?: () => void
}

export function RecordLayout({
    title,
    subtitle,
    identifiers = [],
    status,
    marks,
    actions,
    tabs,
    defaultTab,
    rail,
    stale = false,
    onReload,
}: RecordLayoutProps) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const urlTab = searchParams.get("tab")
    const active = tabs.some((tab) => tab.id === urlTab) ? urlTab! : (defaultTab ?? tabs[0]!.id)

    // Tab data loads on the server per tab, so switching is a round-trip: show the new tab at once
    // and dim the content until its data arrives.
    const [pending, startTransition] = useTransition()
    const [shownTab, setShownTab] = useOptimistic(active)

    function selectTab(next: string) {
        const params = new URLSearchParams(searchParams.toString())
        params.set("tab", next)
        startTransition(() => {
            setShownTab(next)
            router.replace(`?${params.toString()}`, { scroll: false })
        })
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            {stale && <StaleNotice entity="product" onReload={onReload} />}

            <Tabs value={shownTab} onValueChange={selectTab} className="flex min-h-0 flex-1 flex-col gap-0">
                <header className="shrink-0 border-b px-4 pt-3">
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="truncate text-xl font-semibold tracking-tight">
                                    <bdi dir="auto">{title}</bdi>
                                </h1>
                                {status && <StatusBadge kind={status.kind} value={status.value as StatusValue<StatusKind>} />}
                                {marks}
                            </div>

                            {subtitle && (
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    <bdi dir="auto">{subtitle}</bdi>
                                </p>
                            )}

                            {identifiers.length > 0 && (
                                <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
                                    {identifiers.map((identifier) => (
                                        <div key={identifier.label} className="flex items-center gap-1">
                                            <dt className="text-muted-foreground">{identifier.label}</dt>
                                            <dd className={cn(identifier.mono !== false && "font-mono")}>
                                                {identifier.value}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                        </div>

                        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
                    </div>

                    <TabsList className="mt-2 h-8 gap-0 bg-transparent p-0">
                        {tabs.map((tab) => (
                            <TabsTrigger
                                key={tab.id}
                                value={tab.id}
                                className={pageTabsTriggerClass}
                            >
                                {tab.label}
                                {tab.badge}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </header>

                <div className="flex min-h-0 flex-1">
                    <div
                        aria-busy={pending}
                        className={cn("min-w-0 flex-1 overflow-y-auto transition-opacity", pending && "opacity-60")}
                    >
                        {tabs.map((tab) => (
                            <TabsContent key={tab.id} value={tab.id} className="mt-0 p-4">
                                {tab.content}
                            </TabsContent>
                        ))}
                    </div>

                    <RecordRail {...rail} />
                </div>
            </Tabs>
        </div>
    )
}

function RecordRail({
    createdAt,
    updatedAt,
    audit,
    auditHref,
    extra,
}: RecordLayoutProps["rail"]) {
    return (
        <aside
            aria-label="Record history"
            className="hidden w-64 shrink-0 overflow-y-auto border-l bg-surface-sunk px-3 py-3 xl:block"
        >
            <dl className="space-y-1.5 text-2xs">
                <RailRow label="Created" value={<Timestamp value={createdAt} />} />
                <RailRow label="Updated" value={<Timestamp value={updatedAt} />} />
            </dl>

            {extra && <div className="mt-3 border-t pt-3">{extra}</div>}

            <div className="mt-3 border-t pt-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xs font-semibold tracking-label text-muted-foreground uppercase">
                        Audit trail
                    </h2>
                    {auditHref && (
                        <Link
                            href={auditHref}
                            className="text-2xs text-primary underline-offset-2 hover:underline"
                        >
                            All
                        </Link>
                    )}
                </div>

                {audit.length === 0 ? (
                    <p className="mt-2 text-2xs text-muted-foreground">
                        No changes recorded since this record was created.
                    </p>
                ) : (
                    <ol className="mt-2 space-y-2">
                        {audit.map((entry) => (
                            <li key={entry.id} className="border-l-2 border-border pl-2">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="font-mono text-2xs">{entry.action}</span>
                                    {entry.actorType && (
                                        <StatusBadge kind="actor" value={entry.actorType} className="shrink-0" />
                                    )}
                                </div>
                                <div className="truncate text-2xs text-muted-foreground">
                                    {entry.actorEmail ?? "system"}
                                </div>
                                <Timestamp value={entry.createdAt} className="text-2xs text-muted-foreground" />
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </aside>
    )
}

function RailRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
        </div>
    )
}

function Timestamp({ value, className }: { value: string; className?: string }) {
    const date = new Date(value)
    return (
        <time
            dateTime={value}
            title={date.toLocaleString("en-GB")}
            suppressHydrationWarning
            className={cn("tabular-nums", className)}
        >
            {formatDistanceToNowStrict(date, { addSuffix: true })}
        </time>
    )
}
