"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Mail, Phone } from "lucide-react"
import { ContactFormStatus, ContactPriority } from "@repo/database"

import { CellIdentity, CellText } from "@/components/data-table/cell-text"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableToolbar, type FilterDef } from "@/components/data-table/toolbar"
import { ConfirmAction } from "@/components/confirm-action"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { MetadataList } from "@/components/page"
import { statusLabel } from "@/lib/status"
import type { ContactListResult, ContactRow } from "@/lib/services/contact-service"
import type { TableState } from "@/lib/table-params"
import { deleteContact, getContactMessage, setContactPriority, setContactRead, setContactStatus } from "@/app/action/contact-actions"

interface Props extends ContactListResult {
    state: TableState
}

export function ContactTable({ rows, total, state }: Props) {
    const router = useRouter()
    const [open, setOpen] = useState<ContactRow | null>(null)
    const [pending, start] = useTransition()
    // Full text of the open enquiry, fetched by id; undefined while loading, null when blank.
    const [full, setFull] = useState<{ id: string; message: string | null } | null>(null)
    const [failedId, setFailedId] = useState<string | null>(null)
    const openId = open?.id

    useEffect(() => {
        if (!openId) return
        let cancelled = false
        getContactMessage(openId).then((result) => {
            if (cancelled) return
            if (result.ok) setFull({ id: openId, message: result.message })
            else setFailedId(openId)
        })
        return () => {
            cancelled = true
        }
    }, [openId])
    const loadFailed = failedId === openId
    const fullMessage = full && full.id === openId ? full.message : undefined

    const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
        start(async () => {
            const result = await fn()
            if (result.ok) {
                toast.success(result.message ?? "Done.")
                router.refresh()
            } else {
                toast.error(result.error ?? "Something went wrong.")
            }
        })

    const columns: ColumnDef<ContactRow, unknown>[] = [
        {
            id: "fullName",
            header: "From",
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        aria-hidden
                        className={
                            row.original.isRead
                                ? "size-1.5 shrink-0 rounded-full bg-transparent"
                                : "size-1.5 shrink-0 rounded-full bg-primary"
                        }
                    />
                    <CellIdentity name={row.original.fullName} identifier={row.original.jobPosition} />
                    {!row.original.isRead && <span className="sr-only">Unread</span>}
                </div>
            ),
        },
        {
            id: "email",
            header: "Email",
            cell: ({ row }) => <CellText className="text-muted-foreground">{row.original.email}</CellText>,
        },
        {
            id: "phoneNumber",
            header: "Phone",
            cell: ({ row }) => <CellText className="font-mono text-2xs">{row.original.phoneNumber}</CellText>,
        },
        {
            id: "message",
            header: "Message",
            cell: ({ row }) =>
                row.original.preview ? (
                    <CellText className="max-w-[40ch] text-muted-foreground">{row.original.preview}</CellText>
                ) : (
                    <span className="text-2xs text-muted-foreground">No message</span>
                ),
        },
        {
            id: "priority",
            header: "Priority",
            cell: ({ row }) =>
                row.original.priority === ContactPriority.NORMAL ? (
                    <span className="text-2xs text-muted-foreground">Normal</span>
                ) : (
                    <StatusBadge kind="priority" value={row.original.priority} />
                ),
        },
        {
            id: "status",
            header: "Status",
            cell: ({ row }) => <StatusBadge kind="contact" value={row.original.status} />,
        },
        {
            id: "createdAt",
            header: "Received",
            cell: ({ row }) => (
                <span className="tabular-nums whitespace-nowrap text-muted-foreground">
                    {new Date(row.original.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                    })}
                </span>
            ),
        },
    ]

    const filters: FilterDef[] = [
        {
            key: "read",
            label: "Read",
            options: [
                { value: "unread", label: "Unread" },
                { value: "read", label: "Read" },
            ],
            width: "w-32",
        },
        {
            key: "status",
            label: "Status",
            options: Object.values(ContactFormStatus).map((status) => ({
                value: status,
                label: statusLabel("contact", status),
            })),
            width: "w-40",
        },
        {
            key: "priority",
            label: "Priority",
            options: Object.values(ContactPriority).map((priority) => ({
                value: priority,
                label: statusLabel("priority", priority),
            })),
            width: "w-36",
        },
    ]

    return (
        <>
            <DataTable<ContactRow>
                caption={`Contact enquiries, ${total} total`}
                columns={columns}
                data={rows}
                rowCount={total}
                state={state}
                getRowId={(row) => row.id}
                sortableColumns={["fullName", "status", "priority", "createdAt"]}
                onRowOpen={(row) => {
                    setOpen(row)
                    if (!row.isRead) act(() => setContactRead(row.id, true))
                }}
                filtered={Object.keys(state.filters).length > 0}
                toolbar={
                    <DataTableToolbar
                        searchPlaceholder="Name, email, phone or message…"
                        filters={filters}
                    />
                }
                emptyState={{
                    noData: {
                        variant: "no-data",
                        title: "No enquiries yet",
                        description: "Submissions from the storefront's contact form arrive here.",
                    },
                    noResults: {
                        variant: "no-results",
                        title: "No enquiries match these filters",
                        description: "Clear a filter or widen the search to see more.",
                    },
                }}
            />

            <Sheet open={!!open} onOpenChange={(next) => !next && setOpen(null)}>
                <SheetContent side="right" className="w-full gap-0 sm:max-w-[480px]">
                    {open && (
                        <>
                            <SheetHeader className="gap-1 border-b">
                                <SheetTitle className="text-base">{open.fullName}</SheetTitle>
                                <SheetDescription className="text-xs">
                                    {open.jobPosition} · arrived via {open.source}
                                </SheetDescription>
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    <StatusBadge kind="contact" value={open.status} />
                                    <StatusBadge kind="priority" value={open.priority} />
                                </div>
                            </SheetHeader>

                            <div className="flex-1 overflow-y-auto p-4">
                                <div className="flex flex-wrap gap-1.5">
                                    <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                                        <a href={`mailto:${open.email}`}>
                                            <Mail aria-hidden className="mr-1.5 size-3" />
                                            Email
                                        </a>
                                    </Button>
                                    <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                                        <a href={`tel:${open.phoneNumber}`}>
                                            <Phone aria-hidden className="mr-1.5 size-3" />
                                            Call
                                        </a>
                                    </Button>
                                </div>

                                <div className="mt-4">
                                    <h3 className="text-2xs font-semibold tracking-label text-muted-foreground uppercase">
                                        Message
                                    </h3>
                                    {fullMessage === undefined && open.preview ? (
                                        <p className="mt-1.5 rounded-lg border bg-surface-sunk p-3 text-sm whitespace-pre-wrap">
                                            <bdi dir="auto">{open.preview}</bdi>
                                            <span className="text-muted-foreground">
                                                {loadFailed ? " (could not load the full message)" : " …"}
                                            </span>
                                        </p>
                                    ) : fullMessage ? (
                                        <p className="mt-1.5 rounded-lg border bg-surface-sunk p-3 text-sm whitespace-pre-wrap">
                                            <bdi dir="auto">{fullMessage}</bdi>
                                        </p>
                                    ) : fullMessage === undefined && !loadFailed ? (
                                        <p className="mt-1.5 text-xs text-muted-foreground">Loading…</p>
                                    ) : (
                                        <p className="mt-1.5 text-xs text-muted-foreground italic">
                                            They left the message blank — the form does not require one.
                                        </p>
                                    )}
                                </div>

                                <div className="mt-4 border-t pt-3">
                                    <MetadataList
                                        items={[
                                            { label: "Email", value: open.email },
                                            { label: "Phone", value: open.phoneNumber, mono: true },
                                            {
                                                label: "Received",
                                                value: new Date(open.createdAt).toLocaleString("en-GB"),
                                            },
                                            { label: "Replies logged", value: open.responses },
                                        ]}
                                    />
                                </div>

                                <div className="mt-4 grid gap-3 border-t pt-3">
                                    <label className="grid gap-1">
                                        <span className="text-xs text-muted-foreground">Status</span>
                                        <Select
                                            value={open.status}
                                            disabled={pending}
                                            onValueChange={(next) => {
                                                setOpen({ ...open, status: next as ContactFormStatus })
                                                act(() => setContactStatus(open.id, next as ContactFormStatus))
                                            }}
                                        >
                                            <SelectTrigger className="text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.values(ContactFormStatus).map((status) => (
                                                    <SelectItem key={status} value={status} className="text-xs">
                                                        {statusLabel("contact", status)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </label>

                                    <label className="grid gap-1">
                                        <span className="text-xs text-muted-foreground">Priority</span>
                                        <Select
                                            value={open.priority}
                                            disabled={pending}
                                            onValueChange={(next) => {
                                                setOpen({ ...open, priority: next as ContactPriority })
                                                act(() => setContactPriority(open.id, next as ContactPriority))
                                            }}
                                        >
                                            <SelectTrigger className="text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.values(ContactPriority).map((priority) => (
                                                    <SelectItem key={priority} value={priority} className="text-xs">
                                                        {statusLabel("priority", priority)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </label>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 border-t p-3">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={pending}
                                    className="h-7 text-xs"
                                    onClick={() => {
                                        setOpen({ ...open, isRead: !open.isRead })
                                        act(() => setContactRead(open.id, !open.isRead))
                                    }}
                                >
                                    {open.isRead ? "Mark unread" : "Mark read"}
                                </Button>

                                {open.status !== ContactFormStatus.SPAM && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={pending}
                                        className="h-7 text-xs"
                                        onClick={() => {
                                            setOpen({ ...open, status: ContactFormStatus.SPAM })
                                            act(() => setContactStatus(open.id, ContactFormStatus.SPAM))
                                        }}
                                    >
                                        Mark spam
                                    </Button>
                                )}

                                <ConfirmAction
                                    severity="consequential"
                                    title={`Delete the enquiry from ${open.fullName}?`}
                                    description="The submission and every reply logged against it are removed permanently. Marking it spam keeps the record and takes it out of the queue."
                                    confirmLabel="Delete permanently"
                                    impact={{
                                        affectedCount: 1 + open.responses,
                                        sideEffects: [
                                            "The enquiry cannot be restored — there is no archive.",
                                            "The audit log keeps the name, email and date, and nothing else.",
                                        ],
                                    }}
                                    onConfirm={async () => {
                                        setOpen(null)
                                        act(() => deleteContact(open.id))
                                    }}
                                >
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={pending}
                                        className="ml-auto h-7 text-xs text-destructive hover:text-destructive"
                                    >
                                        Delete
                                    </Button>
                                </ConfirmAction>
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </>
    )
}
