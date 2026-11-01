import { authorizeCron } from "@/lib/cron-auth"
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it } from "vitest"

const SECRET_NAME = "TEST_CRON_SECRET"

function get(url: string, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(new Request(url, { headers }))
}

afterEach(() => {
    delete process.env[SECRET_NAME]
})

describe("authorizeCron", () => {
    it("refuses to run at all when the secret is not configured", async () => {
        const denied = authorizeCron(get("https://newlight-eg.com/api/cron/sweep"), SECRET_NAME, "test")
        expect(denied?.status).toBe(503)
    })

    it("does not accept an empty secret as a match for an absent header", async () => {
        process.env[SECRET_NAME] = ""
        const denied = authorizeCron(get("https://newlight-eg.com/api/cron/sweep"), SECRET_NAME, "test")
        expect(denied?.status).toBe(503)
    })

    it("rejects a wrong bearer token", async () => {
        process.env[SECRET_NAME] = "right"
        const denied = authorizeCron(
            get("https://newlight-eg.com/api/cron/sweep", { authorization: "Bearer wrong" }),
            SECRET_NAME,
            "test"
        )
        expect(denied?.status).toBe(401)
    })

    it("rejects a request with no credential of any kind", async () => {
        process.env[SECRET_NAME] = "right"
        const denied = authorizeCron(get("https://newlight-eg.com/api/cron/sweep"), SECRET_NAME, "test")
        expect(denied?.status).toBe(401)
    })

    it("accepts the bearer token Vercel Cron sends", async () => {
        process.env[SECRET_NAME] = "right"
        const denied = authorizeCron(
            get("https://newlight-eg.com/api/cron/sweep", { authorization: "Bearer right" }),
            SECRET_NAME,
            "test"
        )
        expect(denied).toBeNull()
    })

    it("rejects the secret in the query string even when it is right", async () => {
        process.env[SECRET_NAME] = "right"
        const denied = authorizeCron(get("https://newlight-eg.com/api/cron/sweep?secret=right"), SECRET_NAME, "test")
        expect(denied?.status).toBe(401)
    })

    it("ignores the query form once an Authorization header is present", async () => {
        process.env[SECRET_NAME] = "right"
        const denied = authorizeCron(
            get("https://newlight-eg.com/api/cron/sweep?secret=right", { authorization: "Bearer wrong" }),
            SECRET_NAME,
            "test"
        )
        expect(denied?.status).toBe(401)
    })
})
