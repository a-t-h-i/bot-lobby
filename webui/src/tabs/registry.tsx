/**
 * Route → tab body. The tab switch is exhaustive over `TabId`, so adding a
 * tab to the shared list fails the build until it has a body here.
 */
import type { ReactNode } from "react"
import type { Route } from "@/app/router"
import { GitTab } from "./git/GitTab"
import { IssuesTab } from "./issues/IssuesTab"
import { KnowledgeTab } from "./knowledge/KnowledgeTab"
import { ExcalidrawTab } from "./excalidraw/ExcalidrawTab"
import { LobbyTab } from "./lobby/LobbyTab"
import { MetricsTab } from "./metrics/MetricsTab"
import { SettingsTab } from "./settings/SettingsTab"
import { PlanTab } from "./plan/PlanTab"
import { QuickfixTab } from "./quickfix/QuickfixTab"
import { SessionsTab } from "./sessions/SessionsTab"
import { TasksTab } from "./tasks/TasksTab"

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
  if (route.kind === "sessions") return <SessionsTab id={detailId(route.key ? [route.key] : [])} />
  switch (route.tab) {
    case "lobby":
      return <LobbyTab />
    case "tasks":
      return <TasksTab id={detailId(route.rest)} />
    case "plan":
      return <PlanTab />
    case "quickfix":
      return <QuickfixTab id={detailId(route.rest)} />
    case "issues":
      return <IssuesTab rest={route.rest} />
    case "metrics":
      return <MetricsTab />
    case "git":
      return <GitTab rest={route.rest} />
    case "knowledge":
      return <KnowledgeTab agent={route.rest[0]} file={route.rest[1]} />
    case "excalidraw":
      return <ExcalidrawTab id={detailId(route.rest)} />
  }
}
