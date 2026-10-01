/**
 * Route → tab body. The tab switch is exhaustive over `TabId`, so adding a
 * tab to the shared list fails the build until it has a body here.
 */
import type { ReactNode } from "react"
import type { Route } from "@/app/router"
import { LobbyTab } from "./lobby/LobbyTab"
import {
  ExcalidrawTab,
  GitTab,
  IssuesTab,
  KnowledgeTab,
  MetricsTab,
  PlanTab,
  QuickFixTab,
  SessionsTab,
  SettingsTab,
  TasksTab,
} from "./placeholders"

export function routeBody(route: Route): ReactNode {
  if (route.kind === "settings") return <SettingsTab />
  if (route.kind === "sessions") return <SessionsTab detail={route.key} />
  const detail = route.rest.length > 0 ? route.rest.join(" / ") : undefined
  switch (route.tab) {
    case "lobby":
      return <LobbyTab />
    case "tasks":
      return <TasksTab detail={detail} />
    case "plan":
      return <PlanTab detail={detail} />
    case "quickfix":
      return <QuickFixTab detail={detail} />
    case "issues":
      return <IssuesTab detail={detail} />
    case "metrics":
      return <MetricsTab detail={detail} />
    case "git":
      return <GitTab detail={detail} />
    case "knowledge":
      return <KnowledgeTab detail={detail} />
    case "excalidraw":
      return <ExcalidrawTab detail={detail} />
  }
}
