/**
 * The web key map from `status.get`'s `keys` (and the per-tab `Alt+N` jumps
 * from `tabs`). Chords are matched on `KeyboardEvent.code` rather than the
 * printed key, so layouts do not move them. Tab/Shift+Tab are left alone so
 * they keep moving focus; Ctrl+F and Ctrl+S only override the browser while
 * focus is inside the app.
 */
import { useEffect } from "react"
import type { KeyInfo, TabInfo } from "@protocol"
import { goKey } from "@/tabs/registry"
import { hasOverlay } from "@/lib/overlay"
import { isTyping, selectRow } from "@/prompts/nav"

export interface LobbyKeyOptions {
  enabled: boolean
  keys: KeyInfo[]
  tabs: TabInfo[]
  insideApp: () => boolean
  onAction: (action: string) => void
  onTab: (id: string) => void
}

interface Chord {
  alt: boolean
  ctrl: boolean
  shift: boolean
  meta: boolean
  code: string
}

const NAMED: Record<string, string> = {
  tab: "Tab",
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  space: "Space",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  "]": "BracketRight",
  "[": "BracketLeft",
  "/": "Slash",
  "?": "Slash",
  ",": "Comma",
  ".": "Period",
}

function keyCode(part: string): string | undefined {
  if (part.length === 1 && /[a-z]/i.test(part)) return `Key${part.toUpperCase()}`
  if (part.length === 1 && /[0-9]/.test(part)) return `Digit${part}`
  return NAMED[part]
}

/** `alt+k` → its chord; `undefined` for a key the page does not know. */
export function parseChord(key: string): Chord | undefined {
  const chord: Chord = { alt: false, ctrl: false, shift: false, meta: false, code: "" }
  for (const part of key.toLowerCase().split("+")) {
    if (part === "alt") chord.alt = true
    else if (part === "ctrl" || part === "control") chord.ctrl = true
    else if (part === "shift") chord.shift = true
    else if (part === "meta" || part === "cmd") chord.meta = true
    else {
      const code = keyCode(part)
      if (!code) return undefined
      chord.code = code
    }
  }
  return chord.code ? chord : undefined
}

function matches(event: KeyboardEvent, chord: Chord): boolean {
  return (
    event.code === chord.code &&
    event.altKey === chord.alt &&
    event.ctrlKey === chord.ctrl &&
    event.shiftKey === chord.shift &&
    event.metaKey === chord.meta
  )
}

function matchKey(event: KeyboardEvent, key: string): boolean {
  const chord = parseChord(key)
  return chord ? matches(event, chord) : false
}

/** The action `event` triggers, if any. */
function actionFor(event: KeyboardEvent, keys: KeyInfo[]): string | undefined {
  for (const info of keys) if (matchKey(event, info.key)) return info.action
  return undefined
}

/** The tab `event` jumps to, if any. */
function tabFor(event: KeyboardEvent, tabs: TabInfo[]): string | undefined {
  for (const tab of tabs) if (matchKey(event, tab.key)) return tab.id
  return undefined
}

function bareBlocked(event: KeyboardEvent): boolean {
  return isTyping(event.target) || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || hasOverlay() || Boolean(document.querySelector("[role='dialog'], [role='menu'], [role='listbox']"))
}

function bareAction(event: KeyboardEvent, tabs: TabInfo[], onAction: LobbyKeyOptions["onAction"], onTab: LobbyKeyOptions["onTab"]): boolean {
  const digit = !event.shiftKey && /^[1-9]$/.test(event.key) ? tabs[Number(event.key) - 1] : undefined
  if (digit) onTab(digit.id)
  else if (event.key === "/") onAction("search")
  else if (event.key === "?") onAction("help")
  else if (event.key === "j" || event.key === "k") selectRow(event.key === "j" ? 1 : -1)
  else return false
  return true
}

function configured(event: KeyboardEvent, options: LobbyKeyOptions): boolean {
  const jump = tabFor(event, options.tabs)
  const action = actionFor(event, options.keys)
  if (!jump && !action) return false
  if ((action === "search" || action === "savePlan") && !options.insideApp()) return true
  event.preventDefault()
  if (jump) options.onTab(jump)
  else if (action) options.onAction(action)
  return true
}

function navigateBare(event: KeyboardEvent, options: LobbyKeyOptions, prefixUntil: number): number {
  if (event.key === "Escape") {
    if (Date.now() < prefixUntil) event.preventDefault()
    return 0
  }
  if (Date.now() < prefixUntil) {
    const tab = goKey[event.key as keyof typeof goKey]
    if (tab) { event.preventDefault(); options.onTab(tab) }
    return 0
  }
  if (event.key === "g") return Date.now() + 1500
  if (bareAction(event, options.tabs, options.onAction, options.onTab)) event.preventDefault()
  return 0
}

export function useLobbyKeys(options: LobbyKeyOptions): void {
  useEffect(() => {
    if (!options.enabled) return
    let prefixUntil = 0
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (!options.insideApp()) {
        // A pop-up holds focus outside the page. Only the key help still gets through: it waits for its turn.
        if (actionFor(event, options.keys) === "help") {
          event.preventDefault()
          options.onAction("help")
        }
        return
      }
      const bare = !event.altKey && !event.ctrlKey && !event.metaKey
      if (bare && bareBlocked(event)) { prefixUntil = 0; return }
      if (configured(event, options)) { prefixUntil = 0; return }
      prefixUntil = bare ? navigateBare(event, options, prefixUntil) : 0
    }
    // Run before pane-local keys so configured chords and g sequences win.
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [options.enabled, options.keys, options.tabs, options.insideApp, options.onAction, options.onTab])
}
