import { prisma, OPENING_COUNT_PENDING_KEY } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { InventoryService } from "@/lib/services/inventory-service"
import { BulkReceipt, OpeningStocktake } from "./inventory-client"
import { StockTable } from "./stock-table"
import { InlineAlert, PageBody, PageHeader, PageStack, Panel, Section, Stat, StatGrid } from "@/components/page"
import { parseTableState } from "@/lib/table-params"

export const metadata = { title: "Inventory" }

export const dynamic = "force-dynamic"

export default async function InventoryPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    await requireCurrentAdmin()
    const params = await searchParams

    const state = parseTableState(params, { sort: "available", dir: "asc", pageSize: 50 })

    const [lowStockCount, reports, openingFlag, products, withoutCost, stock] = await Promise.all([
        InventoryService.lowStockCount(10),
        InventoryService.valuationAndMargin(30),
        prisma.systemSetting.findUnique({ where: { key: OPENING_COUNT_PENDING_KEY }, select: { value: true } }),
        prisma.product.findMany({
            where: { deletedAt: null },
            select: { id: true, productId: true, averageCost: true },
            orderBy: { productId: "asc" },
        }),
        prisma.product.count({ where: { deletedAt: null, averageCost: null } }),
        InventoryService.stockLevels({
            search: state.filters.q,
            filter: state.filters.filter,
            status: state.filters.status,
            cost: state.filters.cost,
            sort: state.sort,
            dir: state.dir,
            skip: (state.page - 1) * state.pageSize,
            take: state.pageSize,
        }),
    ])

    const openingPending = openingFlag?.value === "true"

    const unavailableReason = (reason: string | undefined) =>
        reason === "opening-count-pending" ? "opening count pending" : "cost not recorded"

    return (
        <>
            <PageHeader
                title="Inventory"
                description="Stock levels come from the ledger, not from a column anybody edits. Valuation and margin refuse to produce a number until there is a cost behind it."
            />

            <PageBody>
                <PageStack>
                    {openingPending && (
                        <InlineAlert
                            tone="warning"
                            title="Opening count still pending"
                            action={<OpeningStocktake />}
                        >
                            Stock levels came across from the migration as an opening balance nobody has physically
                            counted. Until a real stocktake closes it, valuation and margin refuse to produce a number
                            rather than produce a wrong one.
                        </InlineAlert>
                    )}

                    <StatGrid>
                        <Stat
                            label="Stock valuation"
                            {...(reports.valuation.available
                                ? { value: reports.valuation.value }
                                : { unavailable: unavailableReason(reports.valuation.reason) })}
                        />
                        <Stat
                            label="Gross margin"
                            hint="last 30 days"
                            {...(reports.margin.available
                                ? { value: reports.margin.value }
                                : { unavailable: unavailableReason(reports.margin.reason) })}
                        />
                        <Stat
                            label="Low stock"
                            value={lowStockCount}
                            hint="fewer than 10 available"
                            href="/admin/inventory?filter=low"
                            tone={lowStockCount > 0 ? "warning" : "default"}
                        />
                        <Stat
                            label="Products with no cost"
                            value={withoutCost}
                            hint={withoutCost > 0 ? "blocks margin reporting" : "every product costed"}
                            href="/admin/inventory?cost=missing"
                            tone={withoutCost > 0 ? "warning" : "default"}
                        />
                    </StatGrid>

                    <Section
                        title="Stock levels"
                        description="Every product, at the main location. Available is on hand minus reservations — the number a customer can actually be sold. Stock is only ever changed through the ledger, so a row opens the product's inventory tab rather than an editable field."
                    >
                        <Panel padded={false}>
                            <StockTable
                                rows={stock.rows}
                                total={stock.total}
                                openingCountPending={openingPending}
                                state={state}
                            />
                        </Panel>
                    </Section>

                    <Section
                        id="bulk-cost-entry"
                        title="Bulk cost entry"
                        description={
                            <>
                                One row per product: SKU, quantity, unit cost. Every row becomes a purchase receipt in
                                the ledger, and the unit costs are what make margin reporting possible at all. A blank
                                cost means <em>not recorded</em> — never zero.
                            </>
                        }
                    >
                        <BulkReceipt
                            products={products.map((p) => ({
                                id: p.id,
                                sku: p.productId,
                                hasCost: p.averageCost !== null,
                            }))}
                        />
                    </Section>
                </PageStack>
            </PageBody>
        </>
    )
}
