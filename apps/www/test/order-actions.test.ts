import { seedFixture, seedStock, type Fixture } from "@repo/database/test-fixtures"
import { createTestDatabase, type TestDatabase } from "@repo/database/test-harness"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

let db: TestDatabase
let fixture: Fixture
let otherUserId: string

const holder = vi.hoisted(() => ({ client: null as unknown, userId: null as string | null }))

vi.mock("@repo/database", async () => {
    const actual = await vi.importActual<typeof import("@repo/database")>("@repo/database")
    return {
        ...actual,
        get prisma() {
            return holder.client
        },
    }
})
vi.mock("@/lib/auth", () => ({
    currentUserId: async () => holder.userId,
    currentIdentity: async () => (holder.userId ? { id: holder.userId, email: "customer@newlight.invalid" } : null),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }))
vi.mock("@/lib/deliveries", () => ({ dispatchDeliveriesAfterResponse: () => undefined }))

const validAddress = {
    fullName: "Test Customer",
    phone: "01234567890",
    email: "customer@newlight.invalid",
    addressLine1: "12 Long Street Name, Nasr City",
    addressLine2: "",
    city: "Cairo",
    state: "Cairo",
    postalCode: "11511",
}

async function createConfiguration(productId: string, quantity: number, ownerId?: string) {
    return db.prisma.productConfiguration.create({
        data: {
            productId,
            productSku: "sku",
            configPrice: "150.00",
            totalPrice: "300.00",
            quantity,
            ...(ownerId ? { users: { connect: { id: ownerId } } } : {}),
        },
    })
}

beforeAll(async () => {
    db = await createTestDatabase()
    holder.client = db.prisma
    fixture = await seedFixture(db.prisma)
    otherUserId = (
        await db.prisma.user.create({ data: { email: "someone-else@newlight.invalid", name: "Other", emailVerified: true } })
    ).id
    await seedStock(db.prisma, fixture.products.small, 5)
})
afterAll(async () => db?.drop())
beforeEach(() => {
    holder.userId = fixture.userId
})

describe("shipping address actions", () => {
    it("refuses to save an address for a visitor who is not signed in", async () => {
        holder.userId = null
        const { saveShippingAddress } = await import("@/actions/order")
        expect(await saveShippingAddress("en", validAddress)).toEqual({ success: false, code: "UNAUTHENTICATED" })
        expect(await db.prisma.shippingAddress.count()).toBe(0)
    })

    it("rejects an address that fails the locale's schema, naming the field", async () => {
        const { saveShippingAddress } = await import("@/actions/order")
        const result = await saveShippingAddress("en", { ...validAddress, phone: "123" })
        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.code).toBe("INVALID_INPUT")
            expect(result.errors).toHaveProperty("phone")
        }
        expect(await db.prisma.shippingAddress.count()).toBe(0)
    })

    it("saves the address for the session user only, whatever the client claims", async () => {
        const { saveShippingAddress, getUserShippingAddress } = await import("@/actions/order")
        expect(await saveShippingAddress("en", validAddress)).toEqual({ success: true })

        const saved = await db.prisma.shippingAddress.findMany()
        expect(saved).toHaveLength(1)
        expect(saved[0]!.userId).toBe(fixture.userId)

        expect((await getUserShippingAddress())?.userId).toBe(fixture.userId)
        expect(await getUserShippingAddress(otherUserId)).toBeNull()
        holder.userId = null
        expect(await getUserShippingAddress()).toBeNull()
    })
})

describe("configuration access", () => {
    it("shows an unclaimed configuration to anyone, without the user relation", async () => {
        const config = await createConfiguration(fixture.products.small, 2)
        const { getConfiguration } = await import("@/actions/configuration")

        holder.userId = null
        const anonymous = await getConfiguration(config.id)
        expect(anonymous?.id).toBe(config.id)
        expect(anonymous).not.toHaveProperty("users")

        holder.userId = otherUserId
        expect((await getConfiguration(config.id))?.id).toBe(config.id)
    })

    it("hides a claimed configuration from everyone but its owner", async () => {
        const config = await createConfiguration(fixture.products.small, 2, fixture.userId)
        const { getConfiguration, updateConfigurationQuantity } = await import("@/actions/configuration")
        const { getConfigurationDetails } = await import("@/actions/order")

        expect((await getConfiguration(config.id))?.id).toBe(config.id)
        expect(await getConfigurationDetails(config.id)).not.toHaveProperty("users")

        holder.userId = otherUserId
        expect(await getConfiguration(config.id)).toBeNull()
        expect(await getConfigurationDetails(config.id)).toBeNull()
        expect(await updateConfigurationQuantity({ configId: config.id, quantity: 3 })).toMatchObject({
            success: false,
        })

        holder.userId = null
        expect(await getConfiguration(config.id)).toBeNull()

        const unchanged = await db.prisma.productConfiguration.findUniqueOrThrow({ where: { id: config.id } })
        expect(unchanged.quantity).toBe(2)
    })

    it("lets the owner change the quantity and rejects a non-integer one", async () => {
        const config = await createConfiguration(fixture.products.small, 2, fixture.userId)
        const { updateConfigurationQuantity } = await import("@/actions/configuration")

        expect(await updateConfigurationQuantity({ configId: config.id, quantity: 1.5 })).toMatchObject({ success: false })
        expect(await updateConfigurationQuantity({ configId: config.id, quantity: 0 })).toMatchObject({ success: false })

        const result = await updateConfigurationQuantity({ configId: config.id, quantity: 4 })
        expect(result.success).toBe(true)
        const row = await db.prisma.productConfiguration.findUniqueOrThrow({ where: { id: config.id } })
        expect(row.quantity).toBe(4)
        expect(row.totalPrice.toString()).toBe("600")
    })

    it("associates a configuration with the session user, never one named by the client", async () => {
        const config = await createConfiguration(fixture.products.small, 1)
        const { associateConfigurationWithUser } = await import("@/actions/configuration")

        holder.userId = null
        expect(await associateConfigurationWithUser(config.id)).toMatchObject({ success: false })

        holder.userId = fixture.userId
        expect(await associateConfigurationWithUser(config.id)).toMatchObject({ success: true })

        const owners = await db.prisma.productConfiguration.findUniqueOrThrow({
            where: { id: config.id },
            select: { users: { select: { id: true } } },
        })
        expect(owners.users.map((u) => u.id)).toEqual([fixture.userId])

        holder.userId = otherUserId
        expect(await associateConfigurationWithUser(config.id)).toMatchObject({ success: false })
    })
})

