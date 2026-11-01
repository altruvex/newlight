import Link from "next/link"
import { requireCurrentAdmin } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AuditService } from "@/lib/services/audit-service"
import { AuditFilters } from "./audit-filters"
import { AuditDiff } from "./audit-diff"
import { PageBody, PageHeader, PageStack, Stat, StatGrid, TableFrame } from "@/components/page"
import { StatusBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/states"

export const dynamic = "force-dynamic"

function linkFor(entity: string, entityId: string): string | null {
    switch (entity) {
        case "Product":
            return `/admin/products/${entityId}`
        case "Category":
            return `/admin/taxonomy/category/${entityId}`
        case "SubCategory":
            return `/admin/taxonomy/sub-category/${entityId}`
        case "Order":
            return `/admin/orders/${entityId}`
        case "User":
            return `/admin/users/${entityId}`
        case "SpecDefinition":
            return `/admin/specs`
        default:
            return null
    }
}

export default async function AuditPage({
    searchParams,
}: {
    searchParams: Promise<{ action?: string; entity?: string; actor?: string; q?: string; page?: string }>
}) {
    await requireCurrentAdmin()
    const params = await searchParams

    const [{ rows, total, page, totalPages }, facets, summary] = await Promise.all([
        AuditService.list({
            action: params.action,
            entity: params.entity,
            actorEmail: params.actor,
            search: params.q,
            page: Number(params.page ?? 1) || 1,
        }),
        AuditService.facets(),
        AuditService.summary(),
    ])

    const query = (overrides: Record<string, string | undefined>) => {
        const next = new URLSearchParams()
        const merged = { action: params.action, entity: params.entity, actor: params.actor, q: params.q, ...overrides }
        for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value)
        const s = next.toString()
        return `/admin/audit${s ? `?${s}` : ""}`
    }

    return (
        <>
            <PageHeader
                title="Audit log"
                description="Every change this panel makes, with the person who made it and when. Read-only by construction: entries cannot be edited or removed from here."
            />

            <PageBody>
                <PageStack>
                    <StatGrid>
                        <Stat label="Changes" value={summary.today} hint="last 24 hours" />
                        <Stat label="Changes" value={summary.week} hint="last 7 days" />
                        <Stat label="People" value={summary.actorsToday} hint="active today" />
                        <Stat label="Matching this filter" value={total} />
                    </StatGrid>

                    <AuditFilters facets={facets} current={params} />

                    <TableFrame>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="whitespace-nowrap">When</TableHead>
                                    <TableHead>Who</TableHead>
                                    <TableHead>What</TableHead>
                                    <TableHead>To what</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.length === 0 ? (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={5} className="p-0">
                                            <EmptyState
                                                variant="no-results"
                                                title="Nothing matches that filter"
                                                description="Widen the date, the action or the person and try again."
                                            />
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    rows.map((row) => {
                                        const href = linkFor(row.entity, row.entityId)
                                        return (
                                            <TableRow key={row.id}>
                                                <TableCell className="align-top whitespace-nowrap tabular-nums">
                                                    {new Date(row.createdAt).toLocaleString("en-GB")}
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    <div>{row.actorEmail ?? "—"}</div>
                                                    {row.actorType && row.actorType !== "ADMIN" && (
                                                        <StatusBadge
                                                            kind="actor"
                                                            value={row.actorType}
                                                            className="mt-1"
                                                        />
                                                    )}
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    <Link
                                                        href={query({ action: row.action, page: undefined })}
                                                        className="font-mono underline-offset-2 hover:underline"
                                                    >
                                                        {row.action}
                                                    </Link>
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    <div>{row.entity}</div>
                                                    {href ? (
                                                        <Link
                                                            href={href}
                                                            className="font-mono text-2xs break-all text-muted-foreground underline-offset-2 hover:underline"
                                                        >
                                                            {row.entityId}
                                                        </Link>
                                                    ) : (
                                                        <span className="font-mono text-2xs break-all text-muted-foreground">
                                                            {row.entityId}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="align-top max-w-md">
                                                    <AuditDiff id={row.id} hasDiff={row.hasDiff} diff={row.diff} />
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </TableFrame>

                    {totalPages > 1 && (
                        <nav className="flex items-center justify-between" aria-label="Audit log pages">
                            <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
                                {page > 1 ? (
                                    <Link href={query({ page: String(page - 1) })}>Previous</Link>
                                ) : (
                                    <span>Previous</span>
                                )}
                            </Button>
                            <span className="text-xs tabular-nums text-muted-foreground">
                                Page {page} of {totalPages}
                            </span>
                            <Button variant="outline" size="sm" disabled={page >= totalPages} asChild={page < totalPages}>
                                {page < totalPages ? (
                                    <Link href={query({ page: String(page + 1) })}>Next</Link>
                                ) : (
                                    <span>Next</span>
                                )}
                            </Button>
                        </nav>
                    )}
                </PageStack>
            </PageBody>
        </>
    )
}
