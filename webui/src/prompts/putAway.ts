/**
 * Whether the questions are put away (Later, Esc, or the X). Put away they
 * stay put away, through a page reload too (`sessionStorage`, this tab only),
 * until the user brings them back: the header's pill, or the Plan tab's
 * Answer questions. Nothing reopens them on its own.
 */
import { useSyncExternalStore } from "react"

const KEY = "bot-lobby.questionsPutAway"
const listeners = new Set<() => void>()
let memory: boolean | undefined

function read(): boolean {
  if (memory !== undefined) return memory
  try {
    memory = sessionStorage.getItem(KEY) === "1"
  } catch {
    memory = false
  }
  return memory
}

/** Put the questions away (`true`) or bring them back (`false`). */
export function setPutAway(value: boolean): void {
  if (read() === value) return
  memory = value
  try {
    if (value) sessionStorage.setItem(KEY, "1")
    else sessionStorage.removeItem(KEY)
  } catch {
    // The choice then lasts only until the page reloads.
  }
  for (const listener of [...listeners]) listener()
}

/** Bring put-away questions back into view. */
export function reopenQuestions(): void {
  setPutAway(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePutAway(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
