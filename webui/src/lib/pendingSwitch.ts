/**
 * The session this window is switching to, from the click until the server
 * reports this window runs it (or the switch fails or takes too long). The
 * sidebar marks that row at once, so a switch answers the click straight away
 * instead of after the server has stopped one session and opened the other.
 */
import { useSyncExternalStore } from "react"

export interface PendingSwitch {
  /** The sidebar entry's id. */
  id: string
  /** The session id it switches to, when known: seeing it as this window's own ends the wait. */
  sessionId?: string
  /** The session id this window ran when the switch started: seeing another ends the wait too. */
  from?: string
}

/** The longest the row stays marked should the server never report the switch. */
const MOST_MS = 30_000

let current: PendingSwitch | undefined
let timer = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** The switch under way, if any (outside React). */
export function pendingNow(): PendingSwitch | undefined {
  return current
}

export function startSwitch(next: PendingSwitch): void {
  current = next
  window.clearTimeout(timer)
  timer = window.setTimeout(endSwitch, MOST_MS)
  emit()
}

export function endSwitch(): void {
  if (!current) return
  current = undefined
  window.clearTimeout(timer)
  emit()
}

/** End the wait once this window's session is no longer the one it left. */
export function sawSession(sessionId: string | undefined): void {
  if (!current || !sessionId) return
  if (sessionId === current.sessionId || (current.from && sessionId !== current.from)) endSwitch()
}

export function usePendingSwitch(): PendingSwitch | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
}
