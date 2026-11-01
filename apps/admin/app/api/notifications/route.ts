import { requireCurrentAdmin } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { NotificationType, prisma, type Prisma } from "@repo/database"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function parseLimit(raw: string | null): number {
    const parsed = Number.parseInt(raw ?? "", 10)
    if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
    return Math.min(MAX_LIMIT, Math.max(1, parsed))
}

const patchSchema = z
    .object({
        notificationIds: z.array(z.string().min(1).max(64)).max(100).optional(),
        markAllAsRead: z.boolean().optional(),
    })
    .strict()

export async function GET(request: NextRequest) {
    try {
        const admin = await requireCurrentAdmin()
        const userId = admin.id

        const searchParams = request.nextUrl.searchParams
        const isRead = searchParams.get("isRead")
        const type = searchParams.get("type")
        const limit = parseLimit(searchParams.get("limit"))

        const live = { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }

        const where: Prisma.NotificationWhereInput = { ...live }
        if (isRead !== null) where.isRead = isRead === "true"
        if (type) {
            const parsedType = z.enum(NotificationType).safeParse(type)
            if (!parsedType.success) return NextResponse.json({ error: "Unknown notification type" }, { status: 400 })
            where.type = parsedType.data
        }

        const [notifications, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                    id: true,
                    type: true,
                    title: true,
                    message: true,
                    actionUrl: true,
                    isRead: true,
                    priority: true,
                    createdAt: true,
                },
            }),
            prisma.notification.count({ where: { ...live, isRead: false } }),
        ])

        return NextResponse.json({
            notifications,
            unreadCount,
        })
    } catch (error) {
        logger.error({ err: error }, "notifications could not be read")
        return NextResponse.json(
            { error: "Failed to fetch notifications" },
            { status: 500 }
        )
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const admin = await requireCurrentAdmin()
        const userId = admin.id

        const parsed = patchSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
        }
        const { notificationIds, markAllAsRead } = parsed.data

        if (markAllAsRead) {
            await prisma.notification.updateMany({
                where: { userId, isRead: false },
                data: { isRead: true, readAt: new Date() },
            })
        } else if (notificationIds && notificationIds.length > 0) {
            await prisma.notification.updateMany({
                where: { id: { in: notificationIds }, userId },
                data: { isRead: true, readAt: new Date() },
            })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        logger.error({ err: error }, "notifications could not be updated")
        return NextResponse.json(
            { error: "Failed to update notifications" },
            { status: 500 }
        )
    }
}
