/**
 * Which panes the user folded away, remembered in this browser only
 * (`localStorage`, never sent anywhere). Every read and write is guarded: a
 * blocked store just means the panes open as usual.
 */
import { useCallback, useSyncExternalStore } from "react"
import { initiallyCollapsed } from "./panePreference"

const PREFIX = "bot-lobby.collapsed."
const listeners = new Set<() => void>()
const memory = new Map<string, boolean>()

function readCollapsed(key: string): boolean {
  if (memory.has(key)) return memory.get(key)!
  // Thinking is a transient dialog, always minimized on a fresh page load.
  if (key === "lobby.thinking") return initiallyCollapsed(key)
  try {
    return initiallyCollapsed(key, localStorage.getItem(PREFIX + key))
  } catch {
    return false
  }
}

function write(key: string, value: boolean): void {
  memory.set(key, value)
  try {
    if (key !== "lobby.thinking") localStorage.setItem(PREFIX + key, value ? "1" : "0")
  } catch {
    // The choice then lasts only until the page reloads.
  }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Flip `key`'s pane from outside a component (a keyboard shortcut). */
export function toggleCollapsed(key: string): void {
  write(key, !readCollapsed(key))
}

/** Whether `key`'s pane is folded away, and a way to flip it. */
export function useCollapsed(key: string): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, () => readCollapsed(key), () => initiallyCollapsed(key))
  const toggle = useCallback(() => write(key, !readCollapsed(key)), [key])
  return [collapsed, toggle]
}
