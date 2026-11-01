"use client"

import { useCallback, useEffect, useRef } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { playChime } from "@/lib/chime"
import type { NotificationPriority, NotificationType } from "@/types"

export interface AdminNotification {
    id: string
    type: NotificationType
    title: string
    message: string
    actionUrl: string | null
    isRead: boolean
    priority: NotificationPriority
    createdAt: string
}

interface NotificationsResponse {
    notifications: AdminNotification[]
    unreadCount: number
}

const KEY = ["admin", "notifications"] as const

// Web Push delivers the real-time alert; the poll is only the fallback that keeps the list honest.
export function useNotifications(pollMs = 60_000) {
    const queryClient = useQueryClient()

    const query = useQuery({
        queryKey: KEY,
        queryFn: async (): Promise<NotificationsResponse> => {
            const response = await fetch("/api/notifications?limit=30", { cache: "no-store" })
            if (!response.ok) throw new Error("failed to load notifications")
            return response.json()
        },
        // No polling at all while the tab is hidden; coming back to it refetches (window focus).
        refetchInterval: pollMs,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        staleTime: 30_000,
        retry: 2,
    })

    const seen = useRef<Set<string> | null>(null)

    useEffect(() => {
        const notifications = query.data?.notifications
        if (!notifications) return

        if (seen.current === null) {
            seen.current = new Set(notifications.map((n) => n.id))
            return
        }

        const fresh = notifications.filter((n) => !seen.current!.has(n.id) && !n.isRead)
        for (const n of notifications) seen.current.add(n.id)

        if (fresh.length > 0 && document.visibilityState === "visible") playChime()
    }, [query.data])

    useEffect(() => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
        const onMessage = (event: MessageEvent) => {
            if (event.data?.type === "notification") void queryClient.invalidateQueries({ queryKey: KEY })
        }
        navigator.serviceWorker.addEventListener("message", onMessage)
        return () => navigator.serviceWorker.removeEventListener("message", onMessage)
    }, [queryClient])

    const markRead = useMutation({
        mutationFn: async (input: { notificationIds?: string[]; markAllAsRead?: boolean }) => {
            const response = await fetch("/api/notifications", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            })
            if (!response.ok) throw new Error("failed to update notifications")
        },
        onMutate: async (input) => {
            await queryClient.cancelQueries({ queryKey: KEY })
            const previous = queryClient.getQueryData<NotificationsResponse>(KEY)
            if (previous) {
                const ids = new Set(input.notificationIds ?? [])
                const next = previous.notifications.map((n) =>
                    input.markAllAsRead || ids.has(n.id) ? { ...n, isRead: true } : n
                )
                queryClient.setQueryData<NotificationsResponse>(KEY, {
                    notifications: next,
                    unreadCount: next.filter((n) => !n.isRead).length,
                })
            }
            return { previous }
        },
        onError: (_error, _input, context) => {
            if (context?.previous) queryClient.setQueryData(KEY, context.previous)
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
    })

    const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: KEY }), [queryClient])

    return {
        notifications: query.data?.notifications ?? [],
        unreadCount: query.data?.unreadCount ?? 0,
        isLoading: query.isLoading,
        isError: query.isError,
        refresh,
        markRead: (ids: string[]) => markRead.mutate({ notificationIds: ids }),
        markAllRead: () => markRead.mutate({ markAllAsRead: true }),
    }
}
