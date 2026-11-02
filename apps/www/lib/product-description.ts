/**
 * A product description as the catalogue import wrote it, minus the gaps.
 *
 * The imported descriptions fill a sentence template from the spec sheet and
 * write "-" where the sheet had no value, so a product without a measured flux
 * reads "7W power, - luminous flux" and one without a material reads "Built
 * with - construction". The clause that names a missing value is dropped here,
 * in both languages, and doubled spaces are closed; the stored text is left as
 * it is until the catalogue is re-imported.
 */
export function cleanDescription(text: string | null | undefined): string | undefined {
    if (!text) return undefined
    const cleaned = text
        // "Built with - construction and CRI >80" → "CRI >80"
        .replace(/Built with\s+-\s+construction and\s+/g, "")
        // "مصنوع من -، مؤشر CRI" → "مؤشر CRI"
        .replace(/مصنوع من\s*-\s*[،,]\s*/g, "")
        // A list clause that starts with the gap: ", - luminous flux"
        .replace(/\s*[,،]\s*-\s+[^,،.]+(?=[,،.]|$)/g, "")
        // A list clause that ends with it: "، تدفق ضوئي -"
        .replace(/\s*[,،]\s*[^,،.]+?\s-(?=\s*[,،.]|$)/g, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    return cleaned || undefined
}
