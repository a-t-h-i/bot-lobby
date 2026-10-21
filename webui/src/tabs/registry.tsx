/**
 * Route → tab body. The tab switch is exhaustive over `TabId`, so adding a
 * tab to the shared list fails the build until it has a body here.
 */
import type { ReactNode } from "react"
import type { Route } from "@/app/router"
import { GitTab } from "./git/GitTab"
import { KnowledgeTab } from "./knowledge/KnowledgeTab"
import { taskRoute } from "@/app/taskRoute"
import { LobbyTab } from "./lobby/LobbyTab"
import { SettingsTab } from "./settings/SettingsTab"
import { PlanTab } from "./plan/PlanTab"
import { TasksTab } from "./tasks/TasksTab"

export const goKey = { l: "lobby", p: "plan", t: "tasks", u: "git", n: "knowledge", e: "settings" } as const

export function routeBody(route: Route): ReactNode {
  if (route.kind === "settings") return <SettingsTab />
  switch (route.tab) {
    case "lobby":
      return <LobbyTab />
    case "tasks":
      return <TasksTab {...taskRoute(route.rest)} />
    case "plan":
      return <PlanTab rest={route.rest} />
    case "git":
      return <GitTab rest={route.rest} />
    case "knowledge":
      return <KnowledgeTab rest={route.rest} />
  }
}