describe("order creation", () => {
    it("rejects a shipping option that is not one of the known rates", async () => {
        const config = await createConfiguration(fixture.products.small, 1)
        const { createOrderFromConfiguration } = await import("@/actions/order")
        expect(await createOrderFromConfiguration(config.id, "FreeShipping")).toEqual({
            success: false,
            code: "INVALID_INPUT",
        })
    })

    it("creates one order, and maps a resubmit of the same configuration to it", async () => {
        await db.prisma.shippingAddress.upsert({
            where: { userId: fixture.userId },
            create: { userId: fixture.userId, ...validAddress },
            update: {},
        })
        const config = await createConfiguration(fixture.products.small, 2)
        const { createOrderFromConfiguration } = await import("@/actions/order")

        const first = await createOrderFromConfiguration(config.id, "StandardShipping")
        expect(first.success).toBe(true)
        if (!first.success) return
        expect(first.isDuplicate).toBe(false)

        const again = await createOrderFromConfiguration(config.id, "StandardShipping")
        expect(again).toMatchObject({ success: true, isDuplicate: true, order: { id: first.order.id } })

        expect(await db.prisma.order.count({ where: { configurationId: config.id } })).toBe(1)

        const owners = await db.prisma.productConfiguration.findUniqueOrThrow({
            where: { id: config.id },
            select: { users: { select: { id: true } } },
        })
        expect(owners.users.map((u) => u.id)).toEqual([fixture.userId])

        // Another signed-in customer can neither see nor order the configuration once claimed.
        holder.userId = otherUserId
        await db.prisma.shippingAddress.create({ data: { userId: otherUserId, ...validAddress } })
        expect(await createOrderFromConfiguration(config.id, "StandardShipping")).toEqual({
            success: false,
            code: "CONFIG_NOT_FOUND",
        })
    })

    it("returns a stable code, not the cause, when stock runs out", async () => {
        const config = await createConfiguration(fixture.products.small, 50)
        const { createOrderFromConfiguration } = await import("@/actions/order")
        const result = await createOrderFromConfiguration(config.id, "BasicShipping")
        expect(result).toEqual({ success: false, code: "OUT_OF_STOCK" })
        expect(await db.prisma.order.count({ where: { configurationId: config.id } })).toBe(0)
    })

    it("tells a customer without an address to add one first", async () => {
        const config = await createConfiguration(fixture.products.small, 1)
        const stranger = await db.prisma.user.create({
            data: { email: "no-address@newlight.invalid", name: "No Address", emailVerified: true },
        })
        holder.userId = stranger.id
        const { createOrderFromConfiguration } = await import("@/actions/order")
        expect(await createOrderFromConfiguration(config.id, "StandardShipping")).toEqual({
            success: false,
            code: "SHIPPING_ADDRESS_REQUIRED",
        })
    })
})

describe("cart quantity", () => {
    it("refuses a non-positive or fractional quantity at the action and the service", async () => {
        const { addToCart } = await import("@/actions/cart")
        expect(await addToCart(fixture.skus.small, 0)).toMatchObject({ success: false, error: "INVALID_QUANTITY" })
        expect(await addToCart(fixture.skus.small, 1.5)).toMatchObject({ success: false, error: "INVALID_QUANTITY" })

        const { CartService } = await import("@/lib/services/cart-service")
        await expect(
            CartService.addToCart({ userId: fixture.userId, productId: fixture.skus.small, quantity: -2 })
        ).rejects.toThrow("INVALID_QUANTITY")

        expect(await db.prisma.cartItem.count()).toBe(0)
    })

    it("validates cart option updates", async () => {
        const { updateCartItemOptionsSchema } = await import("@/lib/validation/schema")
        expect(updateCartItemOptionsSchema.safeParse({ itemId: "" }).success).toBe(false)
        expect(updateCartItemOptionsSchema.safeParse({ itemId: "x", selectedColorTemp: "HOT" }).success).toBe(false)
        expect(updateCartItemOptionsSchema.safeParse({ itemId: "x", selectedColorTemp: "WARM_3000K", selectedColorKey: null }).success).toBe(true)
    })
})
