import * as React from "react"
import { Hr, Img, Link, Section, Text } from "react-email"
import type { MailLocale } from "../types"
import { ActionButton, DetailRows, INK, MUTED, Muted, Paragraph, RULE, Shell } from "./layout"
import { strings, t } from "./strings"
import type {
    ContactAcknowledgementPayload,
    OrderLine,
    ContactAdminNotificationPayload,
    EmailVerificationPayload,
    OrderConfirmationPayload,
    OrderStatusChangePayload,
    PasswordResetPayload,
} from "./payloads"

function greet(locale: MailLocale, name?: string) {
    return name ? t(strings.greetingNamed, locale, { name }) : t(strings.greeting, locale)
}

export function EmailVerification({ locale, payload }: { locale: MailLocale; payload: EmailVerificationPayload }) {
    return (
        <Shell locale={locale} preview={t(strings.verifyBody, locale)}>
            <Paragraph>{greet(locale, payload.name)}</Paragraph>
            <Paragraph>{t(strings.verifyBody, locale)}</Paragraph>
            <ActionButton locale={locale} href={payload.verifyUrl} label={t(strings.verifyButton, locale)} />
            <Muted>{t(strings.verifyExpiry, locale, { minutes: payload.expiresInMinutes })}</Muted>
            <Muted>{t(strings.verifyIgnore, locale)}</Muted>
        </Shell>
    )
}

export function PasswordReset({ locale, payload }: { locale: MailLocale; payload: PasswordResetPayload }) {
    return (
        <Shell locale={locale} preview={t(strings.resetBody, locale)}>
            <Paragraph>{greet(locale, payload.name)}</Paragraph>
            <Paragraph>{t(strings.resetBody, locale)}</Paragraph>
            <ActionButton locale={locale} href={payload.resetUrl} label={t(strings.resetButton, locale)} />
            <Muted>{t(strings.verifyExpiry, locale, { minutes: payload.expiresInMinutes })}</Muted>
            <Muted>{t(strings.resetIgnore, locale)}</Muted>
        </Shell>
    )
}

function OrderItem({
    locale,
    item,
    money,
    last,
}: {
    locale: MailLocale
    item: OrderLine
    money: (amount: string) => string
    last: boolean
}) {
    const rtl = locale === "ar"
    const start = rtl ? ("right" as const) : ("left" as const)
    const end = rtl ? ("left" as const) : ("right" as const)

    return (
        <Section style={{ margin: 0 }}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
                <tbody>
                    <tr>
                        {item.imageUrl ? (
                            <td
                                width={72}
                                valign="top"
                                style={{ padding: rtl ? "10px 0 10px 12px" : "10px 12px 10px 0", width: 72 }}
                            >
                                <Img
                                    src={item.imageUrl}
                                    alt={item.name}
                                    width={72}
                                    height={72}
                                    style={{ borderRadius: 6, border: `1px solid ${RULE}`, objectFit: "cover" }}
                                />
                            </td>
                        ) : null}

                        <td valign="top" style={{ padding: "10px 0", textAlign: start }}>
                            <Text style={{ color: INK, fontSize: 14, fontWeight: 600, lineHeight: "20px", margin: 0 }}>
                                {item.name}
                            </Text>

                            {item.sku ? (
                                <Text style={{ color: MUTED, fontSize: 12, lineHeight: "18px", margin: "2px 0 0" }}>
                                    {`${t(strings.orderSku, locale)}: ${item.sku}`}
                                </Text>
                            ) : null}

                            {item.attributes?.map((attribute) => (
                                <Text
                                    key={attribute.label}
                                    style={{ color: MUTED, fontSize: 12, lineHeight: "18px", margin: "2px 0 0" }}
                                >
                                    {`${attribute.label}: ${attribute.value}`}
                                </Text>
                            ))}

                            {item.productUrl ? (
                                <Text style={{ fontSize: 12, lineHeight: "18px", margin: "4px 0 0" }}>
                                    <Link href={item.productUrl} style={{ color: INK, textDecoration: "underline" }}>
                                        {t(strings.orderViewProduct, locale)}
                                    </Link>
                                </Text>
                            ) : null}
                        </td>

                        <td valign="top" style={{ padding: "10px 0", textAlign: end, whiteSpace: "nowrap" }}>
                            <Text style={{ color: INK, fontSize: 14, fontWeight: 600, lineHeight: "20px", margin: 0 }}>
                                {money(item.lineTotal ?? item.price)}
                            </Text>
                            <Text style={{ color: MUTED, fontSize: 12, lineHeight: "18px", margin: "2px 0 0" }}>
                                {`${item.quantity} × ${money(item.price)}`}
                            </Text>
                        </td>
                    </tr>
                </tbody>
            </table>
            {last ? null : <Hr style={{ border: "none", borderTop: `1px solid ${RULE}`, margin: 0 }} />}
        </Section>
    )
}

