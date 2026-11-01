import createIntlMiddleware from "next-intl/middleware"
import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"
import { routing } from "./i18n/routing"

const intlMiddleware = createIntlMiddleware(routing)

const PROTECTED = ["/account", "/cart", "/orders", "/confirm", "/complete"]

export default function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    const withoutLocale = pathname.replace(/^\/(en|ar)(?=\/|$)/, "") || "/"

    if (PROTECTED.some((path) => withoutLocale === path || withoutLocale.startsWith(`${path}/`))) {
        if (!getSessionCookie(request)) {
            const locale = pathname.match(/^\/(en|ar)(?=\/|$)/)?.[1] ?? routing.defaultLocale
            const signIn = new URL(`/${locale}/sign-in`, request.url)
            signIn.searchParams.set("redirectTo", pathname)
            return NextResponse.redirect(signIn)
        }
    }

    return intlMiddleware(request)
}

export const config = {
    // Skips /api/* (the proxy has nothing to do there, and every match is an invocation),
    // Next's own assets, and files by extension. Only real file extensions are skipped, so a
    // protected path that merely contains a dot (/account/x.y) still reaches the guard above.
    // The locale-prefixed API routes (/en/api/*) still pass through: next-intl's locale header
    // is how their handlers know the request's language.
    matcher: [
        "/((?!api/|trpc/|_next/static|_next/image|\\.well-known/|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|bmp|txt|xml|json|js|mjs|css|map|woff2?|ttf|otf|eot|webmanifest|pdf|mp4|webm)$).*)",
    ],
}
