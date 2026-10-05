/**
 * The top bar: the project you are in on the left, the numbered tabs in the
 * middle, and what this session is doing on the right with the way to
 * Sessions, Settings, the key help and the light/dark switch. Below 1360px the
 * tabs take a row of their own (the grid lives in `index.css`).
 */
import type { ReactNode } from "react"
import { Keyboard, Layers, Moon, Settings, Sun } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Keys } from "@/components/ui/kbd"
import { useTheme } from "@/components/theme-provider"
import type { ConnectionState } from "@/lib/events"
import { cn } from "@/lib/utils"
import type { SnapshotTask, StatusInfo } from "@protocol"
import type { Route } from "./router.ts"
import { ProjectSwitcher } from "./ProjectSwitcher.tsx"

/** What the link to the server is doing: a green dot when live, words when it is not. */
function Connection({ state }: { state: ConnectionState }) {
  if (state === "live") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="img" aria-label="Connected" className="grid size-6 place-items-center">
            <span className="size-2 rounded-full bg-success" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Connected</TooltipContent>
      </Tooltip>
    )
  }
  if (state === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner aria-hidden="true" role="presentation" className="size-3" />
        reconnecting…
      </span>
    )
  }
  return <span className="text-xs font-medium text-destructive">Connection lost</span>
}

/** The flat icon buttons on the right. */
const ICON =
  "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"

function IconLink({ label, hint, href, active, children }: { label: string; hint: string; href: string; active: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          aria-keyshortcuts={hint}
          className={cn(ICON, active && "bg-accent text-foreground")}
        >
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} <Keys chord={hint} />
      </TooltipContent>
    </Tooltip>
  )
}

function HelpButton({ hint, onHelp }: { hint: string; onHelp: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-keyshortcuts={hint} onClick={onHelp} className={ICON}>
          <Keyboard aria-hidden="true" className="size-[1.05rem]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Keyboard shortcuts <Keys chord={hint} />
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
          aria-keyshortcuts="D"
          onClick={() => setTheme(dark ? "light" : "dark")}
          className={ICON}
        >
          {dark ? <Sun aria-hidden="true" className="size-[1.05rem]" /> : <Moon aria-hidden="true" className="size-[1.05rem]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {dark ? "Light mode" : "Dark mode"} <Keys chord="D" />
      </TooltipContent>
    </Tooltip>
  )
}

/** The session's task and whether the oracle is busy, as one quiet chip. */
function SessionChip({ busy, task, sessionName }: { busy: boolean; task?: SnapshotTask; sessionName?: string }) {
  return (
    <div className="mr-1 flex min-w-0 items-center gap-2 text-[0.8125rem]">
      {busy ? <Spinner aria-hidden="true" role="presentation" className="size-3.5" /> : null}
      {task ? (
        <span className="hidden max-w-[16rem] truncate md:inline">
          <span className="font-medium">{task.id}</span>
          <span className="hidden text-muted-foreground min-[1500px]:inline"> · {task.state.replace(/_/g, " ")}</span>
        </span>
      ) : (
        <span className="hidden max-w-[10rem] truncate text-muted-foreground min-[1500px]:inline">{sessionName ?? "no task in this session"}</span>
      )}
    </div>
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
  onHelp,
}: {
  status?: StatusInfo
  task?: SnapshotTask
  connection: ConnectionState
  route: Route
  tabs: ReactNode
  /** Shown before the status (the way back to a question put away). */
  extra?: ReactNode
  keys: Record<string, string>
  onHelp: () => void
}) {
  const name = status?.workspace.name ?? "bot-lobby"
  const branch = status?.branch ?? status?.workspace.branch
  const busy = status?.busy ?? false

  return (
    <header className="app-header shrink-0">
      <div className="where flex min-w-0 items-center">
        <ProjectSwitcher tab={route.kind === "tab" ? route.tab : route.kind} name={name} branch={branch} />
      </div>
      <div className="tabs min-w-0">{tabs}</div>
      <div className="tools flex min-w-0 items-center justify-end gap-0.5">
        {extra}
        <SessionChip busy={busy} {...(task ? { task } : {})} {...(status?.sessionName ? { sessionName: status.sessionName } : {})} />
        <Connection state={connection} />
        <IconLink label="Sessions" hint={keys.sessions ?? "Alt+O"} href="#/sessions" active={route.kind === "sessions"}>
          <Layers aria-hidden="true" className="size-[1.05rem]" />
        </IconLink>
        <IconLink label="Settings" hint={keys.settings ?? "Alt+S"} href="#/settings" active={route.kind === "settings"}>
          <Settings aria-hidden="true" className="size-[1.05rem]" />
        </IconLink>
        <HelpButton hint={keys.help ?? "Alt+H"} onHelp={onHelp} />
        <ThemeToggle />
      </div>
    </header>
  )
}
