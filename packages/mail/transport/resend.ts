import { MailConfigurationError, MailTransportError, type MailInput, type MailResult, type MailTransport } from "../types"

const DEFAULT_BASE_URL = "https://api.resend.com"
// Resend's default account limit is 2 requests/second. The outbox sweep claims a batch and
// sends it in a loop, so without pacing a batch of 25 walks straight into 429s.
const DEFAULT_MIN_INTERVAL_MS = 550
// A request that hangs would otherwise hold the whole outbox batch until the function is killed.
export const REQUEST_TIMEOUT_MS = 10_000

export interface ResendConfig {
    apiKey: string
    baseUrl: string
    minIntervalMs: number
}

export function resendConfigFromEnv(): ResendConfig | null {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return null

    const interval = process.env.RESEND_MIN_INTERVAL_MS
    const minIntervalMs = interval === undefined ? DEFAULT_MIN_INTERVAL_MS : Number(interval)
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
        throw new MailConfigurationError(`RESEND_MIN_INTERVAL_MS is not a number of milliseconds: ${interval}`)
    }

    return {
        apiKey,
        baseUrl: (process.env.RESEND_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
        minIntervalMs,
    }
}

function formatAddress(to: MailInput["to"]): string {
    if (typeof to === "string") return to
    return to.name ? `${to.name} <${to.email}>` : to.email
}

// Resend rejects tag names and values outside [A-Za-z0-9_-], and drops the whole request
// rather than the offending tag.
function sanitizeTagPart(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256)
}

function isRetryableStatus(status: number): boolean {
    // 429 is the rate limit, 408 a timeout, 5xx the API itself. Everything else — a bad key,
    // an unverified domain, a malformed address — fails the same way on every retry.
    return status === 408 || status === 429 || status >= 500
}

async function errorMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { message?: string; error?: string; name?: string }
        return body.message || body.error || body.name || response.statusText
    } catch {
        return response.statusText
    }
}

export function resendTransport(config: ResendConfig, defaultFrom: string): MailTransport {
    if (!config.apiKey) throw new MailConfigurationError("RESEND_API_KEY is not set")
    if (!defaultFrom) throw new MailConfigurationError("EMAIL_FROM is not set")

    let nextSendAt = 0

    async function pace(): Promise<void> {
        if (config.minIntervalMs <= 0) return
        const wait = nextSendAt - Date.now()
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        nextSendAt = Date.now() + config.minIntervalMs
    }

    return {
        name: "resend",
        async send(input: MailInput): Promise<MailResult> {
            await pace()

            const tags = input.tags
                ? Object.entries(input.tags).map(([name, value]) => ({
                      name: sanitizeTagPart(name),
                      value: sanitizeTagPart(value),
                  }))
                : undefined

            const headers: Record<string, string> = {
                Authorization: `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
            }
            // One outbox row is one email however many times the sweep retries it.
            if (input.tags?.outboxId) headers["Idempotency-Key"] = `outbox-${input.tags.outboxId}`

            let response: Response
            try {
                response = await fetch(`${config.baseUrl}/emails`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        from: input.from ?? defaultFrom,
                        to: [formatAddress(input.to)],
                        subject: input.subject,
                        html: input.html,
                        text: input.text,
                        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
                        ...(tags && tags.length > 0 ? { tags } : {}),
                    }),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                })
            } catch (error) {
                // No response at all: DNS, TLS, socket, timeout. Always worth another attempt.
                const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
                const message = timedOut
                    ? `no response within ${REQUEST_TIMEOUT_MS}ms`
                    : error instanceof Error ? error.message : String(error)
                throw new MailTransportError(`resend: ${message}`, timedOut ? 408 : undefined, true)
            }

            if (!response.ok) {
                throw new MailTransportError(
                    `resend: ${response.status} ${await errorMessage(response)}`,
                    response.status,
                    isRetryableStatus(response.status)
                )
            }

            const body = (await response.json().catch(() => ({}))) as { id?: string }
            return { id: body.id ?? null, provider: "resend" }
        },
    }
}
