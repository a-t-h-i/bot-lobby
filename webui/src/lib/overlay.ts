/**
 * Only one pop-up is ever on screen. An overlay (a question, a confirmation,
 * the key help, a detail sheet) asks for the one slot while it wants to be
 * open; the highest priority holds it, the earliest asker wins a tie, and the
 * others stay closed (their state is kept) until the slot is free again.
 * Toasts wait while any overlay holds the slot.
 */
import { useEffect, useId, useSyncExternalStore } from "react"

interface Entry {
  id: string
  priority: number
  order: number
}

let entries: Entry[] = []
let seq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function holder(): string | undefined {
  let best: Entry | undefined
  for (const entry of entries) {
    if (!best || entry.priority > best.priority || (entry.priority === best.priority && entry.order < best.order)) best = entry
  }
  return best?.id
}

/** Priorities: a question beats everything; confirmations beat the help and detail sheets. */
export const PRIORITY = { question: 30, confirm: 20, help: 10, sheet: 5 } as const

/** Whether this overlay may show now. Pass whether it wants to be open. */
export function useOverlaySlot(wantsOpen: boolean, priority: number): boolean {
  const id = useId()
  useEffect(() => {
    if (!wantsOpen) return
    entries = [...entries, { id, priority, order: ++seq }]
    emit()
    return () => {
      entries = entries.filter((entry) => entry.id !== id)
      emit()
    }
  }, [wantsOpen, priority, id])
  const current = useSyncExternalStore(subscribe, holder, () => undefined)
  return wantsOpen && current === id
}

/** Whether any overlay holds the slot (the composer and the toasts give way). */
export function useAnyOverlay(): boolean {
  return useSyncExternalStore(subscribe, () => entries.length > 0, () => false)
}
