/**
 * The top of the window: where you are (workspace and branch), the numbered
 * tab pills in the middle, and what this session is doing on the right with
 * the way to Sessions, Settings and the light/dark switch. On narrow windows
 * the pills take a row of their own.
 */
import type { ReactNode } from "react"
import { GitBranch, Layers, Moon, Settings, Sun } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { useTheme } from "@/components/theme-provider"
import type { ConnectionState } from "@/lib/events"
import { cn } from "@/lib/utils"
import type { SnapshotTask, StatusInfo } from "@protocol"
import type { Route } from "./router.ts"

function Connection({ state }: { state: ConnectionState }) {
  if (state === "live") return <span title="Connected" aria-label="Connected" className="size-2 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_25%,transparent)]" />
  if (state === "connecting") {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner aria-hidden="true" role="presentation" className="size-3" />
        reconnecting…
      </span>
    )
  }
  return <span className="text-xs font-medium text-destructive">Connection lost</span>
}

function IconLink({ label, hint, href, active, children }: { label: string; hint: string; href: string; active: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "inline-flex size-10 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95",
            active && "bg-accent text-foreground"
          )}
        >
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent>
        {label} · <Kbd>{hint}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const dark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(dark ? "light" : "dark")}
          className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"
        >
          {dark ? <Sun aria-hidden="true" className="size-[1.1rem]" /> : <Moon aria-hidden="true" className="size-[1.1rem]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  )
}

export function Header({
  status,
  task,
  connection,
  route,
  tabs,
  extra,
  keys,
}: {
  status?: StatusInfo
  task?: SnapshotTask
  connection: ConnectionState
  route: Route
  tabs: ReactNode
  /** Shown before the status (the way back to a question put away). */
  extra?: ReactNode
  keys: Record<string, string>
}) {
  const name = status?.workspace.name ?? "bot-lobby"
  const branch = status?.branch ?? status?.workspace.branch
  const busy = status?.busy ?? false

  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 pt-3 pb-1 [grid-template-areas:'title_status'_'tabs_tabs'] min-[1560px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[1560px]:[grid-template-areas:'title_tabs_status']">
      <div className="flex min-w-0 items-center gap-2.5 [grid-area:title]">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent)]" />
        <span className="truncate text-sm font-semibold">{name}</span>
        {branch ? (
          <span className="inline-flex min-w-0 items-center gap-1 truncate rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <GitBranch aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
        ) : null}
      </div>
      <div className="min-w-0 [grid-area:tabs]">{tabs}</div>
      <div className="flex min-w-0 items-center justify-end gap-1 [grid-area:status]">
        {extra}
        <div className="mr-2 flex min-w-0 items-center gap-2 text-sm">
          {busy ? <Spinner aria-hidden="true" role="presentation" className="size-3.5" /> : null}
          {task ? (
            <span className="max-w-[16rem] truncate">
              <span className="font-medium">{task.id}</span> <span className="text-muted-foreground">{task.state.replace(/_/g, " ")}</span>
            </span>
          ) : (
            <span className="hidden max-w-[12rem] truncate text-muted-foreground md:inline">{status?.sessionName ?? "no task in this session"}</span>
          )}
          <Connection state={connection} />
        </div>
        <IconLink label="Sessions" hint={keys.sessions ?? "Alt+O"} href="#/sessions" active={route.kind === "sessions"}>
          <Layers aria-hidden="true" className="size-[1.1rem]" />
        </IconLink>
        <IconLink label="Settings" hint={keys.settings ?? "Alt+S"} href="#/settings" active={route.kind === "settings"}>
          <Settings aria-hidden="true" className="size-[1.1rem]" />
        </IconLink>
        <ThemeToggle />
      </div>
    </header>
  )
}
