/**
 * Route → tab body. The tab switch is exhaustive over `TabId`, so adding a
 * tab to the shared list fails the build until it has a body here.
 */
import { useEffect, type ReactNode } from "react"
import { go, type Route } from "@/app/router"
import { GitTab } from "./git/GitTab"
import { IssuesTab } from "./issues/IssuesTab"
import { KnowledgeTab } from "./knowledge/KnowledgeTab"
import { taskRoute } from "@/app/taskRoute"
import { ExcalidrawTab } from "./excalidraw/ExcalidrawTab"
import { LobbyTab } from "./lobby/LobbyTab"
import { MetricsTab } from "./metrics/MetricsTab"
import { SettingsTab } from "./settings/SettingsTab"
import { PlanTab } from "./plan/PlanTab"
import { QuickfixTab } from "./quickfix/QuickfixTab"
import { SessionsTab } from "./sessions/SessionsTab"
import { TasksTab } from "./tasks/TasksTab"
import { useMediaQuery } from "@/app/hooks"

export const goKey = { l: "lobby", p: "plan", t: "tasks", i: "issues", u: "git", n: "knowledge", q: "quickfix", m: "metrics", e: "settings", x: "excalidraw" } as const

/** An address that leads nowhere any more sends the page on to `to`. */
function Redirect({ to }: { to: string }) {
  useEffect(() => go(to), [to])
  return null
}

function MetricsRoute() {
  const phone = useMediaQuery("(max-width: 767.98px)")
  if (!phone) return <MetricsTab />
  return (
    <section className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <h1 className="text-lg font-medium">Metrics is unavailable on phones.</h1>
      <a href="#/lobby" className="btn-tint inline-flex min-h-11 items-center justify-center rounded-lg border px-5 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/40">Lobby</a>
    </section>
  )
}

/** The first path segment after the tab, decoded (`#/tasks/T-1` → `T-1`). */
function detailId(rest: string[]): string | undefined {
  const raw = rest[0]
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function routeBody(route: Route): ReactNode {
  if (route.kind === "settings") return <SettingsTab />
  // No list of sessions: a task's background session still opens its conversation here; the bare address is the Lobby.
  if (route.kind === "sessions") return route.key ? <SessionsTab id={detailId([route.key])!} /> : <Redirect to="#/lobby" />
  switch (route.tab) {
    case "lobby":
      return <LobbyTab />
    case "tasks":
      return <TasksTab {...taskRoute(route.rest)} />
    case "plan":
      return <PlanTab rest={route.rest} />
    case "quickfix":
      return <QuickfixTab id={detailId(route.rest)} />
    case "issues":
      return <IssuesTab rest={route.rest} />
    case "metrics":
      return <MetricsRoute />
    case "git":
      return <GitTab rest={route.rest} />
    case "knowledge":
      return <KnowledgeTab rest={route.rest} />
    case "excalidraw":
      return <ExcalidrawTab id={detailId(route.rest)} />
  }
}
