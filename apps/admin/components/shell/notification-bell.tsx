"use client"

import Link from "next/link"
import { useEffect, useState, useSyncExternalStore } from "react"
import { formatDistanceToNowStrict } from "date-fns"
import {
    AlertTriangle,
    Bell,
    BellOff,
    CheckCheck,
    Mail,
    PackageMinus,
    ShoppingCart,
    Volume2,
    VolumeX,
    XCircle,
} from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useNotifications, type AdminNotification } from "@/hooks/use-notifications"
import { playChime, setSoundEnabled, soundEnabled, subscribeSound } from "@/lib/chime"
import { currentPushStatus, disablePush, enablePush, type PushState } from "@/lib/push-client"
import { cn } from "@/lib/utils"
import type { NotificationType } from "@/types"

const ICONS: Record<NotificationType, typeof Bell> = {
    NEW_ORDER: ShoppingCart,
    ORDER_CANCELLED: XCircle,
    NEW_CONTACT_FORM: Mail,
    LOW_INVENTORY: PackageMinus,
    SYSTEM_ALERT: AlertTriangle,
    CUSTOM: Bell,
}

const ACCENT: Record<NotificationType, string> = {
    NEW_ORDER: "border-success-border bg-success-bg text-success",
    ORDER_CANCELLED: "border-danger-border bg-danger-bg text-danger",
    LOW_INVENTORY: "border-warning-border bg-warning-bg text-warning",
    SYSTEM_ALERT: "border-warning-border bg-warning-bg text-warning",
    NEW_CONTACT_FORM: "border-info-border bg-info-bg text-info",
    CUSTOM: "border-neutral-border bg-neutral-bg text-neutral",
}

export function NotificationBell() {
    const [open, setOpen] = useState(false)
    const { notifications, unreadCount, isLoading, markRead, markAllRead } = useNotifications()

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={
                        unreadCount > 0
                            ? `Notifications, ${unreadCount} unread`
                            : "Notifications, none unread"
                    }
                    className={cn(
                        "relative grid size-7 shrink-0 place-items-center rounded-md border border-border-strong bg-background",
                        "text-muted-foreground transition-colors duration-(--duration-fast)",
                        "hover:bg-accent hover:text-foreground"
                    )}
                >
                    <Bell aria-hidden className="size-3.5" />
                    {unreadCount > 0 && (
                        <span
                            aria-hidden
                            className={cn(
                                "absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full px-1",
                                "bg-destructive text-2xs/4 font-semibold text-destructive-foreground tabular-nums"
                            )}
                        >
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent align="end" sideOffset={6} className="w-[22rem] p-0">
                <header className="flex items-center justify-between border-b px-3 py-2">
                    <h2 className="text-xs font-semibold">Notifications</h2>
                    {unreadCount > 0 && (
                        <button
                            type="button"
                            onClick={() => markAllRead()}
                            className="flex items-center gap-1 text-2xs text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground"
                        >
                            <CheckCheck aria-hidden className="size-3" />
                            Mark all read
                        </button>
                    )}
                </header>

                <div className="max-h-80 overflow-y-auto overscroll-contain">
                    {isLoading ? (
                        <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
                    ) : notifications.length === 0 ? (
                        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                            Nothing yet. New orders, cancellations, enquiries and low stock land here.
                        </p>
                    ) : (
                        <ul className="divide-y">
                            {notifications.map((notification) => (
                                <NotificationRow
                                    key={notification.id}
                                    notification={notification}
                                    onOpen={() => {
                                        if (!notification.isRead) markRead([notification.id])
                                        setOpen(false)
                                    }}
                                />
                            ))}
                        </ul>
                    )}
                </div>

                <ChannelControls />
            </PopoverContent>
        </Popover>
    )
}

function NotificationRow({ notification, onOpen }: { notification: AdminNotification; onOpen: () => void }) {
    const Icon = ICONS[notification.type] ?? Bell

    const body = (
        <>
            <span
                aria-hidden
                className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border",
                    ACCENT[notification.type] ?? "border-neutral-border bg-neutral-bg text-neutral"
                )}
            >
                <Icon className="size-3" />
            </span>

            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                    <span className={cn("truncate text-xs", notification.isRead ? "font-normal" : "font-semibold")}>
                        {notification.title}
                    </span>
                    <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular-nums">
                        {relativeTime(notification.createdAt)}
                    </span>
                </span>
                <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground">{notification.message}</span>
            </span>

            {!notification.isRead && (
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            )}
        </>
    )

    const className = cn(
        "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-(--duration-fast)",
        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        !notification.isRead && "bg-primary/[0.03]"
    )

    return (
        <li>
            {notification.actionUrl ? (
                <Link href={notification.actionUrl} onClick={onOpen} className={className}>
                    {body}
                </Link>
            ) : (
                <button type="button" onClick={onOpen} className={className}>
                    {body}
                </button>
            )}
        </li>
    )
}

function ChannelControls() {
    const [push, setPush] = useState<{ state: PushState; reason?: string }>({ state: "off" })
    const [busy, setBusy] = useState(false)
    const sound = useSyncExternalStore(subscribeSound, soundEnabled, () => false)

    useEffect(() => {
        void currentPushStatus().then(setPush)
    }, [])

    const unavailable = push.state === "unsupported" || push.state === "unconfigured" || push.state === "denied"

    return (
        <footer className="space-y-1 border-t px-3 py-2">
            <button
                type="button"
                disabled={busy || unavailable}
                onClick={async () => {
                    setBusy(true)
                    try {
                        setPush(push.state === "on" ? await disablePush() : await enablePush())
                    } finally {
                        setBusy(false)
                    }
                }}
                className={cn(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-2xs transition-colors duration-(--duration-fast)",
                    unavailable ? "cursor-not-allowed" : "hover:bg-accent"
                )}
            >
                {push.state === "on" ? (
                    <Bell aria-hidden className="size-3 text-primary" />
                ) : (
                    <BellOff aria-hidden className="size-3 text-muted-foreground" />
                )}
                <span className="flex-1 text-left">
                    Browser notifications
                    <span className="block text-muted-foreground">
                        {push.reason ?? (push.state === "on" ? "On — alerts arrive with the panel closed" : "Off — click to enable")}
                    </span>
                </span>
            </button>

            <button
                type="button"
                onClick={() => {
                    const next = !sound
                    setSoundEnabled(next)
                    if (next) playChime()
                }}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-2xs transition-colors duration-(--duration-fast) hover:bg-accent"
            >
                {sound ? (
                    <Volume2 aria-hidden className="size-3 text-primary" />
                ) : (
                    <VolumeX aria-hidden className="size-3 text-muted-foreground" />
                )}
                <span className="flex-1 text-left">
                    Sound
                    <span className="block text-muted-foreground">
                        {sound ? "On — chimes while this tab is open" : "Off"}
                    </span>
                </span>
            </button>
        </footer>
    )
}

function relativeTime(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ""
    return formatDistanceToNowStrict(date)
        .replace(/ seconds?/, "s")
        .replace(/ minutes?/, "m")
        .replace(/ hours?/, "h")
        .replace(/ days?/, "d")
        .replace(/ months?/, "mo")
        .replace(/ years?/, "y")
}
