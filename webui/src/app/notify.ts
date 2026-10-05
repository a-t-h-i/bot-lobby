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
import { useApiRead } from "./useApiRead"
import { selectedProject } from "@/lib/project"
import { PromptSeen, promptIdentity, dialogIdentity, deliveryIdentity } from "@/lib/promptSeen"
import { droplet, useSoundUnlock } from "./sound"
import type { WebPrompt } from "@protocol"
import { toast } from "@/lib/toast"
import { go } from "./router"

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

interface LobbyLike { task?: { state?: string; title?: string } }
function browserSeen(): PromptSeen { try { return new PromptSeen(sessionStorage) } catch { return new PromptSeen() } }
function promptId(project: string, prompt: WebPrompt): string {
  const payload = prompt.payload as { dialog?: { id?: string }; key?: string } | undefined
  return prompt.kind === "sessionDialog" && payload?.dialog?.id ? dialogIdentity(project, prompt.sessionId ?? payload.key ?? prompt.from, payload.dialog.id) : promptIdentity(project, prompt.id)
}

function useNotificationContext() {
  const enabled = useNotificationsEnabled()
  useSoundUnlock()
  useStoreVersion()
  const tasks = useApiRead("tasks.list", {}, ["tasks"])
  const sessions = useApiRead("sessions.list", {}, ["sessions"])
  const prompts = lobbyStore.get("prompts")
  const lobby = lobbyStore.get("lobby").data as LobbyLike | undefined
  const seen = useRef<PromptSeen>(browserSeen())
  const quiet = useRef(new Set(["prompts", "sessions", "delivery"]))
  const previousState = useRef<string | undefined>(undefined)
  const project = selectedProject() ?? "current"
  const connection = lobbyStore.status().connection
  const lastConnection = useRef(connection)
  return { enabled, tasks, sessions, prompts, lobby, seen, quiet, previousState, project, connection, lastConnection }
}

type NotificationContext = ReturnType<typeof useNotificationContext>
function announce(context: NotificationContext, channel: string, ids: string[], body: string, ready: boolean) {
  if (!ready) return
  const { seen, project, quiet, enabled } = context
  const fresh = seen.current.observe(`${project}:${channel}`, ids, quiet.current.has(channel))
  quiet.current.delete(channel)
  if (!fresh.length) return
  fresh.forEach(() => droplet())
  if (enabled && canNotify()) show(body)
  if (channel === "delivery") toast.info(body, { action: { label: "Review tasks", onClick: () => go("#/tasks") } })
}

function announcePrompts(context: NotificationContext) {
  const { prompts, sessions, tasks, project } = context
  const pending = (prompts.data as { prompts?: WebPrompt[] } | undefined)?.prompts
  announce(context, "prompts", (pending ?? []).map((p) => promptId(project, p)), "A question is waiting for you.", Boolean(pending) && !prompts.loading)
  const dialogs = sessions.data?.background.flatMap((s) => s.dialogs.map((d) => dialogIdentity(project, s.sessionId ?? s.key, d.id))) ?? []
  announce(context, "sessions", dialogs, "A background session is asking something.", Boolean(sessions.data) && !sessions.loading)
  const reviews = tasks.data?.rows.filter((r) => r.delivery && (r.delivery.status === "pending_approval" || r.delivery.status === "deferred" || r.delivery.status === "recoverable_failure")).map((r) => deliveryIdentity(project, r.id, r.delivery!.reviewId)) ?? []
  announce(context, "delivery", reviews, "Completed work is ready for delivery review in Tasks.", Boolean(tasks.data) && !tasks.loading)
}

function updateNotifications(context: NotificationContext) {
  const { lastConnection, connection, quiet, previousState, lobby, enabled } = context
  if (lastConnection.current !== connection || connection !== "live") {
    lastConnection.current = connection
    quiet.current = new Set(["prompts", "sessions", "delivery"])
    previousState.current = undefined
    return
  }
  announcePrompts(context)
  const state = lobby?.task?.state ?? "", done = outcome(state)
  if (previousState.current && done && state !== previousState.current && enabled && canNotify()) show(`${lobby?.task?.title ?? "The task"} ${done}.`)
  previousState.current = state
}

/** Quiet snapshots, identity-based transitions, independent sound and desktop preferences. */
export function useDesktopNotifications(): void {
  const context = useNotificationContext()
  const { connection, enabled, project, prompts, sessions, tasks, lobby } = context
  useEffect(() => updateNotifications(context), [connection, enabled, project, prompts.data, prompts.loading, sessions.data, sessions.loading, tasks.data, tasks.loading, lobby])
}
