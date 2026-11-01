import { ContactFormStatus, ContactPriority, Prisma, prisma } from "@repo/database"

import { requireCurrentAdmin } from "@/lib/auth"
import { toPrismaPage, type TableState } from "@/lib/table-params"

export const CONTACT_SORT_COLUMNS = ["createdAt", "fullName", "status", "priority"] as const
export type ContactSortColumn = (typeof CONTACT_SORT_COLUMNS)[number]

export interface ContactRow {
    id: string
    fullName: string
    jobPosition: string
    email: string
    phoneNumber: string
    /** First PREVIEW_CHARS of the message, cut in SQL. The full text comes from `getMessage` when a row is opened. */
    preview: string | null
    status: ContactFormStatus
    priority: ContactPriority
    isRead: boolean
    source: string
    responses: number
    createdAt: string
}

export interface ContactListResult {
    rows: ContactRow[]
    total: number
    unread: number
    stale: number
    urgent: number
}

function buildWhere(state: TableState): Prisma.ContactFormWhereInput {
    const { filters } = state
    const and: Prisma.ContactFormWhereInput[] = []

    const query = filters.q?.trim()
    if (query) {
        and.push({
            OR: [
                { fullName: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
                { phoneNumber: { contains: query } },
                { jobPosition: { contains: query, mode: "insensitive" } },
                { message: { contains: query, mode: "insensitive" } },
            ],
        })
    }

    if (filters.status && filters.status in ContactFormStatus) {
        and.push({ status: filters.status as ContactFormStatus })
    }
    if (filters.priority && filters.priority in ContactPriority) {
        and.push({ priority: filters.priority as ContactPriority })
    }
    if (filters.read === "unread") and.push({ isRead: false })
    if (filters.read === "read") and.push({ isRead: true })

    return and.length > 0 ? { AND: and } : {}
}

function buildOrderBy(state: TableState): Prisma.ContactFormOrderByWithRelationInput[] {
    switch (state.sort as ContactSortColumn | null) {
        case "fullName":
            return [{ fullName: state.dir }]
        case "status":
            return [{ status: state.dir }, { createdAt: "desc" }]
        case "priority":
            return [{ priority: state.dir }, { createdAt: "desc" }]
        case "createdAt":
        default:
            return [{ createdAt: state.dir }]
    }
}

export const PREVIEW_CHARS = 160

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

export class ContactService {
    static async list(state: TableState): Promise<ContactListResult> {
        await requireCurrentAdmin()
        const where = buildWhere(state)

        const [total, unread, stale, urgent] = await Promise.all([
            prisma.contactForm.count({ where }),
            prisma.contactForm.count({ where: { isRead: false } }),
            prisma.contactForm.count({
                where: { isRead: false, createdAt: { lt: new Date(Date.now() - THREE_DAYS_MS) } },
            }),
            prisma.contactForm.count({
                where: { priority: ContactPriority.URGENT, status: { notIn: [ContactFormStatus.CLOSED, ContactFormStatus.SPAM] } },
            }),
        ])

        const { skip, take } = toPrismaPage(state, total)

        const forms = await prisma.contactForm.findMany({
            where,
            skip,
            take,
            orderBy: buildOrderBy(state),
            select: {
                id: true,
                fullName: true,
                jobPosition: true,
                email: true,
                phoneNumber: true,
                status: true,
                priority: true,
                isRead: true,
                source: true,
                createdAt: true,
                _count: { select: { responses: true } },
            },
        })

        // The message column is left out of the row query above so the full text never leaves the
        // database for list rows; this reads only the first PREVIEW_CHARS of it for the rows on the page.
        const ids = forms.map((form) => form.id)
        const previews =
            ids.length === 0
                ? []
                : await prisma.$queryRaw<Array<{ id: string; preview: string | null }>>(
                      Prisma.sql`
                          SELECT id, left(message, ${PREVIEW_CHARS}::int) AS preview
                          FROM contact_forms
                          WHERE id = ANY(${ids}::text[])`
                  )
        const previewById = new Map(previews.map((row) => [row.id, row.preview]))

        return {
            rows: forms.map((form) => ({
                id: form.id,
                fullName: form.fullName,
                jobPosition: form.jobPosition,
                email: form.email,
                phoneNumber: form.phoneNumber,
                preview: previewById.get(form.id) ?? null,
                status: form.status,
                priority: form.priority,
                isRead: form.isRead,
                source: form.source,
                responses: form._count.responses,
                createdAt: form.createdAt.toISOString(),
            })),
            total,
            unread,
            stale,
            urgent,
        }
    }

    /** The full message of one enquiry; the list only carries a preview. */
    static async getMessage(id: string): Promise<string | null> {
        await requireCurrentAdmin()
        const form = await prisma.contactForm.findUnique({ where: { id }, select: { message: true } })
        return form?.message ?? null
    }
}
