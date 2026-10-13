/**
 * Hash routing. The fragment is the route (`#/lobby`, `#/tasks/<id>`, …), so
 * the loopback server only ever serves one page and back/forward keep working.
 * An unknown fragment is replaced with `#/lobby` rather than pushed, so the
 * Back button never lands on a dead route.
 */
import { useEffect, useState } from "react"
import { TAB_IDS, type TabId } from "@shared"

export type Route =
  | { kind: "tab"; tab: TabId; rest: string[] }
  | { kind: "settings" }

const KNOWN = new Set<string>(TAB_IDS)

/** Where a retired address lives now, or `undefined` when it is current. */
export function legacyHash(hash: string): string | undefined {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean)
  if (parts[0] === "issues") return ["#/git/issues", ...parts.slice(1, 2)].join("/")
  if (parts[0] === "sessions" || parts[0] === "excalidraw" || parts[0] === "metrics") return "#/lobby"
  if (parts[0] === "tasks" && parts[1] === "board") return ["#/tasks", ...parts.slice(2, 3)].join("/")
  return undefined
}

/** The route a fragment names, or `undefined` when it names nothing. */
export function parseHash(hash: string): Route | undefined {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean)
  const head = parts[0]
  if (!head || head === "lobby") return { kind: "tab", tab: "lobby", rest: parts.slice(1) }
  if (head === "settings") return { kind: "settings" }
  if (KNOWN.has(head)) return { kind: "tab", tab: head as TabId, rest: parts.slice(1) }
  return undefined
}

/** The fragment for a tab, with an optional detail path after it. */
export function tabHash(tab: TabId, ...rest: string[]): string {
  const tail = rest.filter(Boolean).map((part) => `/${encodeURIComponent(part)}`).join("")
  return `#/${tab}${tail}`
}

/** Navigate; a no-op when the fragment already matches. */
export function go(hash: string): void {
  if (window.location.hash !== hash) window.location.hash = hash
}

/** The current route, kept in step with back/forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(legacyHash(window.location.hash) ?? window.location.hash) ?? { kind: "tab", tab: "lobby", rest: [] })
  useEffect(() => {
    const sync = () => {
      const moved = legacyHash(window.location.hash)
      const next = moved ? parseHash(moved) : parseHash(window.location.hash)
      if (moved || !next) window.history.replaceState(null, "", moved ?? "#/lobby")
      setRoute(next ?? { kind: "tab", tab: "lobby", rest: [] })
    }
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])
  return route
}
