import { revalidatePath, revalidateTag } from "next/cache"

/**
 * Drops every cached storefront page and the shared `catalog` reads, so the next visitor
 * sees current stock. Product pages show the exact count left and cards show in/low/out,
 * so a reservation taken or released changes what they should say. The same purge the
 * admin's /api/revalidate call makes for `kind: "all"`, minus the sitemap, which has no stock.
 */
export function refreshShopStock() {
    revalidatePath("/[locale]/(main)", "layout")
    revalidateTag("catalog", { expire: 0 })
}
