/**
 * The browser's install prompt, captured on the way in (the Settings page may
 * not be mounted yet when it fires). The manifest and service worker make the
 * app installable; this only offers the shortcut. Nothing is stored.
 */
import { useSyncExternalStore } from "react"

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
