import { Prisma } from "@repo/database"
import { describe, expect, it, vi } from "vitest"

import { isSerializationFailure, isUniqueViolationOn, withSerializableRetry } from "@/lib/services/transaction-retry"

function serializationFailure() {
    return new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" })
}

describe("serializable transaction retry", () => {
    it("recognises the shapes Postgres serialization failures arrive in", () => {
        expect(isSerializationFailure(serializationFailure())).toBe(true)
        expect(
            isSerializationFailure(
                new Prisma.PrismaClientKnownRequestError("db error", {
                    code: "P2010",
                    clientVersion: "test",
                    meta: { code: "40001" },
                })
            )
        ).toBe(true)
        expect(isSerializationFailure(new Error("could not serialize access due to concurrent update"))).toBe(true)
        expect(isSerializationFailure(new Error("Configuration not found"))).toBe(false)
    })

    it("runs the transaction again after a serialization failure and returns the eventual result", async () => {
        let calls = 0
        const onRetry = vi.fn()
        const result = await withSerializableRetry(
            async () => {
                calls += 1
                if (calls < 3) throw serializationFailure()
                return "committed"
            },
            { attempts: 3, jitterMs: 1, onRetry }
        )
        expect(result).toBe("committed")
        expect(calls).toBe(3)
        expect(onRetry).toHaveBeenCalledTimes(2)
    })

    it("gives up after the configured number of attempts", async () => {
        let calls = 0
        await expect(
            withSerializableRetry(
                async () => {
                    calls += 1
                    throw serializationFailure()
                },
                { attempts: 3, jitterMs: 1 }
            )
        ).rejects.toMatchObject({ code: "P2034" })
        expect(calls).toBe(3)
    })

    it("does not retry anything that is not a serialization failure", async () => {
        let calls = 0
        await expect(
            withSerializableRetry(
                async () => {
                    calls += 1
                    throw new Error("Insufficient inventory")
                },
                { attempts: 3, jitterMs: 1 }
            )
        ).rejects.toThrow("Insufficient inventory")
        expect(calls).toBe(1)
    })

    it("recognises a unique violation on a named column", () => {
        const violation = new Prisma.PrismaClientKnownRequestError("unique", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["idempotencyKey"] },
        })
        expect(isUniqueViolationOn(violation, "idempotencyKey")).toBe(true)
        expect(isUniqueViolationOn(violation, "orderNumber")).toBe(false)
        expect(isUniqueViolationOn(serializationFailure(), "idempotencyKey")).toBe(false)
    })
})
