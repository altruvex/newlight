import * as React from "react"
import {
    Body,
    Container,
    Head,
    Hr,
    Html,
    Link,
    Preview,
    Section,
    Text,
} from "react-email"
import type { ReactNode } from "react"
import type { MailLocale } from "../types"
import { BRAND, strings, t } from "./strings"

const INK = "#111111"
const MUTED = "#6b7280"
const RULE = "#e5e7eb"
const PAGE = "#f6f6f6"

const FONT_AR = "Tahoma, 'Segoe UI', Arial, sans-serif"
const FONT_EN = "'Helvetica Neue', Helvetica, Arial, sans-serif"

export interface ShellProps {
    locale: MailLocale
    preview: string
    children: ReactNode
}

export function Shell({ locale, preview, children }: ShellProps) {
    const rtl = locale === "ar"
    const dir = rtl ? "rtl" : "ltr"
    const align = rtl ? ("right" as const) : ("left" as const)

    return (
        <Html lang={locale} dir={dir}>
            <Head />
            <Preview>{preview}</Preview>
            <Body style={{ backgroundColor: PAGE, margin: 0, padding: "24px 0", fontFamily: rtl ? FONT_AR : FONT_EN }}>
                <Container
                    style={{
                        backgroundColor: "#ffffff",
                        borderRadius: 8,
                        margin: "0 auto",
                        maxWidth: 560,
                        padding: 32,
                        textAlign: align,
                        direction: dir,
                    }}
                >
                    <Text style={{ color: INK, fontSize: 20, fontWeight: 700, margin: "0 0 24px" }}>
                        {BRAND[locale]}
                    </Text>
                    {children}
                    <Hr style={{ borderColor: RULE, margin: "32px 0 16px" }} />
                    <Text style={{ color: MUTED, fontSize: 12, lineHeight: "18px", margin: 0 }}>
                        {t(strings.footerAutomated, locale)}
                    </Text>
                    <Text style={{ color: MUTED, fontSize: 12, margin: "4px 0 0" }}>{t(strings.footerRights, locale)}</Text>
                </Container>
            </Body>
        </Html>
    )
}

export function ActionButton({ locale, href, label }: { locale: MailLocale; href: string; label: string }) {
    return (
        <Section style={{ margin: "24px 0" }}>
            <Link
                href={href}
                style={{
                    backgroundColor: INK,
                    borderRadius: 6,
                    color: "#ffffff",
                    display: "inline-block",
                    fontSize: 15,
                    fontWeight: 600,
                    padding: "12px 24px",
                    textDecoration: "none",
                }}
            >
                {label}
            </Link>
            <Text style={{ color: MUTED, fontSize: 12, lineHeight: "18px", margin: "16px 0 0", wordBreak: "break-all" }}>
                {t(strings.buttonFallback, locale)}
                <br />
                {href}
            </Text>
        </Section>
    )
}

export function Paragraph({ children }: { children: ReactNode }) {
    return <Text style={{ color: INK, fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>{children}</Text>
}

export function Muted({ children }: { children: ReactNode }) {
    return <Text style={{ color: MUTED, fontSize: 13, lineHeight: "20px", margin: "0 0 8px" }}>{children}</Text>
}

export function DetailRows({ locale, rows }: { locale: MailLocale; rows: Array<[string, string]> }) {
    const rtl = locale === "ar"
    return (
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ margin: "16px 0" }}>
            <tbody>
                {rows.map(([label, value]) => (
                    <tr key={label}>
                        <td style={{ color: MUTED, fontSize: 13, padding: "6px 0", textAlign: rtl ? "right" : "left", width: "40%" }}>
                            {label}
                        </td>
                        <td style={{ color: INK, fontSize: 14, padding: "6px 0", textAlign: rtl ? "right" : "left" }}>{value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

export { INK, MUTED, RULE }
