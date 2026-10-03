/**
 * Which panes the user folded away, remembered in this browser only
 * (`localStorage`, never sent anywhere). Every read and write is guarded: a
 * blocked store just means the panes open as usual.
 */
import { useCallback, useSyncExternalStore } from "react"

const PREFIX = "bot-lobby.collapsed."
const listeners = new Set<() => void>()
const memory = new Map<string, boolean>()

function read(key: string): boolean {
  if (memory.has(key)) return memory.get(key)!
  try {
    return localStorage.getItem(PREFIX + key) === "1"
  } catch {
    return false
  }
}

function write(key: string, value: boolean): void {
  memory.set(key, value)
  try {
    localStorage.setItem(PREFIX + key, value ? "1" : "0")
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

/** Whether `key`'s pane is folded away, and a way to flip it. */
export function useCollapsed(key: string): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, () => read(key), () => false)
  const toggle = useCallback(() => write(key, !read(key)), [key])
  return [collapsed, toggle]
}
