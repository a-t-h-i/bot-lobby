/**
 * Whether the terminal is open, whether it sits in the drawer or in a pop-up,
 * and how tall the drawer is, remembered in this browser only. Every read and write is guarded: a blocked store just means
 * the drawer starts closed at its usual height.
 */
import { useSyncExternalStore } from "react"

const OPEN_KEY = "bot-lobby.terminal.open"
const HEIGHT_KEY = "bot-lobby.terminal.height"
const POPUP_KEY = "bot-lobby.terminal.popup"
/** The drawer's height in px: as it starts, and as far as dragging its top takes it. */
export const TERMINAL_HEIGHT = { start: 280, min: 140 }

const listeners = new Set<() => void>()
let open: boolean | undefined
let height: number | undefined
let popup: boolean | undefined

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice then lasts until the page reloads.
  }
}

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function isOpen(): boolean {
  open ??= read(OPEN_KEY) === "1"
  return open
}

function currentHeight(): number {
  if (height === undefined) {
    const stored = Number(read(HEIGHT_KEY))
    height = stored >= TERMINAL_HEIGHT.min ? stored : TERMINAL_HEIGHT.start
  }
  return height
}

export function setTerminalOpen(next: boolean): void {
  open = next
  write(OPEN_KEY, next ? "1" : "0")
  emit()
}

/** Open or close the drawer (the terminal key, the bar's button). */
export function toggleTerminal(): void {
  setTerminalOpen(!isOpen())
}

export function setTerminalHeight(next: number): void {
  height = Math.max(TERMINAL_HEIGHT.min, Math.round(next))
  write(HEIGHT_KEY, String(height))
  emit()
}

export function useTerminalOpen(): boolean {
  return useSyncExternalStore(subscribe, isOpen, () => false)
}

export function useTerminalHeight(): number {
  return useSyncExternalStore(subscribe, currentHeight, () => TERMINAL_HEIGHT.start)
}

function inPopup(): boolean {
  popup ??= read(POPUP_KEY) === "1"
  return popup
}

/** Show the terminal in a pop-up over the page (true) or in the drawer under the composer (false). */
export function setTerminalPopup(next: boolean): void {
  popup = next
  write(POPUP_KEY, next ? "1" : "0")
  emit()
}

export function useTerminalPopup(): boolean {
  return useSyncExternalStore(subscribe, inPopup, () => false)
}
