"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createLocation, deleteLocation, renameLocation, setDefaultLocation } from "@/app/action/reference-actions"

interface Location {
    id: string
    name: string
    isDefault: boolean
    onHand: number
    hasMovements: boolean
}

export function LocationsPanel({ locations }: { locations: Location[] }) {
    const router = useRouter()
    const [pending, start] = useTransition()
    const [name, setName] = useState("")
    const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

    const call = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
        start(async () => {
            const result = await fn()
            if (result.ok) { toast.success(result.message ?? "Saved."); after?.(); router.refresh() }
            else toast.error(result.error ?? "Something went wrong.")
        })

    return (
        <div className="space-y-6">
            <section className="rounded-lg border bg-card p-3 space-y-3 max-w-xl">
                <h2 className="font-semibold">Add a location</h2>
                <p className="text-sm text-muted-foreground">
                    Every movement, adjustment and sale is recorded against one. New stock goes to the default
                    unless something says otherwise.
                </p>
                <div className="space-y-1.5">
                    <Label htmlFor="l-name">Name</Label>
                    <Input id="l-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Second warehouse" />
                </div>
                <Button disabled={pending || !name.trim()} onClick={() => call(() => createLocation(name), () => setName(""))}>
                    {pending ? "Saving…" : "Add"}
                </Button>
            </section>

            <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Location</TableHead>
                            <TableHead className="text-right">On hand</TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {locations.map((location) => (
                            <TableRow key={location.id}>
                                <TableCell>
                                    {renaming?.id === location.id ? (
                                        <form
                                            className="flex gap-2"
                                            onSubmit={(e) => {
                                                e.preventDefault()
                                                call(() => renameLocation(location.id, renaming.value), () => setRenaming(null))
                                            }}
                                        >
                                            <Input value={renaming.value} onChange={(e) => setRenaming({ id: location.id, value: e.target.value })} className="h-8 w-56" />
                                            <Button type="submit" size="sm" variant="secondary" disabled={pending}>Save</Button>
                                            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                                        </form>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{location.name}</span>
                                            {location.isDefault && <Badge>default</Badge>}
                                        </div>
                                    )}
                                    <div className="text-xs text-muted-foreground font-mono mt-1">{location.id}</div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{location.onHand}</TableCell>
                                <TableCell className="text-right whitespace-nowrap">
                                    {renaming?.id !== location.id && (
                                        <Button size="sm" variant="secondary" disabled={pending}
                                            onClick={() => setRenaming({ id: location.id, value: location.name })}>
                                            Rename
                                        </Button>
                                    )}
                                    {!location.isDefault && !location.hasMovements && (
                                        <Button size="sm" variant="secondary" className="ml-2" disabled={pending}
                                            onClick={() => call(() => setDefaultLocation(location.id))}>
                                            Make default
                                        </Button>
                                    )}
                                    {!location.isDefault && (
                                        <Button size="sm" variant="ghost" className="ml-2 text-destructive hover:text-destructive"
                                            disabled={pending} onClick={() => call(() => deleteLocation(location.id))}>
                                            Delete
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
