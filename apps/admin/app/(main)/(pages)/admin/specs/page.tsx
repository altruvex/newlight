import { requireCurrentAdmin } from "@/lib/auth"
import { SpecDefinitionService } from "@/lib/services/spec-definition-service"
import { SpecsManager } from "./specs-manager"
import { PageBody, PageHeader } from "@/components/page"

export const metadata = { title: "Specifications" }

export const dynamic = "force-dynamic"

export default async function SpecsPage() {
    await requireCurrentAdmin()
    const definitions = await SpecDefinitionService.list()

    return (
        <>
            <PageHeader
                title="Specifications"
                description="The vocabulary every product's technical fields are drawn from. A definition is shared, so renaming one renames it on every product that uses it."
            />

            <PageBody>
                <SpecsManager
                    definitions={definitions.map((d) => ({
                        key: d.key,
                        valueType: d.valueType,
                        labelEn: d.labelEn,
                        labelAr: d.labelAr,
                        unitEn: d.unitEn,
                        unitAr: d.unitAr,
                        order: d.order,
                        usedByProducts: d._count.productSpecs,
                        askedByCategories: d._count.subCategories,
                    }))}
                />
            </PageBody>
        </>
    )
}
