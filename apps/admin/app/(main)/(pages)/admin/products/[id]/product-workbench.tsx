"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { TranslationPair, TranslationFields } from "@/lib/services/translation-service"
import type { DeletionBlockers } from "@/lib/services/catalog-service"
import type { SpecRow } from "@/lib/services/spec-service"
import type { ActionResult } from "@/app/action/catalog-actions"
import { ImagesPanel, type ColorOption, type ImageRow } from "./images-panel"
import { RecordLayout, type AuditEntry } from "@/components/record/record-layout"
import { BilingualField } from "@/components/bilingual-field"
import { ConfirmAction } from "@/components/confirm-action"
import { Stat, StatGrid } from "@/components/page"
import { Money } from "@/components/money"
import { deriveStockState } from "@/lib/status"
import {
    adjustStock,
    hardDeleteProduct,
    receiveStock,
    recordDamage,
    renameProduct,
    restoreProduct,
    saveProductSpecs,
    setProductPrice,
    saveTranslations,
    setProductActive,
    softDeleteProduct,
} from "@/app/action/catalog-actions"

interface Movement {
    id: string
    type: string
    quantity: number
    reason: string | null
    unitCost: string | null
    actorType: string | null
    createdAt: string
}

type PriceChange = { createdAt: Date; actorEmail: string | null; from: string; to: string; action: string }

interface Props {
    initialTab: "translations" | "images" | "inventory" | "price" | "specs" | "settings"
    productId: string
    sku: string
    slug: string
    isActive: boolean
    isArchived: boolean
    price: string
    averageCost: string | null
    onHand: number
    reserved: number
    translations: TranslationPair
    imageCount: number
    // Tab data: null unless that tab is the active one — the server loads only the active tab.
    blockers: DeletionBlockers | null
    movements: Movement[] | null
    priceHistory: PriceChange[] | null
    specs: SpecRow[] | null
    slugHistory: string[] | null
    images: ImageRow[] | null
    colors: ColorOption[] | null
    offeredColorIds: string[] | null

    categoryPath: string
    variantValue: string | null
    orderLineCount: number
    createdAt: string
    updatedAt: string
    audit: AuditEntry[]
}

function useAction() {
    const [pending, start] = useTransition()
    const call = (fn: () => Promise<ActionResult>) =>
        start(async () => {
            const result = await fn()
            if (result.ok) toast.success(result.message ?? "Saved.")
            else toast.error(result.error)
        })
    return { pending, call }
}

function TabLoading() {
    return <p className="text-sm text-muted-foreground">Loading…</p>
}

function AttentionDot({ label }: { label: string }) {
    return <span role="img" aria-label={label} className="size-1.5 rounded-full bg-warning" />
}

