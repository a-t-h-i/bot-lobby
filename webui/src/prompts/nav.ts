/**
 * Keyboard moves for forms and lists that hold several controls marked
 * `data-nav`: one control has focus, the arrow keys (or `j`/`k`) move it.
 */

/** The controls the arrow keys move between, in page order. */
export function navItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-nav]")].filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true")
}

/** Focus the control `delta` places from `from` (or the first/last one); returns whether focus moved. */
export function moveNav(root: ParentNode, from: Element | null, to: number | "first" | "last"): boolean {
  const items = navItems(root)
  if (items.length === 0) return false
  const at = from ? items.findIndex((el) => el === from || el.contains(from)) : -1
  const next = to === "first" ? 0 : to === "last" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, (at < 0 ? (to > 0 ? -1 : items.length) : at) + to))
  const target = items[next]
  if (!target || target === from) return false
  target.focus({ preventScroll: false })
  return true
}

/** Whether the key press is going into a text field (so letters and arrows belong to it). */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(target.type)) || (target instanceof HTMLElement && target.isContentEditable)
}

/** `ArrowDown`/`j` → 1, `ArrowUp`/`k` → -1, otherwise 0. */
export function verticalStep(key: string, vim = true): number {
  if (key === "ArrowDown" || (vim && key === "j")) return 1
  if (key === "ArrowUp" || (vim && key === "k")) return -1
  return 0
}

/** `ArrowRight`/`l` → 1, `ArrowLeft`/`h` → -1, otherwise 0. */
export function horizontalStep(key: string, vim = true): number {
  if (key === "ArrowRight" || (vim && key === "l")) return 1
  if (key === "ArrowLeft" || (vim && key === "h")) return -1
  return 0
}

/** What a list's arrow keys step through: its buttons and links. */
const ROW_ITEMS = "button:not([disabled]), a[href], [role='button']:not([aria-disabled='true'])"

/** The visible buttons and links in `root`, in page order. */
export function rowItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROW_ITEMS)].filter((el) => el.offsetParent !== null)
}

/** Move focus `to` places from the focused row of `root` (clamped; no wrap). */
export function stepRows(root: HTMLElement, from: Element | null, to: number | "first" | "last"): void {
  const items = rowItems(root)
  if (items.length === 0) return
  const at = from ? items.findIndex((el) => el === from || el.contains(from)) : -1
  const next = to === "first" ? 0 : to === "last" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, (at < 0 ? (to > 0 ? -1 : items.length) : at) + to))
  items[next]?.focus()
}

/** Use the row's existing onClick rather than keeping a second selection store. */
export function selectRow(delta: number, root = document.querySelector("[data-pane='list']")): void {
  if (!root) return
  const rows = [...root.querySelectorAll<HTMLButtonElement>("button[data-row]")].filter((row) => row.offsetParent !== null)
  const current = rows.findIndex((row) => row.getAttribute("aria-current") === "true")
  const index = Math.max(0, Math.min(rows.length - 1, current < 0 ? (delta > 0 ? 0 : rows.length - 1) : current + delta))
  rows[index]?.click()
  rows[index]?.focus({ preventScroll: true })
  rows[index]?.scrollIntoView({ block: "nearest" })
}

/** The open row of a list: the one marked current, else the first. */
export function currentRow(root: HTMLElement): HTMLElement | undefined {
  return root.querySelector<HTMLElement>("[aria-current='true']") ?? rowItems(root)[0]
}

/** From the tab bar into the page: the open row of its list, else the page itself. */
export function focusPage(): boolean {
  const main = document.getElementById("main")
  if (!main) return false
  const list = main.querySelector<HTMLElement>("[data-pane='list']")
  const target = (list ? currentRow(list) : undefined) ?? rowItems(main)[0] ?? main
  target.focus()
  return true
}

/** Back from the page to the active tab; on Sessions and Settings, which are no tab, to the page itself. */
export function focusTab(): boolean {
  const tab = document.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")
  if (tab) {
    tab.focus({ preventScroll: true })
    return true
  }
  const main = document.getElementById("main")
  main?.focus({ preventScroll: true })
  return Boolean(main)
}

/** Set while the arrow keys walk the tab bar, so the page keeps focus on the bar instead of the message box. */
export const tabWalk = { active: false }
