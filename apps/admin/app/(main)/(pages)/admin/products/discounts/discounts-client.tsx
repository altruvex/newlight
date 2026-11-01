"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmAction } from "@/components/confirm-action"
import { Money } from "@/components/money"
import { EmptyState } from "@/components/states"
import { InlineAlert, Panel, Section, TableFrame } from "@/components/page"
import { StatusBadge } from "@/components/status-badge"
import { CellText } from "@/components/data-table/cell-text"
import { Workflow, WorkflowResult } from "@/components/workflow/workflow"
import type { DiscountPreview, DiscountRow } from "@/lib/services/discount-service"
import type { DiscountScopeInput } from "@/lib/services/discount-service"
import {
    createDiscount,
    deleteDiscount,
    previewDiscount,
    rescheduleDiscount,
    stopDiscount,
    type DiscountFormInput,
} from "@/app/action/discount-actions"
import type { DiscountKind, DiscountScopeType } from "@repo/database"

interface Option {
    id: string
    name: string
    productCount?: number
}

interface ProductOption {
    id: string
    sku: string
    name: string
}

interface Props {
    discounts: DiscountRow[]
    view: "current" | "ended"
    page: number
    totalPages: number
    total: number
    categories: Option[]
    subCategories: Array<Option & { categoryId: string }>
    families: Array<Option & { subCategoryId: string }>
    products: ProductOption[]
}

const SCOPE_LABELS: Record<DiscountScopeType, string> = {
    PRODUCTS: "Specific products",
    FAMILY: "Family",
    SUB_CATEGORY: "Sub-category",
    CATEGORY: "Category",
    ALL: "Whole catalogue",
}

const SCOPE_ORDER: DiscountScopeType[] = ["PRODUCTS", "FAMILY", "SUB_CATEGORY", "CATEGORY", "ALL"]

const KIND_LABELS: Record<DiscountKind, string> = {
    PERCENT: "Percentage off",
    AMOUNT: "Amount off",
}

function toLocalInput(date: Date): string {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 16)
}

function fromLocalInput(value: string): Date {
    return new Date(value)
}

function formatWindow(date: Date): string {
    return new Date(date).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function defaultWindow(): { startsAt: string; endsAt: string } {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { startsAt: toLocalInput(start), endsAt: toLocalInput(end) }
}

export function DiscountsClient({ discounts, view, page, totalPages, total, categories, subCategories, families, products }: Props) {
    const [creating, setCreating] = useState(false)
    const ended = view === "ended"
    const pageHref = (target: number) => {
        const query = new URLSearchParams()
        if (ended) query.set("status", "ended")
        if (target > 1) query.set("page", String(target))
        const text = query.toString()
        return `/admin/products/discounts${text ? `?${text}` : ""}`
    }

    if (creating) {
        return (
            <CreateDiscount
                categories={categories}
                subCategories={subCategories}
                families={families}
                products={products}
                onDone={() => setCreating(false)}
            />
        )
    }

    return (
        <Section
            title="Discounts"
            description="Live and scheduled discounts apply automatically; ended ones are kept because an order placed under a discount has to stay explicable."
            actions={
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                        <Link href={ended ? "/admin/products/discounts" : "/admin/products/discounts?status=ended"}>
                            {ended ? "Show live and scheduled" : "Show ended"}
                        </Link>
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={() => setCreating(true)}>
                        New discount
                    </Button>
                </div>
            }
        >
            {discounts.length === 0 ? (
                <Panel>
                    <EmptyState
                        variant="no-data"
                        title={ended ? "No ended discounts" : "No live or scheduled discounts"}
                        description={
                            ended
                                ? "Discounts that finish or are stopped will be kept here."
                                : "A discount takes a percentage or an amount off a product, a family, a category or the whole catalogue, for a period you set."
                        }
                        action={
                            ended ? undefined : (
                                <Button size="sm" className="h-7 text-xs" onClick={() => setCreating(true)}>
                                    New discount
                                </Button>
                            )
                        }
                    />
                </Panel>
            ) : (
                <>
                    <DiscountTable discounts={discounts} />
                    {totalPages > 1 && (
                        <nav className="mt-2 flex items-center justify-between" aria-label="Discount pages">
                            <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
                                {page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span>Previous</span>}
                            </Button>
                            <span className="text-xs tabular-nums text-muted-foreground">
                                Page {page} of {totalPages} · {total} discounts
                            </span>
                            <Button variant="outline" size="sm" disabled={page >= totalPages} asChild={page < totalPages}>
                                {page < totalPages ? <Link href={pageHref(page + 1)}>Next</Link> : <span>Next</span>}
                            </Button>
                        </nav>
                    )}
                </>
            )}
        </Section>
    )
}

function DiscountTable({ discounts }: { discounts: DiscountRow[] }) {
    return (
        <TableFrame>
            <table className="w-full border-collapse text-left">
                <caption className="sr-only">Discounts, newest window first</caption>
                <thead className="bg-surface-sunk">
                    <tr className="h-8 border-b border-border-strong">
                        <Th>Name</Th>
                        <Th>Status</Th>
                        <Th>Applies to</Th>
                        <Th className="text-right">Takes off</Th>
                        <Th>From</Th>
                        <Th>Until</Th>
                        <Th>Created by</Th>
                        <Th className="text-right">Actions</Th>
                    </tr>
                </thead>
                <tbody>
                    {discounts.map((discount) => (
                        <DiscountTableRow key={discount.id} discount={discount} />
                    ))}
                </tbody>
            </table>
        </TableFrame>
    )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <th scope="col" className={`px-2.5 text-xs font-medium text-muted-foreground ${className ?? ""}`}>
            {children}
        </th>
    )
}

