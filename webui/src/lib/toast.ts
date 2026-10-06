/**
 * Toasts, one at a time. `toast()` queues a message; the Toaster shows the
 * first, then the next, never two together. A message already waiting is not
 * queued twice (a repeat that brings an action gives it to the first), and
 * when more are waiting the one on screen leaves sooner.
 */
import { useSyncExternalStore } from "react"

export type ToastKind = "info" | "success" | "warning" | "error"

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  /** How long it stays, in ms. */
  duration: number
  action?: { label: string; onClick: () => void }
}

export interface ToastOptions {
  action?: { label: string; onClick: () => void }
  duration?: number
}

/** The most that wait behind the one on screen; older ones are dropped. */
const MAX_WAITING = 3
const DURATION: Record<ToastKind, number> = { info: 3600, success: 3000, warning: 5000, error: 6000 }

let current: ToastItem | undefined
let waiting: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function push(kind: ToastKind, message: string, options?: ToastOptions): void {
  const text = message.trim()
  if (!text) return
  const same = current?.message === text ? current : waiting.find((item) => item.message === text)
  if (same) {
    // The server's copy of an action's notice often lands first, without the
    // action's Undo or Watch: the page's copy brings it to the one shown.
    if (options?.action && !same.action) {
      const upgraded = { ...same, action: options.action }
      if (same === current) current = upgraded
      else waiting = waiting.map((item) => (item === same ? upgraded : item))
      emit()
    }
    return
  }
  const item: ToastItem = { id: ++seq, kind, message: text, duration: options?.duration ?? DURATION[kind], ...(options?.action ? { action: options.action } : {}) }
  if (!current) current = item
  else waiting = [...waiting, item].slice(-MAX_WAITING)
  emit()
}

/** Take the one on screen off; the next waiting one comes up. */
export function dismissToast(id: number): void {
  if (current?.id !== id) return
  current = waiting[0]
  waiting = waiting.slice(1)
  emit()
}

type Show = (message: string, options?: ToastOptions) => void

export const toast: Show & { success: Show; error: Show; warning: Show; info: Show } = Object.assign(
  (message: string, options?: ToastOptions) => push("info", message, options),
  {
    success: (message: string, options?: ToastOptions) => push("success", message, options),
    error: (message: string, options?: ToastOptions) => push("error", message, options),
    warning: (message: string, options?: ToastOptions) => push("warning", message, options),
    info: (message: string, options?: ToastOptions) => push("info", message, options),
  }
)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The toast on screen, and how many wait behind it. */
export function useToast(): { item: ToastItem | undefined; waiting: number } {
  const item = useSyncExternalStore(subscribe, () => current, () => undefined)
  const count = useSyncExternalStore(subscribe, () => waiting.length, () => 0)
  return { item, waiting: count }
}
