import { requireCurrentAdmin } from "@/lib/auth"
import { ContactService } from "@/lib/services/contact-service"
import { parseTableState } from "@/lib/table-params"
import { InlineAlert, PageBody, PageHeader, PageStack, Stat, StatGrid } from "@/components/page"
import { ContactTable } from "./contact-table"

export const metadata = { title: "Contact enquiries" }

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ContactPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    await requireCurrentAdmin()

    const state = parseTableState(await searchParams, { sort: "createdAt", dir: "desc" })
    const result = await ContactService.list(state)

    return (
        <>
            <PageHeader
                title="Contact enquiries"
                description="Submissions from the storefront's contact form. Opening one marks it read; the person who read it and when is recorded."
            />

            <PageBody className="pb-0">
                <PageStack className="gap-3">
                    {result.stale > 0 && (
                        <InlineAlert
                            tone="warning"
                            title={`${result.stale} enquir${result.stale === 1 ? "y has" : "ies have"} waited more than three days`}
                        >
                            Nobody has opened them. Sort by Received, oldest first, to work through the backlog.
                        </InlineAlert>
                    )}

                    <StatGrid className="md:grid-cols-3">
                        <Stat
                            label="Unread"
                            value={result.unread}
                            hint={result.unread > 0 ? "waiting to be opened" : "queue is clear"}
                            tone={result.unread > 0 ? "warning" : "success"}
                        />
                        <Stat
                            label="Unopened over 3 days"
                            value={result.stale}
                            tone={result.stale > 0 ? "danger" : "default"}
                        />
                        <Stat
                            label="Marked urgent"
                            value={result.urgent}
                            hint="open enquiries only"
                            tone={result.urgent > 0 ? "danger" : "default"}
                        />
                    </StatGrid>
                </PageStack>
            </PageBody>

            <ContactTable {...result} state={state} />
        </>
    )
}
