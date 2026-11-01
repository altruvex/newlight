import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"

let db: TestDatabase

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock("@repo/database", async () => {
    const actual = await vi.importActual<typeof import("@repo/database")>("@repo/database")
    return {
        ...actual,
        get prisma() {
            return holder.client
        },
    }
})

beforeAll(async () => {
    db = await createTestDatabase()
    holder.client = db.prisma
})
afterAll(async () => db?.drop())
beforeEach(async () => {
    await db.prisma.adminAuditLog.deleteMany()
})

async function service() {
    return (await import("@/lib/services/audit-service")).AuditService
}

describe("the audit list", () => {
    it("inlines small diffs, withholds big ones, and loads a big one on demand", async () => {
        const AuditService = await service()
        const base = { actorType: "ADMIN" as const, action: "x", entity: "Product", entityId: "p1" }
        const none = await db.prisma.adminAuditLog.create({ data: base })
        const small = await db.prisma.adminAuditLog.create({ data: { ...base, diff: { from: "1", to: "2" } } })
        const changes = Array.from({ length: 200 }, (_, i) => ({ sku: `SKU-${i}`, from: "100.00", to: "110.00" }))
        const big = await db.prisma.adminAuditLog.create({ data: { ...base, diff: { changes } } })

        const { rows } = await AuditService.list()
        const byId = new Map(rows.map((row) => [row.id, row]))

        expect(byId.get(none.id)).toMatchObject({ hasDiff: false, diff: null })
        expect(byId.get(small.id)).toMatchObject({ hasDiff: true, diff: { from: "1", to: "2" } })
        expect(byId.get(big.id)).toMatchObject({ hasDiff: true, diff: null })

        expect(await AuditService.diffById(big.id)).toEqual({ changes })
        expect(await AuditService.diffById("missing")).toBeNull()
    })
})
