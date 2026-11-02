import { requireCurrentAdmin } from "@/lib/auth"
import { TaxonomyForm } from "../../taxonomy-form"
import { PageBody, PageHeader } from "@/components/page"

export const metadata = { title: "New category" }

export const dynamic = "force-dynamic"

export default async function NewCategoryPage() {
    await requireCurrentAdmin()
    return (
        <>
            <PageHeader
                title="New category"
            />

            <PageBody>
                <TaxonomyForm kind="category" existing={null} />
            </PageBody>
        </>
    )
}
