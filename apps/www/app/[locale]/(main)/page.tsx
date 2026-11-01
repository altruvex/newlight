import { setRequestLocale } from "next-intl/server";
import SubPage from "./sub-page";

export const revalidate = 900

export default async function MainPage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)

    return (
        <>
            <SubPage />
        </>
    )
}
