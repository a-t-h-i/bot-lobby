/**
 * Opt-in browser notifications. The preference is off until the user turns it
 * on in Settings (the click is what asks for permission); nothing here ever
 * asks on its own. While the page is hidden, one notification is shown for
 * each of: a question becoming waiting, a task reaching a terminal state, and
 * a background session (a `sessionDialog` prompt) asking something. The page
 * is never notified while it is visible. The preference is a page setting, so
 * it lives in localStorage and is never sent to the server.
 */
import { useEffect, useRef, useSyncExternalStore } from "react"
import { lobbyStore } from "@/lib/store"
import { useStoreVersion } from "./hooks"

const KEY = "bot-lobby.notifications"
const ICON = "/icon-192.png"
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Whether the user has turned notifications on. */
export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "on"
  } catch {
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off")
  } catch {
    // A blocked store just means the preference does not stick.
  }
  emit()
}

/** The preference as a React binding, for the Settings toggle. */
export function useNotificationsEnabled(): boolean {
  return useSyncExternalStore(subscribe, notificationsEnabled, () => false)
}

/** Ask for permission and remember the choice; called on the user's toggle only. */
export async function enableNotifications(): Promise<"granted" | "denied" | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported"
  if (Notification.permission === "default") {
    await Notification.requestPermission().catch(() => undefined)
  }
  if (Notification.permission !== "granted") return "denied"
  setEnabled(true)
  return "granted"
}

/** Turn the preference off without touching the browser's permission. */
export function disableNotifications(): void {
  setEnabled(false)
}

/** A terminal task state reads as finished or dropped. */
function outcome(state: string): string | undefined {
  if (state === "completed") return "finished"
  if (state === "abandoned") return "dropped"
  return undefined
}

function canNotify(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden
}

function show(body: string): void {
  try {
    new Notification("bot-lobby", { body, icon: ICON, tag: "bot-lobby" })
  } catch {
    // A refused notification must never break the page.
  }
}

interface PromptLike {
  kind?: string
}
interface LobbyLike {
  task?: { state?: string; title?: string }
}

/** Watch the store and notify only on a transition, only while hidden. */
export function useDesktopNotifications(): void {
  const enabled = useNotificationsEnabled()
  useStoreVersion()
  const prompts = lobbyStore.get("prompts").data as { prompts?: PromptLike[] } | undefined
  const lobby = lobbyStore.get("lobby").data as LobbyLike | undefined
  const count = prompts?.prompts?.length ?? 0
  const state = lobby?.task?.state ?? ""
  const title = lobby?.task?.title
  const seen = useRef<{ count: number; state: string } | undefined>(undefined)

  useEffect(() => {
    const previous = seen.current
    seen.current = { count, state }
    if (!previous || !enabled || !canNotify()) return
    if (previous.count === 0 && count > 0) {
      const dialog = prompts?.prompts?.some((prompt) => prompt.kind === "sessionDialog")
      show(dialog ? "A background session is asking something." : "A question is waiting in the lobby.")
      return
    }
    const done = outcome(state)
    if (done && state !== previous.state) show(`${title ? `${title} ` : "The task "}${done}.`)
  }, [enabled, count, state, title, prompts])
}