function DiscountTableRow({ discount }: { discount: DiscountRow }) {
    const [pending, start] = useTransition()
    const [rescheduling, setRescheduling] = useState(false)

    function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
        start(async () => {
            const result = await action()
            if (result.ok) toast.success(result.message)
            else toast.error(result.error)
        })
    }

    return (
        <>
            <tr className="h-[34px] border-b">
                <td className="max-w-[220px] px-2.5 text-sm">
                    <CellText>{discount.name}</CellText>
                </td>
                <td className="px-2.5">
                    <StatusBadge kind="discount" value={discount.status} />
                </td>
                <td className="max-w-[200px] px-2.5 text-sm">
                    <CellText>{discount.scopeLabel}</CellText>
                </td>
                <td className="px-2.5 text-right text-sm font-medium whitespace-nowrap">
                    {discount.kind === "PERCENT" ? (
                        `${trimZeros(discount.value)}%`
                    ) : (
                        <Money value={discount.value} />
                    )}
                </td>
                <td className="px-2.5 text-xs whitespace-nowrap text-muted-foreground">
                    {formatWindow(discount.startsAt)}
                </td>
                <td className="px-2.5 text-xs whitespace-nowrap text-muted-foreground">
                    {formatWindow(discount.endsAt)}
                </td>
                <td className="max-w-[180px] px-2.5 text-xs text-muted-foreground">
                    <CellText>{discount.createdByEmail ?? "—"}</CellText>
                </td>
                <td className="px-2.5 text-right whitespace-nowrap">
                    {(discount.status === "live" || discount.status === "scheduled") && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            disabled={pending}
                            onClick={() => setRescheduling(true)}
                        >
                            Reschedule
                        </Button>
                    )}

                    {discount.status === "live" && (
                        <ConfirmAction
                            severity="consequential"
                            title={`Stop "${discount.name}"?`}
                            description="Prices go back to normal immediately. The discount stays on the record so past orders remain explicable."
                            confirmLabel="Stop the discount"
                            impact={{
                                affectedCount: discount.productCount || 0,
                                sideEffects: [
                                    `Everything under ${discount.scopeLabel} returns to its base price`,
                                    "The storefront cache is refreshed",
                                    "Orders already placed keep the price they recorded",
                                ],
                            }}
                            onConfirm={() => run(() => stopDiscount(discount.id))}
                        >
                            <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={pending}>
                                Stop
                            </Button>
                        </ConfirmAction>
                    )}

                    {discount.status === "scheduled" && (
                        <ConfirmAction
                            severity="destructive"
                            typeToConfirm={discount.name}
                            title={`Delete "${discount.name}"?`}
                            description="It has not started, so nothing has been sold under it and there is nothing to explain later. This cannot be undone."
                            confirmLabel="Delete"
                            onConfirm={() => run(() => deleteDiscount(discount.id))}
                        >
                            <Button size="sm" variant="ghost" className="h-6 text-xs text-danger" disabled={pending}>
                                Delete
                            </Button>
                        </ConfirmAction>
                    )}
                </td>
            </tr>

            {rescheduling && (
                <RescheduleDialog
                    discount={discount}
                    onClose={() => setRescheduling(false)}
                    onSave={(startsAt, endsAt) => {
                        setRescheduling(false)
                        run(() => rescheduleDiscount(discount.id, startsAt, endsAt))
                    }}
                />
            )}
        </>
    )
}

