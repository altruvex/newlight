import { unstable_cache } from "next/cache"
import { prisma, Prisma } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"

export interface AuditFilters {
    action?: string
    entity?: string
    entityId?: string
    actorEmail?: string
    search?: string
    page?: number
}

export const AUDIT_PAGE_SIZE = 50

// A diff over this size (bytes of JSON text) is not sent with the list; the row loads it on "Show".
// One bulk reprice writes an entry per product, and the list shows 50 rows at a time.
const INLINE_DIFF_BYTES = 2048

// Filter-dropdown options only, so a few minutes of staleness is fine. Auth stays in
// AuditService.facets(): the cached function is shared by every admin.
const readFacets = unstable_cache(
    async () => {
        const [actions, entities, actors] = await Promise.all([
            prisma.adminAuditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
            prisma.adminAuditLog.groupBy({ by: ["entity"], _count: { _all: true }, orderBy: { entity: "asc" } }),
            prisma.adminAuditLog.groupBy({
                by: ["actorEmail"],
                _count: { _all: true },
                where: { actorEmail: { not: null } },
                orderBy: { actorEmail: "asc" },
            }),
        ])
        return {
            actions: actions.map((a) => ({ value: a.action, count: a._count._all })),
            entities: entities.map((e) => ({ value: e.entity, count: e._count._all })),
            actors: actors.map((a) => ({ value: a.actorEmail!, count: a._count._all })),
        }
    },
    ["audit-facets"],
    { revalidate: 600, tags: ["audit-facets"] }
)

export class AuditService {
    static async facets() {
        await requireCurrentAdmin()
        return readFacets()
    }

    /** The full diff of one entry, for the "Show" button on a row whose diff was too big to send with the list. */
    static async diffById(id: string) {
        await requireCurrentAdmin()
        const row = await prisma.adminAuditLog.findUnique({ where: { id }, select: { diff: true } })
        return row?.diff ?? null
    }

    static async list(filters: AuditFilters = {}) {
        await requireCurrentAdmin()
        const page = Math.max(1, filters.page ?? 1)

        const where: Prisma.AdminAuditLogWhereInput = {
            ...(filters.action ? { action: filters.action } : {}),
            ...(filters.entity ? { entity: filters.entity } : {}),
            ...(filters.entityId ? { entityId: filters.entityId } : {}),
            ...(filters.actorEmail ? { actorEmail: filters.actorEmail } : {}),
            ...(filters.search
                ? {
                      OR: [
                          { action: { contains: filters.search, mode: "insensitive" } },
                          { entityId: { contains: filters.search, mode: "insensitive" } },
                          { actorEmail: { contains: filters.search, mode: "insensitive" } },
                      ],
                  }
                : {}),
        }

        const [rows, total] = await Promise.all([
            prisma.adminAuditLog.findMany({
                where,
                select: {
                    id: true,
                    actorType: true,
                    actorId: true,
                    actorEmail: true,
                    action: true,
                    entity: true,
                    entityId: true,
                    ip: true,
                    createdAt: true,
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: (page - 1) * AUDIT_PAGE_SIZE,
                take: AUDIT_PAGE_SIZE,
            }),
            prisma.adminAuditLog.count({ where }),
        ])

        // The diff column is left out of the row query above. This one reads, for just these rows,
        // whether a diff exists and the diff itself only when it is small.
        const ids = rows.map((row) => row.id)
        const diffs =
            ids.length === 0
                ? []
                : await prisma.$queryRaw<Array<{ id: string; hasDiff: boolean; diff: Prisma.JsonValue | null }>>(
                      Prisma.sql`
                          SELECT id,
                                 (diff IS NOT NULL AND diff <> 'null'::jsonb) AS "hasDiff",
                                 CASE WHEN octet_length(diff::text) <= ${INLINE_DIFF_BYTES} THEN diff END AS diff
                          FROM admin_audit_log
                          WHERE id = ANY(${ids}::text[])`
                  )
        const diffById = new Map(diffs.map((d) => [d.id, d]))

        return {
            rows: rows.map((row) => {
                const d = diffById.get(row.id)
                return {
                    ...row,
                    createdAt: row.createdAt.toISOString(),
                    hasDiff: d?.hasDiff ?? false,
                    /** Present only when the diff is small; otherwise null and the client fetches it on demand. */
                    diff: d?.diff ?? null,
                }
            }),
            total,
            page,
            totalPages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
        }
    }

    static async forEntity(entity: string, entityId: string, limit = 100) {
        await requireCurrentAdmin()
        const rows = await prisma.adminAuditLog.findMany({
            where: { entity, entityId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit,
        })
        return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
    }

    static async summary() {
        await requireCurrentAdmin()
        const since = new Date(Date.now() - 24 * 3_600_000)
        const [today, week, actors] = await Promise.all([
            prisma.adminAuditLog.count({ where: { createdAt: { gte: since } } }),
            prisma.adminAuditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 3_600_000) } } }),
            prisma.adminAuditLog.groupBy({
                by: ["actorEmail"],
                where: { createdAt: { gte: since }, actorEmail: { not: null } },
            }),
        ])
        return { today, week, actorsToday: actors.length }
    }
}
