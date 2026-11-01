import { prisma, resolveLocale, consume } from "@repo/database"
import { NextRequest, NextResponse } from "next/server"
import { queueMail } from "@repo/mail/outbox"
import { adminRecipients, notifyRecipients } from "@repo/notifications"
import { dispatchDeliveriesAfterResponse } from "@/lib/deliveries"
import { z } from "zod"

const contactFormSchema = z.object({
    fullName: z.string().min(2).max(100),
    jobPosition: z.string().min(2).max(100),
    email: z.string().email(),
    phoneNumber: z.string().min(10).max(20),
    message: z.string().optional(),
})
const CONTACT_LIMIT = 3
const CONTACT_WINDOW_SECONDS = 60

export async function POST(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params
    try {
        const ip = request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown"
        const rate = await consume(prisma, `contact:${ip}`, CONTACT_LIMIT, CONTACT_WINDOW_SECONDS)
        if (!rate.allowed) {
            return NextResponse.json(
                { error: "Too many requests. Please try again later." },
                { status: 429 }
            )
        }

        const body = await request.json()
        const validation = contactFormSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: "Invalid input", details: validation.error.flatten().fieldErrors },
                { status: 400 }
            )
        }

        const data = validation.data

        const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? ""

        const recipients = await adminRecipients(prisma)

        const contactForm = await prisma.$transaction(async (tx) => {
            const created = await tx.contactForm.create({
                data: {
                    fullName: data.fullName,
                    jobPosition: data.jobPosition,
                    email: data.email,
                    phoneNumber: data.phoneNumber,
                    message: data.message || "",
                    ipAddress: ip,
                    userAgent: request.headers.get("user-agent") || undefined,
                },
            })

            await queueMail(tx, {
                template: "contact-acknowledgement",
                to: data.email,
                locale: resolveLocale(locale),
                payload: { fullName: data.fullName },
                dedupeKey: `contact-ack:${created.id}`,
            })

            const notifyAddress = process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM
            if (notifyAddress) {
                await queueMail(tx, {
                    template: "contact-admin-notification",
                    to: notifyAddress,
                    locale: "en",
                    payload: {
                        fullName: data.fullName,
                        email: data.email,
                        phoneNumber: data.phoneNumber,
                        jobPosition: data.jobPosition,
                        message: data.message || undefined,
                        adminUrl: `${adminUrl}/admin/contact-forms/${created.id}`,
                    },
                    dedupeKey: `contact-admin:${created.id}`,
                })
            } else {
                console.warn("[contact] neither EMAIL_REPLY_TO nor EMAIL_FROM is set; no admin notification queued.")
            }

            await notifyRecipients(tx, recipients, {
                type: "NEW_CONTACT_FORM",
                title: "New contact form",
                message: `${data.fullName} (${data.jobPosition}) submitted the contact form.`,
                actionUrl: "/admin/contact",
                metadata: {
                    contactFormId: created.id,
                    email: data.email,
                    phone: data.phoneNumber,
                },
            })

            return created
        })

        dispatchDeliveriesAfterResponse("contact-form")

        return NextResponse.json(
            {
                success: true,
                message: "Contact form submitted successfully",
                id: contactForm.id,
            },
            { status: 201 }
        )
    } catch (error) {
        console.error("Contact form submission error:", error)
        return NextResponse.json(
            { error: "Failed to submit contact form" },
            { status: 500 }
        )
    }
}
