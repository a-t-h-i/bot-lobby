/**
 * Bare-key shortcuts for the buttons on a page: `E` archives, `Delete` deletes.
 * A hotkey answers only while you are not typing, no pop-up is open (unless it
 * lives in that pop-up) and no modifier is held, so it never fights the
 * browser, the message box or the page's own `j`/`k`/`g` keys. Alt and Ctrl
 * chords stay with `useLobbyKeys`.
 */
import { useEffect, useRef } from "react"
import { hasOverlay } from "@/lib/overlay"
import { isTyping } from "@/prompts/nav"

/** The keys the page already owns: tabs, rows, panes, the `g` prefix, search, help, the project switcher and the theme. */
const RESERVED = new Set(["g", "j", "k", "h", "l", "d", "p", "/", "?", "1", "2", "3", "4", "5", "6", "7", "8", "9"])

/** Whether `spec` is a key a button can be bound to: one letter the page does not own, or `Delete`. */
export function isHotkey(spec: string | undefined): spec is string {
  if (!spec) return false
  const lower = spec.toLowerCase()
  return lower === "delete" || (/^[a-z]$/.test(lower) && !RESERVED.has(lower))
}

function matches(event: KeyboardEvent, spec: string): boolean {
  if (spec.toLowerCase() === "delete") return event.key === "Delete" || event.key === "Backspace"
  return event.key.toLowerCase() === spec.toLowerCase()
}

/** Whether a pop-up, menu or list box is open on the page. */
function popupOpen(): boolean {
  return hasOverlay() || Boolean(document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']"))
}

interface HotkeyOptions {
  /** Off while false (a disabled button, a form that is open). */
  enabled?: boolean
  /** True for a key that belongs to the pop-up it is rendered in. */
  inDialog?: boolean
}

/**
 * Run `run` when `spec` is pressed on its own. The project switcher listens for `P` itself, so a
 * key that is `RESERVED` can still be bound here by the component that owns it (`isHotkey` is for buttons).
 */
export function useHotkey(spec: string | undefined, run: () => void, { enabled = true, inDialog = false }: HotkeyOptions = {}): void {
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    if (!enabled || !spec) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!matches(event, spec)) return
      if (isTyping(event.target)) return
      if (!inDialog && popupOpen()) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [spec, enabled, inDialog])
}
