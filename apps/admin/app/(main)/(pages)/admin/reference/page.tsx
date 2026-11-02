import { prisma } from "@repo/database"
import { requireCurrentAdmin } from "@/lib/auth"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ColorService, FamilyService, LocationService } from "@/lib/services/reference-service"
import { FamiliesPanel } from "./families-panel"
import { ColorsPanel } from "./colors-panel"
import { LocationsPanel } from "./locations-panel"
import { PageBody, PageHeader, pageTabsListClass, pageTabsTriggerClass } from "@/components/page"

export const metadata = { title: "Reference data" }

export const dynamic = "force-dynamic"

export default async function ReferencePage() {
    await requireCurrentAdmin()

    const [families, colors, locations, subCategories] = await Promise.all([
        FamilyService.list(),
        ColorService.list(),
        LocationService.list(),
        prisma.subCategory.findMany({
            where: { deletedAt: null },
            select: { id: true, translations: { where: { locale: "en" }, select: { name: true }, take: 1 } },
            orderBy: { order: "asc" },
        }),
    ])

    return (
        <>
            <PageHeader
                title="Reference data"
                description="Colours, families and mounting locations — the shared lists products are built from. Editing one here changes it everywhere it is used."
            />

            <PageBody>
                <Tabs defaultValue="families" className="w-full gap-0">
                    <TabsList className={pageTabsListClass}>
                        <TabsTrigger value="families" className={pageTabsTriggerClass}>
                            Families
                            <span className="tabular-nums text-muted-foreground">{families.length}</span>
                        </TabsTrigger>
                        <TabsTrigger value="colors" className={pageTabsTriggerClass}>
                            Colours
                            <span className="tabular-nums text-muted-foreground">{colors.length}</span>
                        </TabsTrigger>
                        <TabsTrigger value="locations" className={pageTabsTriggerClass}>
                            Locations
                            <span className="tabular-nums text-muted-foreground">{locations.length}</span>
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="families" className="mt-4">
                        <FamiliesPanel
                            families={families.map((f) => ({
                                id: f.id,
                                slug: f.slug,
                                variantType: f.variantType,
                                order: f.order,
                                products: f._count.products,
                                subCategory: f.subCategory.translations[0]?.name ?? f.subCategoryId,
                                nameEn: f.translations.find((t) => t.locale === "en")?.name ?? "",
                                nameAr: f.translations.find((t) => t.locale === "ar")?.name ?? "",
                            }))}
                            subCategories={subCategories.map((s) => ({
                                id: s.id,
                                name: s.translations[0]?.name ?? s.id,
                            }))}
                        />
                    </TabsContent>

                    <TabsContent value="colors" className="mt-4">
                        <ColorsPanel
                            colors={colors.map((c) => ({
                                id: c.id,
                                key: c.key,
                                hex: c.hex,
                                nameEn: c.nameEn,
                                nameAr: c.nameAr,
                                order: c.order,
                                isActive: c.isActive,
                                products: c._count.products,
                                images: c._count.images,
                            }))}
                        />
                    </TabsContent>

                    <TabsContent value="locations" className="mt-4">
                        <LocationsPanel
                            locations={locations.map((l) => ({
                                id: l.id,
                                name: l.name,
                                isDefault: l.isDefault,
                                onHand: l.onHand,
                                hasMovements: l.hasMovements,
                            }))}
                        />
                    </TabsContent>
                </Tabs>
            </PageBody>
        </>
    )
}
