import { consoleTransport } from "./transport/console"
import { resendConfigFromEnv, resendTransport } from "./transport/resend"
import { renderTemplate } from "./templates/index"
import type { PayloadByTemplate } from "./templates/payloads"
import { MailTransportError, SENDING_LOCALE, type MailInput, type MailLocale, type MailResult, type MailTemplate, type MailTransport } from "./types"

export * from "./types"
export type * from "./templates/payloads"
export { renderTemplate } from "./templates/index"

export type SendOutcome =
    | { ok: true; result: MailResult }
    | { ok: false; error: string; retryable: boolean }

let cached: MailTransport | null = null

export function transport(): MailTransport {
    if (cached) return cached
    const from = process.env.EMAIL_FROM
    const resend = resendConfigFromEnv()

    if (from && resend) {
        cached = resendTransport(resend, from)
    } else if (process.env.VERCEL_ENV === "production") {
        // In production a missing key must surface as a failure the outbox retries, never as a
        // console "send" that marks rows SENT with nothing delivered.
        console.error("[mail] RESEND_API_KEY or EMAIL_FROM is not set in production — mail will fail and stay queued.")
        cached = unconfiguredTransport()
    } else {
        console.warn("[mail] no RESEND_API_KEY or no EMAIL_FROM — mail will be logged, not delivered.")
        cached = consoleTransport()
    }
    return cached
}

function unconfiguredTransport(): MailTransport {
    return {
        name: "unconfigured",
        async send(): Promise<MailResult> {
            throw new MailTransportError("mail is not configured: RESEND_API_KEY or EMAIL_FROM is missing", undefined, true)
        },
    }
}

export function __setTransportForTesting(next: MailTransport | null): void {
    cached = next
}

export async function sendMail(input: MailInput): Promise<SendOutcome> {
    try {
        const result = await transport().send({
            ...input,
            replyTo: input.replyTo ?? process.env.EMAIL_REPLY_TO,
        })
        return { ok: true, result }
    } catch (error) {
        const retryable = error instanceof MailTransportError ? error.retryable : true
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[mail] send failed (${retryable ? "retryable" : "permanent"}): ${message}`)
        return { ok: false, error: message, retryable }
    }
}

export async function sendTemplate<T extends MailTemplate>(
    template: T,
    to: string,
    locale: MailLocale,
    payload: PayloadByTemplate[T]
): Promise<SendOutcome> {
    // `locale` is the customer's, and is deliberately not the language sent — see SENDING_LOCALE.
    const rendered = await renderTemplate(template, SENDING_LOCALE, payload)
    return sendMail({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, tags: { template } })
}
