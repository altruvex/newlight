import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MailConfigurationError, MailTransportError } from "../types"
import { resendConfigFromEnv, resendTransport } from "../transport/resend"

const ENV_KEYS = ["RESEND_API_KEY", "RESEND_BASE_URL", "RESEND_MIN_INTERVAL_MS"] as const

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) delete process.env[key]
})

describe("resendConfigFromEnv", () => {
    it("returns null when no API key is configured", () => {
        expect(resendConfigFromEnv()).toBeNull()
    })

    it("defaults to the public API and a pace under the 2/second limit", () => {
        process.env.RESEND_API_KEY = "re_test"
        expect(resendConfigFromEnv()).toEqual({ apiKey: "re_test", baseUrl: "https://api.resend.com", minIntervalMs: 550 })
    })

    it("lets the base URL be overridden, without a trailing slash", () => {
        process.env.RESEND_API_KEY = "re_test"
        process.env.RESEND_BASE_URL = "https://resend.test/"
        expect(resendConfigFromEnv()?.baseUrl).toBe("https://resend.test")
    })

    it("rejects a pace that is not a number of milliseconds", () => {
        process.env.RESEND_API_KEY = "re_test"
        process.env.RESEND_MIN_INTERVAL_MS = "soon"
        expect(() => resendConfigFromEnv()).toThrow(MailConfigurationError)
    })
})

describe("resendTransport", () => {
    // minIntervalMs 0 keeps the tests off the clock; pacing is configuration, not behaviour.
    const config = { apiKey: "re_test", baseUrl: "https://api.resend.com", minIntervalMs: 0 }
    const mail = { to: "customer@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" }

    function lastRequestBody(): Record<string, unknown> {
        return JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)
    }

    function lastRequestHeaders(): Record<string, string> {
        return fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>
    }

    it("refuses an empty API key", () => {
        expect(() => resendTransport({ ...config, apiKey: "" }, "no-reply@mail.newlight-eg.com")).toThrow(MailConfigurationError)
    })

    it("refuses an empty EMAIL_FROM", () => {
        expect(() => resendTransport(config, "")).toThrow(MailConfigurationError)
    })

    it("posts to /emails with the key, the default from, and returns the message id", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: "b1e4-…" }))
        const result = await resendTransport(config, "Newlight <no-reply@mail.newlight-eg.com>").send(mail)

        expect(fetchMock.mock.calls[0]![0]).toBe("https://api.resend.com/emails")
        expect(lastRequestHeaders().Authorization).toBe("Bearer re_test")
        expect(lastRequestBody()).toMatchObject({
            from: "Newlight <no-reply@mail.newlight-eg.com>",
            to: ["customer@example.com"],
            subject: "Hi",
        })
        expect(result).toEqual({ id: "b1e4-…", provider: "resend" })
    })

    it("formats a named recipient and passes reply_to through", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }))
        await resendTransport(config, "no-reply@mail.newlight-eg.com").send({
            ...mail,
            to: { email: "customer@example.com", name: "Customer" },
            replyTo: "support@newlight-eg.com",
        })

        expect(lastRequestBody()).toMatchObject({
            to: ["Customer <customer@example.com>"],
            reply_to: "support@newlight-eg.com",
        })
    })

    it("maps tags onto Resend's name/value pairs and sanitizes them", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }))
        await resendTransport(config, "no-reply@mail.newlight-eg.com").send({
            ...mail,
            tags: { template: "order-confirmation", "outbox.id": "c1:2" },
        })

        expect(lastRequestBody().tags).toEqual([
            { name: "template", value: "order-confirmation" },
            { name: "outbox_id", value: "c1_2" },
        ])
    })

    it("sends an outbox row under an idempotency key so a retry cannot duplicate it", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }))
        await resendTransport(config, "no-reply@mail.newlight-eg.com").send({ ...mail, tags: { outboxId: "row-1" } })

        expect(lastRequestHeaders()["Idempotency-Key"]).toBe("outbox-row-1")
    })

    it("omits the idempotency key when there is no outbox row", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }))
        await resendTransport(config, "no-reply@mail.newlight-eg.com").send(mail)

        expect(lastRequestHeaders()["Idempotency-Key"]).toBeUndefined()
    })

    it("treats a 422 as permanent, and quotes the API's own message", async () => {
        fetchMock.mockResolvedValue(jsonResponse(422, { message: "Invalid `to` field" }))
        await expect(resendTransport(config, "no-reply@mail.newlight-eg.com").send(mail)).rejects.toMatchObject({
            name: "MailTransportError",
            status: 422,
            retryable: false,
            message: "resend: 422 Invalid `to` field",
        })
    })

    it("treats a 401 as permanent — a wrong key is wrong on every attempt", async () => {
        fetchMock.mockResolvedValue(jsonResponse(401, { message: "API key is invalid" }))
        await expect(resendTransport(config, "no-reply@mail.newlight-eg.com").send(mail)).rejects.toMatchObject({
            status: 401,
            retryable: false,
        })
    })

    it("treats a 429 and a 5xx as retryable", async () => {
        fetchMock.mockResolvedValue(jsonResponse(429, { message: "Too many requests" }))
        await expect(resendTransport(config, "no-reply@mail.newlight-eg.com").send(mail)).rejects.toMatchObject({
            status: 429,
            retryable: true,
        })

        fetchMock.mockResolvedValue(jsonResponse(503, { message: "Service unavailable" }))
        await expect(resendTransport(config, "no-reply@mail.newlight-eg.com").send(mail)).rejects.toMatchObject({
            status: 503,
            retryable: true,
        })
    })

    it("treats a transport failure with no response as retryable", async () => {
        fetchMock.mockRejectedValue(new Error("fetch failed"))
        const error = await resendTransport(config, "no-reply@mail.newlight-eg.com")
            .send(mail)
            .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(MailTransportError)
        expect((error as MailTransportError).retryable).toBe(true)
        expect((error as MailTransportError).status).toBeUndefined()
    })

    it("paces consecutive sends so a sweep stays under the rate limit", async () => {
        vi.useFakeTimers()
        try {
            fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }))
            const transport = resendTransport({ ...config, minIntervalMs: 550 }, "no-reply@mail.newlight-eg.com")

            await transport.send(mail)
            expect(fetchMock).toHaveBeenCalledTimes(1)

            const second = transport.send(mail)
            await vi.advanceTimersByTimeAsync(500)
            expect(fetchMock).toHaveBeenCalledTimes(1)

            await vi.advanceTimersByTimeAsync(100)
            await second
            expect(fetchMock).toHaveBeenCalledTimes(2)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe("resendTransport timeouts", () => {
    const config = { apiKey: "re_test", baseUrl: "https://api.resend.com", minIntervalMs: 0 }
    const mail = { to: "customer@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" }

    it("bounds every request with a timeout signal", async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }))
        await resendTransport(config, "no-reply@mail.newlight-eg.com").send(mail)

        const init = fetchMock.mock.calls.at(-1)![1] as RequestInit
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it("treats a timeout as retryable, not as a permanent failure", async () => {
        fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
        await expect(resendTransport(config, "no-reply@mail.newlight-eg.com").send(mail)).rejects.toMatchObject({
            name: "MailTransportError",
            status: 408,
            retryable: true,
            message: "resend: no response within 10000ms",
        })
    })
})
