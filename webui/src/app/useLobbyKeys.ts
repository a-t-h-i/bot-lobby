/**
 * The web key map from `status.get`'s `keys` (and the per-tab `Alt+N` jumps
 * from `tabs`). Chords are matched on `KeyboardEvent.code` rather than the
 * printed key, so layouts do not move them. Tab/Shift+Tab are left alone so
 * they keep moving focus; Ctrl+F and Ctrl+S only override the browser while
 * focus is inside the app.
 */
import { useEffect } from "react"
import type { KeyInfo, TabInfo } from "@protocol"

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

export function useLobbyKeys({ enabled, keys, tabs, insideApp, onAction, onTab }: LobbyKeyOptions): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const jump = tabFor(event, tabs)
      if (jump) {
        event.preventDefault()
        onTab(jump)
        return
      }
      const action = actionFor(event, keys)
      if (!action) return
      if (action === "search" || action === "savePlan") {
        if (!insideApp()) return
        event.preventDefault()
      }
      onAction(action)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, keys, tabs, insideApp, onAction, onTab])
}
