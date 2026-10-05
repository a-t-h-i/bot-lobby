/**
 * The top bar: the project you are in on the left, the numbered tabs in the
 * middle, and what this session is doing on the right with the way to
 * Sessions, Settings, the key help and the light/dark switch, all on one row
 * whenever they fit side by side; when they do not, the tabs take a row of
 * their own under the other two (the grid lives in `index.css`).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Keyboard, Layers, Moon, Settings, Sun, Volume2, VolumeX } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Keys } from "@/components/ui/kbd"
import { useTheme } from "@/components/theme-provider"
import type { ConnectionState } from "@/lib/events"
import type { SnapshotTask, StatusInfo } from "@protocol"
import type { Route } from "./router.ts"
import { ProjectNotice, ProjectSwitcher, useProjects } from "./ProjectSwitcher.tsx"
import { setSoundMuted, useSoundMuted } from "./sound"

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
/** A header tool: a slim icon that rises when pointed at and sinks when on or pressed. */
const ICON =
  "btn-ghost inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-[background-color,color,box-shadow,translate] duration-150 ease-snap outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px motion-reduce:active:translate-none aria-[current=page]:text-foreground"

function IconLink({ label, hint, href, active, children }: { label: string; hint: string; href: string; active: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          aria-keyshortcuts={hint}
          aria-describedby="focused-action-help"
          className={ICON}
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
        <button type="button" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-keyshortcuts={hint} aria-describedby="focused-action-help" onClick={onHelp} className={ICON}>
          <Keyboard aria-hidden="true" className="size-[1.05rem]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Keyboard shortcuts <Keys chord={hint} />
      </TooltipContent>
    </Tooltip>
  )
}

function SoundToggle() {
  const muted = useSoundMuted()
  const label = muted ? "Unmute prompt sounds" : "Mute prompt sounds"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} aria-pressed={muted} aria-describedby="focused-action-help" className={ICON} onClick={() => setSoundMuted(!muted)}>
          {muted ? <VolumeX aria-hidden="true" className="size-[1.05rem]" /> : <Volume2 aria-hidden="true" className="size-[1.05rem]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
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
          aria-describedby="focused-action-help"
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

/** How wide a part of the bar would be with nothing cut short: its children's extent, plus whatever truncation hides. */
function naturalWidth(part: Element | null): number {
  if (!part) return 0
  const shown = [...part.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.offsetParent !== null && getComputedStyle(child).position !== "absolute")
  if (!shown.length) return 0
  const left = Math.min(...shown.map((child) => child.getBoundingClientRect().left))
  const right = Math.max(...shown.map((child) => child.getBoundingClientRect().right))
  let hidden = 0
  for (const el of part.querySelectorAll<HTMLElement>("*")) {
    // Text cut short with an ellipsis; a screen-reader-only label (1px, clipped) is not on the bar at all.
    if (el.clientWidth <= 1 || el.offsetParent === null || el.scrollWidth <= el.clientWidth + 1) continue
    if (getComputedStyle(el).textOverflow === "ellipsis") hidden += el.scrollWidth - el.clientWidth
  }
  return right - left + hidden
}

/** Room to spare before the bar goes to one row, so it does not flip back and forth at the edge. */
const SPARE = 24

/**
 * Whether the project, the tabs and the tools fit on one row: measured from
 * the parts themselves (the tab track is always its full width), again when
 * the window, the tabs or anything in the bar changes size.
 */
function useOneRow() {
  const header = useRef<HTMLElement>(null)
  const [one, setOne] = useState(false)
  const measure = useRef(() => {})
  measure.current = () => {
    const el = header.current
    if (!el) return
    const track = el.querySelector<HTMLElement>('[role="tablist"]')
    const style = getComputedStyle(el)
    const gap = parseFloat(style.columnGap) || 0
    const room = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
    const needed = naturalWidth(el.querySelector(".where")) + (track?.offsetWidth ?? 0) + naturalWidth(el.querySelector(".tools")) + gap * 2
    setOne(needed + SPARE <= room)
  }
  useLayoutEffect(() => measure.current())
  useLayoutEffect(() => {
    const el = header.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => measure.current())
    observer.observe(el)
    for (const part of el.querySelectorAll('[role="tablist"], .where, .tools')) observer.observe(part)
    return () => observer.disconnect()
  }, [])
  return { header, one }
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
  const projects = useProjects()
  const { header, one } = useOneRow()

  return (
    <header ref={header} className="app-header shrink-0" data-one-row={one || undefined}>
      <div className="where flex min-w-0 items-center">
        <ProjectSwitcher projects={projects} tab={route.kind === "tab" ? route.tab : route.kind} name={name} branch={branch} />
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
        <SoundToggle />
        <span id="focused-action-help" className="sr-only">
          Focused buttons: Enter or Space. Links: Enter. Checkboxes: Space.
        </span>
      </div>
      <ProjectNotice projects={projects} />
    </header>
  )
}
