import { NextResponse, type NextRequest } from "next/server"

export function authorizeCron(request: NextRequest, secretName: string, logTag: string): NextResponse | null {
    const secret = process.env[secretName]
    if (!secret) {
        console.error(`[${logTag}] ${secretName} is not set; refusing to run unauthenticated.`)
        return NextResponse.json({ error: "not configured" }, { status: 503 })
    }

    // Bearer header only: a secret in the query string lands in access logs and browser history.
    const header = request.headers.get("authorization")
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : null
    if (provided === null || provided !== secret) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    return null
}
