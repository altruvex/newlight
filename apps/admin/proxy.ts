import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC = ["/sign-in", "/api/auth"]

export default function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl
    if (PUBLIC.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
        return NextResponse.next()
    }
    if (!getSessionCookie(request)) {
        return NextResponse.redirect(new URL("/sign-in", request.url))
    }
    return NextResponse.next()
}

export const config = {
    matcher: [
        "/((?!_next|[^?]*\\.(?:html?|css|js|json|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        "/(api|trpc)(.*)",
    ],
}
