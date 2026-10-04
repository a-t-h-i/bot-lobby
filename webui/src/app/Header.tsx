/**
 * The top of the page: where you are (workspace and branch), the numbered
 * tabs in the middle, and what this session is doing on the right with
 * the way to Sessions, Settings, the key help and the light/dark switch. On narrow windows
 * the tabs take a row of their own.
 */
import type { ReactNode } from "react"
import { setSoundMuted, useSoundMuted } from "./sound"
import { GitBranch, Keyboard, Layers, Moon, Settings, Sun, Volume2, VolumeX } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Keys } from "@/components/ui/kbd"
import { useTheme } from "@/components/theme-provider"
import type { ConnectionState } from "@/lib/events"
import { cn } from "@/lib/utils"
import type { SnapshotTask, StatusInfo } from "@protocol"
import type { Route } from "./router.ts"
import { ProjectSwitcher } from "./ProjectSwitcher.tsx"

function Connection({ state }: { state: ConnectionState }) {
  if (state === "live") return <span title="Connected" aria-label="Connected" className="size-2 rounded-full bg-success" />
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

/** The flat icon buttons on the right. */
const ICON =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"

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
      <TooltipContent>
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
          <Keyboard aria-hidden="true" className="size-[1.1rem]" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Keyboard shortcuts <Keys chord={hint} />
      </TooltipContent>
    </Tooltip>
  )
}

function SoundToggle() {
  const muted = useSoundMuted()
  return <Tooltip><TooltipTrigger asChild><button type="button" aria-label={muted ? "Unmute prompt sounds" : "Mute prompt sounds"} aria-pressed={muted} aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help" className={ICON} onClick={() => setSoundMuted(!muted)}>{muted ? <VolumeX aria-hidden="true" className="size-4" /> : <Volume2 aria-hidden="true" className="size-4" />}</button></TooltipTrigger><TooltipContent>{muted ? "Unmute" : "Mute"} prompt sounds · Enter / Space</TooltipContent></Tooltip>
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const dark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  return <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          aria-keyshortcuts="Enter Space"
          aria-describedby="focused-action-help"
          onClick={() => setTheme(dark ? "light" : "dark")}
          className={ICON}
        >
          {dark ? <Sun aria-hidden="true" className="size-[1.1rem]" /> : <Moon aria-hidden="true" className="size-[1.1rem]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
}

interface HeaderProps {
  status?: StatusInfo
  task?: SnapshotTask
  connection: ConnectionState
  route: Route
  tabs: ReactNode
  /** Shown before the status (the way back to a question put away). */
  extra?: ReactNode
  keys: Record<string, string>
  onHelp: () => void
}

function WorkspaceContext({ status }: Pick<HeaderProps, "status">) {
  const name = status?.workspace.name ?? "bot-lobby"
  const branch = status?.branch ?? status?.workspace.branch
  return <div className="flex min-w-0 items-center gap-2.5 [grid-area:title]">
    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-primary" />
    <span className="truncate text-sm font-medium" title={name}>{name}</span>
    <span className="min-w-0 truncate text-xs text-muted-foreground" title={status?.sessionName}> {status?.sessionName ?? "No session"}</span>
    {branch ? <span className="inline-flex min-w-0 items-center gap-1 truncate rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">
      <GitBranch aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{branch}</span>
    </span> : null}
  </div>
}

function SessionContext({ status, task, connection }: Pick<HeaderProps, "status" | "task" | "connection">) {
  return <div className="mr-2 flex min-w-0 items-center gap-2 text-sm">
    {status?.busy ? <Spinner aria-hidden="true" role="presentation" className="size-3.5" /> : null}
    {task ? <span className="max-w-[12rem] truncate">
      <span className="font-medium">{task.id}</span> <span className="text-muted-foreground">{task.state.replace(/_/g, " ")}</span>
    </span> : <span className="max-w-[10rem] truncate text-muted-foreground">{status?.sessionName ?? "no task in this session"}</span>}
    <Connection state={connection} />
  </div>
}

function ToolbarActions({ route, keys, onHelp }: Pick<HeaderProps, "route" | "keys" | "onHelp">) {
  return <>
    <IconLink label="Sessions" hint={keys.sessions ?? "Alt+O"} href="#/sessions" active={route.kind === "sessions"}>
      <Layers aria-hidden="true" className="size-[1.1rem]" />
    </IconLink>
    <IconLink label="Settings" hint={keys.settings ?? "Alt+S"} href="#/settings" active={route.kind === "settings"}>
      <Settings aria-hidden="true" className="size-[1.1rem]" />
    </IconLink>
    <HelpButton hint={keys.help ?? "Alt+H"} onHelp={onHelp} />
    <ThemeToggle />
    <SoundToggle />
    <span id="focused-action-help" className="w-full text-xs text-muted-foreground">Focused buttons: Enter / Space. Links: Enter. Checkboxes: Space.</span>
  </>
}

export function Header(props: HeaderProps) {
  return <header className="grid shrink-0 grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 [grid-template-areas:'title'_'project'_'status'_'tabs'] md:grid-cols-[minmax(0,1fr)_auto] md:[grid-template-areas:'title_status'_'project_status'_'tabs_tabs']">
    <WorkspaceContext status={props.status} />
    <ProjectSwitcher tab={props.route.kind === "tab" ? props.route.tab : props.route.kind} />
    <div className="min-w-0 [grid-area:tabs]">{props.tabs}</div>
    <div className="flex min-w-0 flex-wrap items-center gap-1 [grid-area:status] md:justify-end">
      {props.extra}
      <SessionContext status={props.status} task={props.task} connection={props.connection} />
      <ToolbarActions route={props.route} keys={props.keys} onHelp={props.onHelp} />
    </div>
  </header>
}