function trimZeros(value: string): string {
    return value.replace(/\.00$/, "")
}

function RescheduleDialog({
    discount,
    onClose,
    onSave,
}: {
    discount: DiscountRow
    onClose: () => void
    onSave: (startsAt: string, endsAt: string) => void
}) {
    const started = discount.status === "live"
    const [startsAt, setStartsAt] = useState(toLocalInput(new Date(discount.startsAt)))
    const [endsAt, setEndsAt] = useState(toLocalInput(new Date(discount.endsAt)))

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>Reschedule &ldquo;{discount.name}&rdquo;</DialogTitle>
                    <DialogDescription>
                        {started
                            ? "This discount is already running, so only its end can move — customers have already bought at this price."
                            : "It has not started yet, so both ends of the window can move."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="reschedule-start" className="text-xs">
                            Starts
                        </Label>
                        <Input
                            id="reschedule-start"
                            type="datetime-local"
                            value={startsAt}
                            disabled={started}
                            onChange={(event) => setStartsAt(event.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="reschedule-end" className="text-xs">
                            Ends
                        </Label>
                        <Input
                            id="reschedule-end"
                            type="datetime-local"
                            value={endsAt}
                            onChange={(event) => setEndsAt(event.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                            onSave(
                                fromLocalInput(startsAt).toISOString(),
                                fromLocalInput(endsAt).toISOString()
                            )
                        }
                    >
                        Save the new window
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function CreateDiscount({
    categories,
    subCategories,
    families,
    products,
    onDone,
}: Pick<Props, "categories" | "subCategories" | "families" | "products"> & { onDone: () => void }) {
    const initialWindow = useMemo(() => defaultWindow(), [])

    const [name, setName] = useState("")
    const [scopeType, setScopeType] = useState<DiscountScopeType>("FAMILY")
    const [scopeId, setScopeId] = useState("")
    const [productIds, setProductIds] = useState<string[]>([])
    const [search, setSearch] = useState("")
    const [kind, setKind] = useState<DiscountKind>("PERCENT")
    const [value, setValue] = useState("15")
    const [startsAt, setStartsAt] = useState(initialWindow.startsAt)
    const [endsAt, setEndsAt] = useState(initialWindow.endsAt)

    const [preview, setPreview] = useState<DiscountPreview | null>(null)
    const [committed, setCommitted] = useState<string | null>(null)
    const [pending, start] = useTransition()

    function invalidate<T>(setter: (value: T) => void) {
        return (next: T) => {
            setPreview(null)
            setter(next)
        }
    }

    const scopeOptions: Option[] =
        scopeType === "CATEGORY" ? categories : scopeType === "SUB_CATEGORY" ? subCategories : families

    const filteredProducts = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (!needle) return products.slice(0, 60)
        return products
            .filter(
                (product) =>
                    product.sku.toLowerCase().includes(needle) || product.name.toLowerCase().includes(needle)
            )
            .slice(0, 60)
    }, [products, search])

    function buildScope(): DiscountScopeInput {
        switch (scopeType) {
            case "CATEGORY":
                return { type: "CATEGORY", categoryId: scopeId }
            case "SUB_CATEGORY":
                return { type: "SUB_CATEGORY", subCategoryId: scopeId }
            case "FAMILY":
                return { type: "FAMILY", familyId: scopeId }
            case "PRODUCTS":
                return { type: "PRODUCTS", productIds }
            default:
                return { type: "ALL" }
        }
    }

    function buildForm(): DiscountFormInput {
        return {
            name,
            kind,
            value,
            scope: buildScope(),
            startsAt: fromLocalInput(startsAt).toISOString(),
            endsAt: fromLocalInput(endsAt).toISOString(),
        }
    }

    function runPreview() {
        start(async () => {
            const result = await previewDiscount(buildForm())
            if (result.ok) setPreview(result.preview)
            else {
                setPreview(null)
                toast.error(result.error)
            }
        })
    }

    function commit() {
        start(async () => {
            const result = await createDiscount(buildForm())
            if (result.ok) setCommitted(result.message)
            else toast.error(result.error)
        })
    }

    if (committed) {
        return (
            <div className="pt-1">
                <WorkflowResult title="The discount is set">
                    <p>{committed}</p>
                    <p className="mt-1">
                        It starts on its own and ends on its own. Nothing has to be undone when the period is
                        over — the products go back to their normal price at {formatWindow(fromLocalInput(endsAt))}.
                    </p>
                    <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDone}>
                            Back to the list
                        </Button>
                    </div>
                </WorkflowResult>
            </div>
        )
    }

    const scopeReady =
        scopeType === "ALL" ? true : scopeType === "PRODUCTS" ? productIds.length > 0 : Boolean(scopeId)

    return (
        <div className="pt-1">
            <div className="mb-3">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>
                    ← Back to the list
                </Button>
            </div>

            <Workflow
                busy={pending}
                steps={[
                    {
                        id: "scope",
                        title: "What is discounted",
                        validate: () =>
                            !name.trim()
                                ? "Name the discount — it is how you find it in the list later."
                                : scopeReady
                                  ? true
                                  : "Choose what the discount applies to.",
                        content: (
                            <div className="space-y-3">
                                <div className="max-w-[380px] space-y-1">
                                    <Label htmlFor="discount-name" className="text-xs">
                                        Name
                                    </Label>
                                    <Input
                                        id="discount-name"
                                        value={name}
                                        placeholder="Eid sale — spotlights"
                                        onChange={(event) => invalidate(setName)(event.target.value)}
                                    />
                                    <p className="text-2xs text-muted-foreground">
                                        Internal only. Customers see the price, not the name.
                                    </p>
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-xs">Applies to</Label>
                                    <ToggleGroup
                                        type="single"
                                        value={scopeType}
                                        onValueChange={(next) => {
                                            if (!next) return
                                            setPreview(null)
                                            setScopeType(next as DiscountScopeType)
                                            setScopeId("")
                                            setProductIds([])
                                        }}
                                    >
                                        {SCOPE_ORDER.map((type) => (
                                            <ToggleGroupItem key={type} value={type}>
                                                {SCOPE_LABELS[type]}
                                            </ToggleGroupItem>
                                        ))}
                                    </ToggleGroup>
                                </div>

                                {scopeType === "PRODUCTS" ? (
                                    <ProductPicker
                                        products={filteredProducts}
                                        total={products.length}
                                        selected={productIds}
                                        search={search}
                                        onSearch={setSearch}
                                        onToggle={(id) =>
                                            invalidate(setProductIds)(
                                                productIds.includes(id)
                                                    ? productIds.filter((current) => current !== id)
                                                    : [...productIds, id]
                                            )
                                        }
                                        onClear={() => invalidate(setProductIds)([])}
                                    />
                                ) : scopeType === "ALL" ? (
                                    <InlineAlert tone="warning" title="Every live product">
                                        A catalogue-wide discount applies to all {products.length} products,
                                        including anything added while it is running.
                                    </InlineAlert>
                                ) : (
                                    <div className="max-w-[380px] space-y-1">
                                        <Label htmlFor="discount-scope" className="text-xs">
                                            Choose one
                                        </Label>
                                        <Select value={scopeId} onValueChange={invalidate(setScopeId)}>
                                            <SelectTrigger id="discount-scope" className="w-full">
                                                <SelectValue placeholder="—" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {scopeOptions.map((option) => (
                                                    <SelectItem key={option.id} value={option.id} className="text-xs">
                                                        {option.name}
                                                        {option.productCount !== undefined
                                                            ? ` (${option.productCount})`
                                                            : ""}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                        ),
                    },
                    {
                        id: "amount",
                        title: "How much comes off",
                        validate: () => (value.trim() ? true : "Enter how much the discount takes off."),
                        content: (
                            <div className="space-y-3">
                                <ToggleGroup
                                    type="single"
                                    value={kind}
                                    onValueChange={(next) => {
                                        if (!next) return
                                        setPreview(null)
                                        setKind(next as DiscountKind)
                                    }}
                                >
                                    {(Object.keys(KIND_LABELS) as DiscountKind[]).map((option) => (
                                        <ToggleGroupItem key={option} value={option}>
                                            {KIND_LABELS[option]}
                                        </ToggleGroupItem>
                                    ))}
                                </ToggleGroup>

                                <div className="space-y-1">
                                    <Label htmlFor="discount-value" className="text-xs">
                                        {kind === "PERCENT" ? "Percent off" : "Amount off (EGP)"}
                                    </Label>
                                    <Input
                                        id="discount-value"
                                        inputMode="decimal"
                                        value={value}
                                        onChange={(event) => invalidate(setValue)(event.target.value)}
                                        className="w-32 tabular-nums"
                                    />
                                    <p className="text-2xs text-muted-foreground">
                                        {kind === "PERCENT"
                                            ? "15 takes 15% off every product in scope."
                                            : "A flat amount off each product — never below the price of the cheapest one in scope."}
                                    </p>
                                </div>
                            </div>
                        ),
                    },
                    {
                        id: "period",
                        title: "For how long",
                        validate: () => {
                            const from = fromLocalInput(startsAt)
                            const to = fromLocalInput(endsAt)
                            if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "Set both dates."
                            if (to <= from) return "The discount has to end after it starts."
                            if (to <= new Date()) return "That window has already passed."
                            return true
                        },
                        content: (
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="discount-start" className="text-xs">
                                            Starts
                                        </Label>
                                        <Input
                                            id="discount-start"
                                            type="datetime-local"
                                            value={startsAt}
                                            onChange={(event) => invalidate(setStartsAt)(event.target.value)}
                                            className="w-[220px]"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="discount-end" className="text-xs">
                                            Ends
                                        </Label>
                                        <Input
                                            id="discount-end"
                                            type="datetime-local"
                                            value={endsAt}
                                            onChange={(event) => invalidate(setEndsAt)(event.target.value)}
                                            className="w-[220px]"
                                        />
                                    </div>
                                </div>

                                <p className="text-2xs text-muted-foreground">
                                    Times are yours, stored in UTC. The discount starts and ends on its own —
                                    there is nothing to switch off afterwards.
                                </p>
                            </div>
                        ),
                    },
                    {
                        id: "preview",
                        title: "Preview",
                        validate: () =>
                            preview && preview.count > 0 ? true : "Generate a preview before continuing.",
                        content: (
                            <div className="space-y-3">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={runPreview}
                                    disabled={pending}
                                    className="h-7 text-xs"
                                >
                                    {pending ? "Calculating…" : preview ? "Recalculate" : "Generate preview"}
                                </Button>

                                {!preview ? (
                                    <EmptyState
                                        variant="no-data"
                                        title="Nothing previewed yet"
                                        description="Generate a preview to see exactly which products change price, and by how much."
                                    />
                                ) : (
                                    <PreviewTable preview={preview} />
                                )}
                            </div>
                        ),
                    },
                ]}
                commitSummary={{
                    title: `Discount ${preview?.count ?? 0} product${preview?.count === 1 ? "" : "s"}?`,
                    description: `The storefront shows the reduced price from ${formatWindow(fromLocalInput(startsAt))} until ${formatWindow(fromLocalInput(endsAt))}, and goes back to normal on its own.`,
                    confirmLabel: "Start the discount",
                    impact: {
                        affectedCount: preview?.count ?? 0,
                        financialImpact: preview?.totalSaving,
                        sideEffects: [
                            preview
                                ? `Catalogue total moves from ${preview.baseTotal} to ${preview.newTotal} while it runs`
                                : "",
                            "Base prices are not changed — the discount is removed by time, not by an edit",
                            preview && preview.overlapping.length > 0
                                ? `${preview.overlapping.length} product(s) already have an equal or better discount and will not change`
                                : "",
                            "Orders already placed keep the price they recorded",
                        ].filter(Boolean),
                    },
                }}
                onCommit={commit}
            />
        </div>
    )
}

function ProductPicker({
    products,
    total,
    selected,
    search,
    onSearch,
    onToggle,
    onClear,
}: {
    products: ProductOption[]
    total: number
    selected: string[]
    search: string
    onSearch: (value: string) => void
    onToggle: (id: string) => void
    onClear: () => void
}) {
    return (
        <div className="max-w-[520px] space-y-2">
            <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                    <Label htmlFor="product-search" className="text-xs">
                        Find products by SKU or name
                    </Label>
                    <Input
                        id="product-search"
                        value={search}
                        placeholder="NL-1234, spotlight…"
                        onChange={(event) => onSearch(event.target.value)}
                    />
                </div>
                {selected.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>
                        Clear {selected.length}
                    </Button>
                )}
            </div>

            <div className="max-h-[280px] overflow-auto rounded-md border border-border-strong">
                {products.length === 0 ? (
                    <EmptyState variant="no-results" title="No product matches that" />
                ) : (
                    <ul>
                        {products.map((product) => {
                            const checked = selected.includes(product.id)
                            return (
                                <li key={product.id} className="border-b last:border-b-0">
                                    <label className="flex h-[34px] cursor-pointer items-center gap-2.5 px-2.5 hover:bg-accent/40">
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => onToggle(product.id)}
                                            aria-label={`${product.sku} ${product.name}`}
                                        />
                                        <span className="w-[110px] shrink-0 font-mono text-xs">{product.sku}</span>
                                        <span className="min-w-0 flex-1 truncate text-sm">{product.name}</span>
                                    </label>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>

            <p className="text-2xs text-muted-foreground">
                {selected.length} selected. Showing {products.length} of {total} — search to narrow the list.
            </p>
        </div>
    )
}

function PreviewTable({ preview }: { preview: DiscountPreview }) {
    return (
        <div className="space-y-2">
            <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border-strong bg-surface-sunk px-3 py-2 text-xs">
                <div className="flex items-baseline gap-1.5">
                    <dt className="text-muted-foreground">Products</dt>
                    <dd className="font-medium tabular-nums">{preview.count}</dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <dt className="text-muted-foreground">Total now</dt>
                    <dd>
                        <Money value={preview.baseTotal} />
                    </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <dt className="text-muted-foreground">While discounted</dt>
                    <dd className="font-medium">
                        <Money value={preview.newTotal} />
                    </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <dt className="text-muted-foreground">Comes off</dt>
                    <dd className="font-medium">
                        <Money value={preview.totalSaving} />
                    </dd>
                </div>
            </dl>

            {preview.clamped.length > 0 && (
                <p role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger">
                    {preview.clamped.length} product{preview.clamped.length === 1 ? "" : "s"} cost less than that
                    discount takes off, and the discount will be refused:{" "}
                    <span className="font-mono">{preview.clamped.slice(0, 5).map((row) => row.sku).join(", ")}</span>
                </p>
            )}

            {preview.overlapping.length > 0 && (
                <InlineAlert tone="info" title="Some of these already have a better discount">
                    {preview.overlapping.length} product
                    {preview.overlapping.length === 1 ? " is" : "s are"} already covered by a discount that takes
                    off as much or more. Discounts never stack — those products keep the better price.
                </InlineAlert>
            )}

            <div className="max-h-[420px] overflow-auto rounded-md border border-border-strong">
                <table className="w-full border-collapse text-left">
                    <caption className="sr-only">Prices while the discount runs, {preview.count} products</caption>
                    <thead className="sticky top-0 bg-surface-sunk">
                        <tr className="h-8 border-b border-border-strong">
                            <Th>SKU</Th>
                            <Th>Product</Th>
                            <Th className="text-right">Normally</Th>
                            <Th className="text-right">While discounted</Th>
                            <Th className="text-right">Comes off</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {preview.rows.map((row) => (
                            <tr key={row.productId} className="h-[34px] border-b">
                                <td className="px-2.5 font-mono text-xs">{row.sku}</td>
                                <td className="max-w-[280px] px-2.5 text-sm">
                                    <CellText>{row.name}</CellText>
                                    {row.supersededBy && (
                                        <span className="ml-1.5 text-2xs text-muted-foreground">
                                            (keeps “{row.supersededBy}”)
                                        </span>
                                    )}
                                </td>
                                <td className="px-2.5 text-right text-sm text-muted-foreground">
                                    <Money value={row.basePrice} />
                                </td>
                                <td className="px-2.5 text-right text-sm font-medium">
                                    <Money value={row.newPrice} />
                                </td>
                                <td className="px-2.5 text-right text-sm">
                                    <Money value={row.saving} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