export function OrderConfirmation({ locale, payload }: { locale: MailLocale; payload: OrderConfirmationPayload }) {
    const money = (amount: string) => `${amount} ${payload.currency}`

    return (
        <Shell locale={locale} preview={t(strings.orderSubject, locale, { orderNumber: payload.orderNumber })}>
            <Paragraph>{greet(locale, payload.address.fullName)}</Paragraph>
            <Paragraph>{t(strings.orderBody, locale)}</Paragraph>

            <DetailRows locale={locale} rows={[[t(strings.orderNumber, locale), payload.orderNumber]]} />

            <Text style={{ color: INK, fontSize: 14, fontWeight: 700, margin: "24px 0 8px" }}>
                {t(strings.orderItems, locale)}
            </Text>
            {payload.items.map((item, index) => (
                <OrderItem key={`${item.name}-${index}`} locale={locale} item={item} money={money} last={index === payload.items.length - 1} />
            ))}

            <DetailRows
                locale={locale}
                rows={[
                    [t(strings.orderSubtotal, locale), money(payload.subtotal)],
                    [t(strings.orderShipping, locale), money(payload.shippingCost)],
                    [t(strings.orderTotal, locale), money(payload.total)],
                ]}
            />
            <Muted>{t(strings.orderPaymentCod, locale)}</Muted>

            <Text style={{ color: INK, fontSize: 14, fontWeight: 700, margin: "24px 0 8px" }}>
                {t(strings.orderDeliverTo, locale)}
            </Text>
            <Section>
                <Text style={{ color: INK, fontSize: 14, lineHeight: "22px", margin: 0 }}>
                    {payload.address.fullName}
                    <br />
                    {payload.address.addressLine1}
                    {payload.address.addressLine2 ? (
                        <>
                            <br />
                            {payload.address.addressLine2}
                        </>
                    ) : null}
                    <br />
                    {payload.address.city}, {payload.address.country}
                    <br />
                    {payload.address.phone}
                </Text>
            </Section>

            <ActionButton locale={locale} href={payload.orderUrl} label={t(strings.orderButton, locale)} />
        </Shell>
    )
}

const STATUS_COPY = {
    awaiting_shipment: strings.statusAwaitingShipment,
    shipped: strings.statusShipped,
    delivered: strings.statusDelivered,
    cancelled: strings.statusCancelled,
} as const

export function OrderStatusChange({ locale, payload }: { locale: MailLocale; payload: OrderStatusChangePayload }) {
    const status = t(STATUS_COPY[payload.status], locale)
    return (
        <Shell locale={locale} preview={t(strings.statusSubject, locale, { orderNumber: payload.orderNumber, status })}>
            <Paragraph>{t(strings.statusSubject, locale, { orderNumber: payload.orderNumber, status })}</Paragraph>
            <DetailRows
                locale={locale}
                rows={[
                    [t(strings.orderNumber, locale), payload.orderNumber],
                    ...(payload.trackingNumber ? ([[t(strings.statusTracking, locale), payload.trackingNumber]] as Array<[string, string]>) : []),
                ]}
            />
            <ActionButton locale={locale} href={payload.orderUrl} label={t(strings.orderButton, locale)} />
        </Shell>
    )
}

export function ContactAcknowledgement({ locale, payload }: { locale: MailLocale; payload: ContactAcknowledgementPayload }) {
    return (
        <Shell locale={locale} preview={t(strings.contactAckBody, locale)}>
            <Paragraph>{greet(locale, payload.fullName)}</Paragraph>
            <Paragraph>{t(strings.contactAckBody, locale)}</Paragraph>
        </Shell>
    )
}

export function ContactAdminNotification({ locale, payload }: { locale: MailLocale; payload: ContactAdminNotificationPayload }) {
    return (
        <Shell locale={locale} preview={t(strings.contactAdminBody, locale)}>
            <Paragraph>{t(strings.contactAdminBody, locale)}</Paragraph>
            <DetailRows
                locale={locale}
                rows={[
                    [t(strings.contactName, locale), payload.fullName],
                    [t(strings.contactEmail, locale), payload.email],
                    [t(strings.contactPhone, locale), payload.phoneNumber],
                    [t(strings.contactPosition, locale), payload.jobPosition],
                    ...(payload.message ? ([[t(strings.contactMessage, locale), payload.message]] as Array<[string, string]>) : []),
                ]}
            />
            <ActionButton locale={locale} href={payload.adminUrl} label={t(strings.contactButton, locale)} />
        </Shell>
    )
}
