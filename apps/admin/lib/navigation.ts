import type { LucideIcon } from "lucide-react"
import {
    BadgePercent,
    Boxes,
    FolderTree,
    Gauge,
    Languages,
    Mail,
    Package,
    Palette,
    Ruler,
    ScrollText,
    ShieldCheck,
    ShoppingCart,
    Tags,
    Truck,
    Users,
} from "lucide-react"

import type { DashboardStats } from "@/types"

export interface NavSurface {
    label: string
    href: string
    icon: LucideIcon
    badge?: (stats: DashboardStats) => number | undefined
    badgeTone?: "neutral" | "attention"
    match?: string[]
    except?: string[]
}

export interface NavDomain {
    id: string
    label: string
    surfaces: NavSurface[]
}

export const OVERVIEW: NavSurface = {
    label: "Overview",
    href: "/admin/dashboard",
    icon: Gauge,
}

export const NAVIGATION: NavDomain[] = [
    {
        id: "catalog",
        label: "Catalog",
        surfaces: [
            {
                label: "Products",
                href: "/admin/products",
                icon: Package,
                badge: (s) => s.products,
                badgeTone: "neutral",
                except: ["/admin/products/pricing", "/admin/products/discounts"],
            },
            { label: "Categories", href: "/admin/taxonomy", icon: FolderTree },
            { label: "Specifications", href: "/admin/specs", icon: Ruler },
            { label: "Reference data", href: "/admin/reference", icon: Palette },
            {
                label: "Translations",
                href: "/admin/translations",
                icon: Languages,
                badge: (s) => (s.untranslated > 0 ? s.untranslated : undefined),
                badgeTone: "attention",
            },
        ],
    },
    {
        id: "pricing",
        label: "Pricing",
        surfaces: [
            { label: "Bulk repricing", href: "/admin/products/pricing", icon: Tags },
            { label: "Discounts", href: "/admin/products/discounts", icon: BadgePercent },
        ],
    },
    {
        id: "inventory",
        label: "Inventory",
        surfaces: [
            {
                label: "Stock levels",
                href: "/admin/inventory",
                icon: Boxes,
                badge: (s) => (s.lowStock > 0 ? s.lowStock : undefined),
                badgeTone: "attention",
            },
        ],
    },
    {
        id: "sales",
        label: "Sales",
        surfaces: [
            {
                label: "Orders",
                href: "/admin/orders",
                icon: ShoppingCart,
                badge: (s) => (s.orders > 0 ? s.orders : undefined),
                badgeTone: "attention",
            },
            {
                label: "Shipping",
                href: "/admin/shipping",
                icon: Truck,
                badge: (s) => (s.shipping > 0 ? s.shipping : undefined),
                badgeTone: "attention",
            },
            {
                label: "Customers",
                href: "/admin/users",
                icon: Users,
                badge: (s) => s.customers,
                badgeTone: "neutral",
            },
        ],
    },
    {
        id: "communication",
        label: "Communication",
        surfaces: [
            {
                label: "Contact forms",
                href: "/admin/contact",
                icon: Mail,
                badge: (s) => (s.contacts > 0 ? s.contacts : undefined),
                badgeTone: "attention",
            },
        ],
    },
    {
        id: "system",
        label: "System",
        surfaces: [
            { label: "Administrators", href: "/admin/team", icon: ShieldCheck },
            { label: "Audit log", href: "/admin/audit", icon: ScrollText },
        ],
    },
]

export const ALL_SURFACES: NavSurface[] = [OVERVIEW, ...NAVIGATION.flatMap((d) => d.surfaces)]

export function isSurfaceActive(surface: NavSurface, pathname: string): boolean {
    if (surface.except?.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return false
    if (pathname === surface.href) return true
    if (surface.match?.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return true
    return pathname.startsWith(`${surface.href}/`)
}

export function activeDomainId(pathname: string): string | undefined {
    return NAVIGATION.find((d) => d.surfaces.some((s) => isSurfaceActive(s, pathname)))?.id
}

export function activeSurface(pathname: string): NavSurface | undefined {
    return [...ALL_SURFACES]
        .sort((a, b) => b.href.length - a.href.length)
        .find((s) => isSurfaceActive(s, pathname))
}

export interface Crumb {
    label: string
    href?: string
}

const RECORD_SEGMENT_LABEL: Record<string, string> = {
    new: "New",
    pricing: "Bulk repricing",
    discounts: "Discounts",
    category: "Category",
    "sub-category": "Sub-category",
}

export function breadcrumbsFor(pathname: string, recordLabel?: string): Crumb[] {
    const surface = activeSurface(pathname)
    if (!surface) return [{ label: "Admin" }]

    const domain = NAVIGATION.find((d) => d.surfaces.includes(surface))
    const crumbs: Crumb[] = []
    if (domain) crumbs.push({ label: domain.label })
    crumbs.push({ label: surface.label, href: surface.href })

    const rest = pathname
        .slice(surface.href.length)
        .split("/")
        .filter(Boolean)
        .filter((segment) => segment !== "pricing")

    for (const [index, segment] of rest.entries()) {
        const last = index === rest.length - 1
        const known = RECORD_SEGMENT_LABEL[segment]
        if (known) {
            crumbs.push({ label: known })
            continue
        }
        if (last && recordLabel) {
            crumbs.push({ label: recordLabel })
            continue
        }
        crumbs.push({ label: /^c[a-z0-9]{20,}$/.test(segment) ? "Record" : segment })
    }

    return crumbs
}