export function ProductWorkbench(props: Props) {
    const { pending, call } = useAction()

    const translationsIncomplete = (["en", "ar"] as const).some(
        (locale) => props.translations.completeness[locale].missing.length > 0
    )
    const available = props.onHand - props.reserved

    return (
        <RecordLayout
            title={props.sku}
            subtitle={props.categoryPath}
            identifiers={[
                { label: "Slug", value: `/${props.slug}` },
                ...(props.variantValue ? [{ label: "Variant", value: props.variantValue }] : []),
                { label: "Order lines", value: String(props.orderLineCount) },
            ]}
            status={{
                kind: "stock",
                value: deriveStockState({ onHand: props.onHand, reserved: props.reserved }),
            }}
            marks={
                <>
                    {props.isArchived ? (
                        <span className="inline-flex items-center rounded-md border border-danger-border bg-danger-bg px-1.5 py-0.5 text-2xs font-medium text-danger">
                            Archived
                        </span>
                    ) : props.isActive ? null : (
                        <span className="inline-flex items-center rounded-md border border-neutral-border bg-neutral-bg px-1.5 py-0.5 text-2xs font-medium text-neutral">
                            Hidden
                        </span>
                    )}
                    <span className="text-2xs tabular-nums text-muted-foreground">
                        {available} available · {props.onHand} on hand
                    </span>
                </>
            }
            actions={
                <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href="/admin/products">All products</Link>
                </Button>
            }
            defaultTab={props.initialTab}
            rail={{
                createdAt: props.createdAt,
                updatedAt: props.updatedAt,
                audit: props.audit,
                auditHref: `/admin/audit?entity=Product&entityId=${props.productId}`,
                extra: (
                    <dl className="space-y-1.5 text-2xs">
                        <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-muted-foreground">Price</dt>
                            <dd>
                                <Money value={props.price} />
                            </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-muted-foreground">Cost</dt>
                            <dd>
                                <Money value={props.averageCost} />
                            </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-muted-foreground">Photographs</dt>
                            <dd className="tabular-nums">{props.imageCount}</dd>
                        </div>
                    </dl>
                ),
            }}
            tabs={[
                {
                    id: "translations",
                    label: "Languages",
                    badge: translationsIncomplete ? <AttentionDot label="Incomplete" /> : undefined,
                    content: (
                        <TranslationEditor
                            productId={props.productId}
                            pair={props.translations}
                            pending={pending}
                            call={call}
                        />
                    ),
                },
                {
                    id: "images",
                    label: "Photos",
                    badge: props.imageCount === 0 ? <AttentionDot label="No photographs" /> : undefined,
                    content:
                        props.images && props.colors && props.offeredColorIds ? (
                            <ImagesPanel
                                productId={props.productId}
                                sku={props.sku}
                                images={props.images}
                                colors={props.colors}
                                offeredColorIds={props.offeredColorIds}
                            />
                        ) : (
                            <TabLoading />
                        ),
                },
                {
                    id: "inventory",
                    label: "Inventory",
                    content: props.movements ? (
                        <InventoryPanel {...props} movements={props.movements} pending={pending} call={call} />
                    ) : (
                        <TabLoading />
                    ),
                },
                {
                    id: "price",
                    label: "Pricing",
                    content: props.priceHistory ? (
                        <PricePanel {...props} priceHistory={props.priceHistory} pending={pending} call={call} />
                    ) : (
                        <TabLoading />
                    ),
                },
                {
                    id: "specs",
                    label: "Specifications",
                    content: props.specs ? (
                        <SpecsPanel productId={props.productId} specs={props.specs} pending={pending} call={call} />
                    ) : (
                        <TabLoading />
                    ),
                },
                {
                    id: "settings",
                    label: "Settings",
                    content:
                        props.blockers && props.slugHistory ? (
                            <SettingsPanel
                                {...props}
                                blockers={props.blockers}
                                slugHistory={props.slugHistory}
                                pending={pending}
                                call={call}
                            />
                        ) : (
                            <TabLoading />
                        ),
                },
            ]}
        />
    )
}

const FIELDS = [
    { key: "name", label: "Name", required: true },
    { key: "description", label: "Description", required: true },
    { key: "metaTitle", label: "Meta title", required: false },
    { key: "metaDescription", label: "Meta description", required: false },
] as const

function TranslationEditor({
    productId,
    pair,
    pending,
    call,
}: {
    productId: string
    pair: TranslationPair
    pending: boolean
    call: (fn: () => Promise<ActionResult>) => void
}) {
    const [values, setValues] = useState<Record<"en" | "ar", TranslationFields>>({
        en: { ...pair.locales.en },
        ar: { ...pair.locales.ar },
    })

    const set = (locale: "en" | "ar", field: keyof TranslationFields, value: string) =>
        setValues((v) => ({ ...v, [locale]: { ...v[locale], [field]: value === "" ? null : value } }))

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                call(() => saveTranslations(productId, values))
            }}
            className="max-w-[720px] space-y-4"
        >
            {FIELDS.map((field) => (
                <BilingualField
                    key={field.key}
                    label={field.label}
                    required={field.required ? "both" : "none"}
                    multiline={field.key === "description" || field.key === "metaDescription"}
                    rows={field.key === "description" ? 4 : 2}
                    en={{
                        value: values.en[field.key] ?? "",
                        onChange: (value) => set("en", field.key, value),
                        error:
                            field.required && !(values.en[field.key] ?? "").trim()
                                ? "Required in English."
                                : undefined,
                    }}
                    ar={{
                        value: values.ar[field.key] ?? "",
                        onChange: (value) => set("ar", field.key, value),
                        error:
                            field.required && !(values.ar[field.key] ?? "").trim()
                                ? "Required in Arabic. This renders as a gap on the Arabic storefront."
                                : undefined,
                    }}
                />
            ))}

            <Button type="submit" size="sm" disabled={pending} className="h-8 text-xs">
                {pending ? "Saving…" : "Save both languages"}
            </Button>
        </form>
    )
}

