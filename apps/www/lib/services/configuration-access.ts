import { prisma, type Prisma } from "@repo/database"

// A configuration is visible to its owner, or to anyone while it has no owner (built before
// signing in). It is never visible to a different signed-in user, and the `users` relation is
// never loaded: it carries email and name.
// The shape satisfies both `WhereInput` and `WhereUniqueInput`, so a write can re-check it.
export function accessibleConfigurationWhere(
    configId: string,
    userId: string | null
): { id: string; OR: Prisma.ProductConfigurationWhereInput[] } {
    const owners: Prisma.ProductConfigurationWhereInput[] = [{ users: { none: {} } }]
    if (userId) owners.push({ users: { some: { id: userId } } })
    return { id: configId, OR: owners }
}

export async function findAccessibleConfiguration(configId: string, userId: string | null) {
    return prisma.productConfiguration.findFirst({ where: accessibleConfigurationWhere(configId, userId) })
}

// Claims an unowned configuration for `userId`. A configuration this user already owns is left
// alone; one owned by someone else is reported as not found. Returns the row as it is after the
// claim, so a key derived from `updatedAt` is computed from the state every retry will see.
export async function claimConfiguration(configId: string, userId: string) {
    const configuration = await findAccessibleConfiguration(configId, userId)
    if (!configuration) return null

    try {
        return await prisma.productConfiguration.update({
            where: { id: configId, users: { none: {} } },
            data: { users: { connect: { id: userId } } },
        })
    } catch {
        // Already owned (by this user, or claimed concurrently): re-read under the same rule.
        return findAccessibleConfiguration(configId, userId)
    }
}
