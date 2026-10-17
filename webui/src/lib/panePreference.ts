/** Below this width an open sidebar crowds the page, so until the user picks, it starts folded there. */
export const NARROW_SIDEBAR = "(max-width: 1023.98px)"

/** Thinking is a transient modal; stored activity preferences remain durable; the sidebar, unpicked, folds on a narrow window. */
export function initiallyCollapsed(key: string, stored?: string | null): boolean {
  if (key === "app.sidebar" && (stored === null || stored === undefined)) {
    const media = (globalThis as { matchMedia?: (query: string) => { matches: boolean } }).matchMedia
    return typeof media === "function" && media(NARROW_SIDEBAR).matches
  }
  return key === "lobby.thinking" || stored === "1"
}