function InventoryPanel({
    productId,
    onHand,
    reserved,
    averageCost,
    movements,
    pending,
    call,
}: Props & { movements: Movement[]; pending: boolean; call: (fn: () => Promise<ActionResult>) => void }) {
    const [adjustQty, setAdjustQty] = useState("")
    const [adjustReason, setAdjustReason] = useState("")
    const [damageQty, setDamageQty] = useState("")
    const [damageReason, setDamageReason] = useState("")
    const [receiveQty, setReceiveQty] = useState("")
    const [receiveCost, setReceiveCost] = useState("")

    return (
        <div className="space-y-8">
            <StatGrid>
                <Stat label="On hand" value={onHand} />
                <Stat label="Reserved" value={reserved} hint="already committed to orders" />
                <Stat
                    label="Available"
                    value={onHand - reserved}
                    tone={onHand - reserved <= 0 ? "danger" : onHand - reserved < 10 ? "warning" : "default"}
                />
                <Stat
                    label="Average cost"
                    value={averageCost}
                    unavailable={averageCost ? undefined : "not recorded"}
                />
            </StatGrid>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <form
                    className="rounded-lg border bg-card p-3 space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault()
                        call(() => adjustStock(productId, Number(adjustQty), adjustReason))
                    }}
                >
                    <h2 className="font-semibold">Correction</h2>
                    <p className="text-xs text-muted-foreground">
                        Signed. <span className="font-mono">+3</span> found on a shelf,{" "}
                        <span className="font-mono">-2</span> miscounted.
                    </p>
                    <Input
                        aria-label="Adjustment quantity"
                        value={adjustQty}
                        onChange={(e) => setAdjustQty(e.target.value)}
                        placeholder="+3"
                        inputMode="numeric"
                    />
                    <Input
                        aria-label="Adjustment reason"
                        value={adjustReason}
                        onChange={(e) => setAdjustReason(e.target.value)}
                        placeholder="Reason (required)"
                        required
                    />
                    <Button type="submit" variant="secondary" disabled={pending} className="w-full">
                        Record correction
                    </Button>
                </form>

                <form
                    className="rounded-lg border bg-card p-3 space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault()
                        call(() => recordDamage(productId, Number(damageQty), damageReason))
                    }}
                >
                    <h2 className="font-semibold">Damage or loss</h2>
                    <p className="text-xs text-muted-foreground">
                        Its own movement type, so it stays countable instead of hiding inside corrections.
                    </p>
                    <Input
                        aria-label="Damaged units"
                        value={damageQty}
                        onChange={(e) => setDamageQty(e.target.value)}
                        placeholder="Units lost"
                        inputMode="numeric"
                    />
                    <Input
                        aria-label="Damage reason"
                        value={damageReason}
                        onChange={(e) => setDamageReason(e.target.value)}
                        placeholder="Reason (required)"
                        required
                    />
                    <Button type="submit" variant="secondary" disabled={pending} className="w-full">
                        Record damage
                    </Button>
                </form>

                <form
                    className="rounded-lg border bg-card p-3 space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault()
                        call(() => receiveStock(productId, Number(receiveQty), receiveCost, "purchase receipt"))
                    }}
                >
                    <h2 className="font-semibold">Goods in</h2>
                    <p className="text-xs text-muted-foreground">
                        Unit cost is optional and blank means <em>not recorded</em> — never zero. It is what makes
                        margin reporting possible at all.
                    </p>
                    <Input
                        aria-label="Received units"
                        value={receiveQty}
                        onChange={(e) => setReceiveQty(e.target.value)}
                        placeholder="Units received"
                        inputMode="numeric"
                    />
                    <Input
                        aria-label="Unit cost"
                        value={receiveCost}
                        onChange={(e) => setReceiveCost(e.target.value)}
                        placeholder="Unit cost (optional)"
                        inputMode="decimal"
                    />
                    <Button type="submit" disabled={pending} className="w-full">
                        Receive stock
                    </Button>
                </form>
            </div>

            <section>
                <h2 className="font-semibold mb-3">Movement history</h2>
                <div className="overflow-x-auto rounded-lg border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>When</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Unit cost</TableHead>
                                <TableHead>Reason</TableHead>
                                <TableHead>By</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {movements.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        No stock has moved yet.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                movements.map((m) => (
                                    <TableRow key={m.id}>
                                        <TableCell className="whitespace-nowrap tabular-nums">
                                            {new Date(m.createdAt).toLocaleString("en-GB")}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{m.type.toLowerCase().replace(/_/g, " ")}</Badge>
                                        </TableCell>
                                        <TableCell
                                            className={`text-right tabular-nums font-medium ${m.quantity < 0 ? "text-danger" : "text-success"}`}
                                        >
                                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{m.unitCost ?? "—"}</TableCell>
                                        <TableCell className="max-w-xs truncate">{m.reason ?? "—"}</TableCell>
                                        <TableCell className="text-muted-foreground">{m.actorType?.toLowerCase() ?? "—"}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </section>
        </div>
    )
}

function PricePanel({
    productId,
    sku,
    price,
    averageCost,
    priceHistory,
    pending,
    call,
}: Props & { priceHistory: PriceChange[]; pending: boolean; call: (fn: () => Promise<ActionResult>) => void }) {
    const [next, setNext] = useState(price)
    const margin =
        averageCost && Number(averageCost) > 0
            ? (((Number(price) - Number(averageCost)) / Number(price)) * 100).toFixed(1)
            : null

    return (
        <div className="space-y-6">
            <StatGrid className="md:grid-cols-3">
                <Stat label="Current price" value={price} />
                <Stat
                    label="Average cost"
                    value={averageCost}
                    unavailable={averageCost ? undefined : "not recorded"}
                />
                <Stat
                    label="Gross margin"
                    value={margin ? `${margin}%` : undefined}
                    unavailable={margin ? undefined : "cost not recorded"}
                />
            </StatGrid>

            <form
                className="rounded-lg border bg-card p-3 space-y-3 max-w-md"
                onSubmit={(e) => {
                    e.preventDefault()
                    call(() => setProductPrice(productId, next))
                }}
            >
                <h2 className="font-semibold">Change this price</h2>
                <p className="text-sm text-muted-foreground">
                    Saved through the same path as the bulk editor, so it appears in the history below with your name
                    on it. Orders already placed keep the price they were charged.
                </p>
                <div className="flex gap-2">
                    <Input
                        aria-label={`New price for ${sku}`}
                        inputMode="decimal"
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        className="tabular-nums"
                    />
                    <ConfirmAction
                        severity="consequential"
                        title={`Change ${sku} from ${price} to ${next}?`}
                        description="The storefront updates immediately."
                        confirmLabel="Change it"
                        impact={{
                            affectedCount: 1,
                            financialImpact: next,
                            sideEffects: [
                                `The listed price moves from ${price} to ${next}`,
                                "Orders already placed keep the price they recorded — this never rewrites what a customer was charged",
                                "The change is written to the audit trail with your name on it",
                            ],
                        }}
                        onConfirm={() => call(() => setProductPrice(productId, next))}
                    >
                        <Button
                            type="button"
                            size="sm"
                            disabled={pending || next === price || next.trim() === ""}
                            className="text-xs"
                        >
                            {pending ? "Saving…" : "Save"}
                        </Button>
                    </ConfirmAction>
                </div>
                <p className="text-xs text-muted-foreground">
                    Repricing a whole category at once is the{" "}
                    <Link href="/admin/products/pricing" className="underline underline-offset-4">
                        bulk editor
                    </Link>
                    .
                </p>
            </form>

            <section>
                <h2 className="font-semibold mb-3">Price history</h2>
                <div className="overflow-x-auto rounded-lg border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>When</TableHead>
                                <TableHead className="text-right">From</TableHead>
                                <TableHead className="text-right">To</TableHead>
                                <TableHead>By</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {priceHistory.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                        This price has not been changed through the admin panel.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                priceHistory.map((row, i) => (
                                    <TableRow key={`${row.createdAt}-${i}`}>
                                        <TableCell className="whitespace-nowrap tabular-nums">
                                            {new Date(row.createdAt).toLocaleString("en-GB")}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{row.from}</TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">{row.to}</TableCell>
                                        <TableCell className="text-muted-foreground">{row.actorEmail ?? "—"}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </section>
        </div>
    )
}

function SpecsPanel({
    productId,
    specs,
    pending,
    call,
}: {
    productId: string
    specs: SpecRow[]
    pending: boolean
    call: (fn: () => Promise<ActionResult>) => void
}) {
    const [values, setValues] = useState<Record<string, { valueEn: string; valueAr: string }>>(
        Object.fromEntries(specs.map((s) => [s.key, { valueEn: s.valueEn ?? "", valueAr: s.valueAr ?? "" }]))
    )

    const set = (key: string, field: "valueEn" | "valueAr", value: string) =>
        setValues((v) => ({ ...v, [key]: { ...(v[key] ?? { valueEn: "", valueAr: "" }), [field]: value } }))

    const dirty = specs.some(
        (spec) =>
            (values[spec.key]?.valueEn ?? "") !== (spec.valueEn ?? "") ||
            (values[spec.key]?.valueAr ?? "") !== (spec.valueAr ?? "")
    )

    if (specs.length === 0) {
        return (
            <p className="text-muted-foreground">
                This product&rsquo;s sub-category declares no specifications, and the product carries none.
            </p>
        )
    }

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                call(() =>
                    saveProductSpecs(
                        productId,
                        specs.map((spec) => ({
                            key: spec.key,
                            valueEn: values[spec.key]?.valueEn ?? "",
                            valueAr: values[spec.key]?.valueAr ?? "",
                        }))
                    )
                )
            }}
            className="space-y-4"
        >
            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={pending || !dirty}>
                    {pending ? "Saving…" : dirty ? "Save specifications" : "Saved"}
                </Button>
                <span className="text-sm text-muted-foreground">
                    Clearing both boxes removes the specification. Numbers, ranges and &ldquo;-&rdquo; are all accepted
                    as typed.
                </span>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-64">Specification</TableHead>
                            <TableHead>English</TableHead>
                            <TableHead>Arabic</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {specs.map((spec) => (
                            <TableRow key={spec.key}>
                                <TableCell className="align-top">
                                    <div className="font-medium">
                                        {spec.labelEn}
                                        {spec.unitEn ? (
                                            <span className="text-muted-foreground"> ({spec.unitEn})</span>
                                        ) : null}
                                    </div>
                                    <div className="text-sm text-muted-foreground" dir="rtl">
                                        {spec.labelAr}
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                        {spec.required && <Badge variant="secondary">required</Badge>}
                                        {!spec.declared && <Badge variant="outline">not declared here</Badge>}
                                        {spec.typeMismatch && (
                                            <Badge variant="destructive">stored as a boolean</Badge>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Input
                                        aria-label={`${spec.labelEn} in English`}
                                        value={values[spec.key]?.valueEn ?? ""}
                                        onChange={(e) => set(spec.key, "valueEn", e.target.value)}
                                        className={spec.valueType === "NUMBER" ? "tabular-nums" : undefined}
                                    />
                                </TableCell>
                                <TableCell>
                                    <Input
                                        aria-label={`${spec.labelEn} in Arabic`}
                                        dir="rtl"
                                        value={values[spec.key]?.valueAr ?? ""}
                                        onChange={(e) => set(spec.key, "valueAr", e.target.value)}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </form>
    )
}

function SettingsPanel({
    productId,
    slug,
    isActive,
    isArchived,
    blockers,
    slugHistory,
    pending,
    call,
}: Props & {
    blockers: DeletionBlockers
    slugHistory: string[]
    pending: boolean
    call: (fn: () => Promise<ActionResult>) => void
}) {
    const [nextSlug, setNextSlug] = useState(slug)
    const blockerTotal = blockers.orderItems + blockers.cartItems + blockers.configurations

    return (
        <div className="space-y-8 max-w-3xl">
            <section className="rounded-lg border bg-card p-3 space-y-3">
                <h2 className="font-semibold">Storefront visibility</h2>
                <p className="text-sm text-muted-foreground">
                    Hiding is instant and reversible. It does not archive the product or touch any order.
                </p>
                <Button
                    variant={isActive ? "secondary" : "default"}
                    disabled={pending || isArchived}
                    onClick={() => call(() => setProductActive(productId, !isActive))}
                >
                    {isActive ? "Hide from storefront" : "Show on storefront"}
                </Button>
                {isArchived && (
                    <p className="text-sm text-muted-foreground">Archived products cannot be shown; restore it first.</p>
                )}
            </section>

            <form
                className="rounded-lg border bg-card p-3 space-y-3"
                onSubmit={(e) => {
                    e.preventDefault()
                    call(() => renameProduct(productId, nextSlug))
                }}
            >
                <h2 className="font-semibold">URL</h2>
                <p className="text-sm text-muted-foreground">
                    The old address keeps working — renaming writes a redirect in the same transaction.
                </p>
                <Input value={nextSlug} onChange={(e) => setNextSlug(e.target.value)} aria-label="Product slug" />
                <Button type="submit" variant="secondary" disabled={pending || nextSlug === slug}>
                    Rename
                </Button>
                {slugHistory.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Redirecting here: {slugHistory.map((s) => `/${s}`).join(", ")}
                    </p>
                )}
            </form>

            <section className="rounded-lg border border-destructive/40 p-4 space-y-4">
                <h2 className="font-semibold text-destructive">Removal</h2>

                {isArchived ? (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">This product is archived.</p>
                        <Button variant="secondary" disabled={pending} onClick={() => call(() => restoreProduct(productId))}>
                            Restore
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                            Archiving hides it everywhere and keeps every order that mentions it readable. This is the
                            normal way to remove a product.
                        </p>
                        <ConfirmAction
                            severity="reversible"
                            title="Archive this product?"
                            description="It disappears from the storefront immediately. Nothing is destroyed and you can restore it from this page."
                            confirmLabel="Archive"
                            onConfirm={() => call(() => softDeleteProduct(productId))}
                        >
                            <Button variant="secondary" size="sm" disabled={pending} className="h-7 text-xs">
                                Archive
                            </Button>
                        </ConfirmAction>
                    </div>
                )}

                <div className="space-y-2 pt-2 border-t">
                    <p className="text-sm text-muted-foreground">
                        Permanent deletion removes the row. It is only possible while nothing refers to it.
                    </p>
                    <ConfirmAction
                        severity="destructive"
                        title={`Delete ${slug} permanently?`}
                        description="This cannot be undone. The product row, its translations, images and specs are removed. An audit entry records what was destroyed."
                        confirmLabel="Delete permanently"
                        typeToConfirm={slug}
                        blockedBy={
                            blockerTotal > 0
                                ? {
                                      reason: "Other records still refer to this product.",
                                      counts: [
                                          { label: "Order lines", count: blockers.orderItems },
                                          { label: "Cart items", count: blockers.cartItems },
                                          { label: "Configurations", count: blockers.configurations },
                                      ].filter((entry) => entry.count > 0),
                                  }
                                : undefined
                        }
                        impact={{
                            affectedCount: 1,
                            sideEffects: [
                                "Translations, images and specifications are removed with it",
                                "An audit entry records what was destroyed",
                            ],
                        }}
                        onConfirm={() => call(() => hardDeleteProduct(productId))}
                    >
                        <Button variant="destructive" size="sm" disabled={pending} className="h-7 text-xs">
                            Delete permanently
                        </Button>
                    </ConfirmAction>
                </div>
            </section>
        </div>
    )
}
