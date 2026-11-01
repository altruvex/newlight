"use client"

const STORAGE_KEY = "newlight.admin.notification-sound"

export function soundEnabled(): boolean {
    if (typeof window === "undefined") return false
    try {
        return window.localStorage.getItem(STORAGE_KEY) !== "off"
    } catch {
        return false
    }
}

const CHANGE_EVENT = "newlight.admin.notification-sound-change"

export function setSoundEnabled(enabled: boolean): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off")
    } catch {
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
}

// For useSyncExternalStore: the preference lives in localStorage, so it is an external store,
// not component state. Same-tab writes raise CHANGE_EVENT; other tabs arrive as "storage".
export function subscribeSound(onChange: () => void): () => void {
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener("storage", onChange)
    return () => {
        window.removeEventListener(CHANGE_EVENT, onChange)
        window.removeEventListener("storage", onChange)
    }
}

let context: AudioContext | null = null

export function playChime(): void {
    if (typeof window === "undefined" || !soundEnabled()) return

    try {
        const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        context ??= new Ctor()
        if (context.state === "suspended") void context.resume()

        const now = context.currentTime
        note(context, 880, now, 0.09)
        note(context, 1318.5, now + 0.09, 0.13)
    } catch {
    }
}

function note(ctx: AudioContext, frequency: number, start: number, duration: number): void {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = "sine"
    oscillator.frequency.value = frequency

    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
}
