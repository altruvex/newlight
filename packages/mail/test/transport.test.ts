import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { __setTransportForTesting, sendMail, transport } from "../index"

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "VERCEL_ENV"] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

const mail = { to: "customer@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" }

beforeEach(() => {
    for (const key of ENV_KEYS) {
        saved[key] = process.env[key]
        delete process.env[key]
    }
    __setTransportForTesting(null)
})

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
    }
    __setTransportForTesting(null)
})

describe("transport selection without RESEND_API_KEY / EMAIL_FROM", () => {
    it("logs instead of sending outside production, and reports ok", async () => {
        expect(transport().name).toBe("console")
        expect(await sendMail(mail)).toMatchObject({ ok: true })
    })

    it("fails retryably in production so the outbox keeps the row", async () => {
        process.env.VERCEL_ENV = "production"
        expect(transport().name).toBe("unconfigured")
        expect(await sendMail(mail)).toMatchObject({ ok: false, retryable: true })
    })

    it("still builds the real transport in production when both are set", () => {
        process.env.VERCEL_ENV = "production"
        process.env.RESEND_API_KEY = "re_test"
        process.env.EMAIL_FROM = "Newlight <no-reply@mail.newlight-eg.com>"
        expect(transport().name).toBe("resend")
    })
})
