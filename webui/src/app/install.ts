/**
 * The browser's install prompt, captured on the way in (the Settings page may
 * not be mounted yet when it fires). The manifest and service worker make the
 * app installable; this only offers the shortcut. Nothing is stored.
 */
import { useEffect, useState, useSyncExternalStore } from "react"

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>
}

let deferred: InstallPromptEvent | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    emit()
  })
  window.addEventListener("appinstalled", () => {
    deferred = undefined
    emit()
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface InstallPrompt {
  available: boolean
  install: () => Promise<void>
}

/** Whether the browser offered an install prompt, and how to use it. */
export function useInstallPrompt(): InstallPrompt {
  const available = useSyncExternalStore(subscribe, () => deferred !== undefined, () => false)
  const install = async (): Promise<void> => {
    const event = deferred
    if (!event) return
    await event.prompt().catch(() => undefined)
    await event.userChoice?.catch(() => undefined)
    deferred = undefined
    emit()
  }
  return { available, install }
}

/** Whether the page already runs as an installed app (fullscreen or standalone). */
export function useInstalled(): boolean {
  const query = "(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)"
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const change = () => setInstalled(media.matches)
    media.addEventListener("change", change)
    return () => media.removeEventListener("change", change)
  }, [])
  return installed
}

export interface FullscreenControl {
  supported: boolean
  on: boolean
  toggle: () => Promise<void>
}

/** The browser's fullscreen for this page (what `F11` does), where the browser offers it. */
export function useFullscreen(): FullscreenControl {
  const supported = typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function"
  const [on, setOn] = useState(() => typeof document !== "undefined" && document.fullscreenElement !== null)
  useEffect(() => {
    const change = () => setOn(document.fullscreenElement !== null)
    document.addEventListener("fullscreenchange", change)
    return () => document.removeEventListener("fullscreenchange", change)
  }, [])
  const toggle = async (): Promise<void> => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
    else await document.documentElement.requestFullscreen().catch(() => undefined)
  }
  return { supported, on, toggle }
}
