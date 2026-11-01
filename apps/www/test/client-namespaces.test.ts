import { readdirSync, readFileSync, existsSync, statSync } from "node:fs"
import { join, dirname, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { CLIENT_NAMESPACES, pickMessages } from "@/i18n/client-namespaces"
import en from "@/messages/en.json"
import ar from "@/messages/ar.json"

/**
 * The root layout hands `NextIntlClientProvider` only CLIENT_NAMESPACES. A client component
 * reading any other namespace would render its raw keys, so this scan must stay conservative:
 * a file is "client" if it has a `"use client"` directive OR is (transitively) imported by one,
 * because a module without the directive that a client file imports is bundled for the client.
 * Files with a `"use server"` directive are not followed (server actions run on the server).
 */

const ROOT = join(__dirname, "..")
const SKIP_DIRS = new Set(["node_modules", ".next", "test", "messages", "public", ".turbo"])

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(full)
    }
    return out
}

const DIRECTIVE = (kind: string) =>
    new RegExp(`^\\s*(?:(?://[^\\n]*\\n|/\\*[\\s\\S]*?\\*/)\\s*)*['"]${kind}['"]`)

function resolveImport(from: string, spec: string): string | null {
    let base: string
    if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2))
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec)
    else return null
    for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
    ]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
    return null
}

function importsOf(file: string, source: string): string[] {
    const specs = new Set<string>()
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) specs.add(m[1]!)
    return [...specs].map((s) => resolveImport(file, s)).filter((f): f is string => f !== null)
}

function clientClosure(): { files: Map<string, string> } {
    const sources = new Map<string, string>()
    for (const f of walk(ROOT)) sources.set(f, readFileSync(f, "utf8"))

    const closure = new Set<string>()
    const queue = [...sources].filter(([, s]) => DIRECTIVE("use client").test(s)).map(([f]) => f)
    while (queue.length) {
        const f = queue.pop()!
        if (closure.has(f)) continue
        closure.add(f)
        const source = sources.get(f)
        if (source === undefined || DIRECTIVE("use server").test(source)) continue
        for (const dep of importsOf(f, source)) if (!closure.has(dep)) queue.push(dep)
    }
    return { files: new Map([...closure].map((f) => [f, sources.get(f) ?? ""])) }
}

type Usage = { namespace: string; file: string }

function scan() {
    const { files } = clientClosure()
    const usages: Usage[] = []
    const unresolvable: string[] = []

    for (const [file, source] of files) {
        const rel = relative(ROOT, file)
        for (const m of source.matchAll(/\buseTranslations\(\s*([^)]*?)\s*\)/g)) {
            const arg = m[1]!
            const literal = arg.match(/^(["'])([^"'`$]+)\1$/)
            if (literal) usages.push({ namespace: literal[2]!.split(".")[0]!, file: rel })
            else unresolvable.push(`${rel}: useTranslations(${arg})`)
        }
        // Reads the whole catalogue: cannot be narrowed, so it must not exist client-side.
        if (/\buseMessages\(/.test(source)) unresolvable.push(`${rel}: useMessages()`)
        if (/\bcreateTranslator\(/.test(source)) unresolvable.push(`${rel}: createTranslator()`)
    }
    return { usages, unresolvable, clientFiles: files.size }
}

describe("client message namespaces", () => {
    const { usages, unresolvable, clientFiles } = scan()
    const used = [...new Set(usages.map((u) => u.namespace))].sort()
    const listed = new Set<string>(CLIENT_NAMESPACES)

    it("scans a plausible number of client files", () => {
        expect(clientFiles).toBeGreaterThan(20)
        expect(usages.length).toBeGreaterThan(10)
    })

    it("has no client useTranslations() call that cannot be resolved to a literal namespace", () => {
        // Pass a string literal (useTranslations("ns")) so this guard can see it; a bare
        // useTranslations() or useMessages() would need the whole catalogue on the client.
        expect(unresolvable).toEqual([])
    })

    it("lists every namespace a client component reads", () => {
        const missing = used
            .filter((ns) => !listed.has(ns))
            .map((ns) => `${ns}  (${[...new Set(usages.filter((u) => u.namespace === ns).map((u) => u.file))].join(", ")})`)
        expect(missing, "add these to CLIENT_NAMESPACES in i18n/client-namespaces.ts").toEqual([])
    })

    it("does not list namespaces no client component reads", () => {
        const stale = [...listed].filter((ns) => !used.includes(ns))
        expect(stale, "remove these from CLIENT_NAMESPACES — they only bloat every page").toEqual([])
    })

    it("only lists namespaces that exist in both en.json and ar.json", () => {
        const absent = [...listed].filter((ns) => !(ns in en) || !(ns in ar))
        expect(absent).toEqual([])
    })

    it("pickMessages keeps only the listed namespaces", () => {
        const picked = pickMessages(en as never)
        expect(Object.keys(picked).sort()).toEqual([...listed].sort())
        expect(pickMessages({ a: { x: "1" }, b: { y: "2" } }, ["a", "missing"])).toEqual({ a: { x: "1" } })
    })
})
