// Adapted from T3 Code (MIT), apps/web/src/components/Sidebar.tsx and apps/web/src/components/ui/sidebar.tsx
/**
 * The sidebar on the left of every page, laid out like the coding harness it
 * takes after. At its top the open project's name and the fold button, then a search
 * over the sessions and a New session button; then the sessions as thin rows
 * under small labels (this window's, then the background sessions it
 * started), with the ones in other terminals and the ended ones in groups at
 * the foot that fold away; and last Settings and the app's switches. Switching
 * to a session is a click on its row.
 *
 * It folds off the page altogether (the button at its top, the sidebar key, or
 * a click on its edge), and a button at the start of the bar brings it back.
 * Dragging its edge makes it wider or narrower, a double-click puts the width
 * back, and both the width and whether it is folded are remembered in this
 * browser; unpicked it starts folded on a window under 1024 px. The project
 * itself is chosen in the composer.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import {
  Archive,
  ChevronDown,
  CircleDashed,
  MessageCircleQuestion,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Search,
  Settings,
  SquarePen,
} from "lucide-react"
import type { StatusInfo } from "@protocol"
import { Keys } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { act } from "@/lib/act"
import { useCollapsed } from "@/lib/collapsed"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { ScrollHints } from "@/ui/ScrollHints"
import { AppearanceButton, FullscreenToggle, HelpButton, NotifyToggle, SoundToggle, ThemeToggle } from "./AppTools.tsx"
import { useMediaQuery, useTopic } from "./hooks.ts"
import { NARROW_SIDEBAR } from "@/lib/panePreference"
import { NewSessionDialog } from "./NewSessionDialog.tsx"
import { go, type Route } from "./router.ts"
import { sessionEntries, type SessionEntry } from "./sessionList.ts"
import { useApiRead } from "./useApiRead"

export interface SidebarProps {
  route: Route
  keys: Record<string, string>
  onHelp: () => void
}

/** Where the sidebar's folded state is remembered (`useCollapsed`). */
export const SIDEBAR_KEY = "app.sidebar"

/** The sidebar's width in rem: as it starts, and as far as dragging its edge takes it. */
const WIDTH = { start: 16, min: 13, max: 24 }
const WIDTH_KEY = "bot-lobby.sidebar.width"

/** An icon button in the sidebar (and the bar's open button): 28 px as in the harness. */
const ICON_BUTTON =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-icon)] outline-none transition-[background-color,color,scale] duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.96] aria-pressed:text-sidebar-foreground aria-[current=page]:bg-[var(--sidebar-selected)] aria-[current=page]:text-sidebar-foreground motion-reduce:active:scale-100"

/** A session as a thin row, as the chat app's sidebar draws its conversations: one line, a soft pill when it is the current one. */
const ROW =
  "session-row flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-[var(--sidebar-selected)]"

function Tip({ label, hint, side = "bottom", children }: { label: string; hint?: string | undefined; side?: "right" | "top" | "bottom"; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {label} {hint ? <Keys chord={hint} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** The sessions as the sidebar lists them, read live (`sessions` and `status` topics). */
function useSessions(): { entries: SessionEntry[]; branch: string | undefined } {
  const status = useTopic<StatusInfo>("status").data
  const list = useApiRead("sessions.list", {}, ["sessions"])
  return { entries: sessionEntries(status, list.data), branch: status?.branch ?? status?.workspace.branch }
}

/**
 * Go to a session: this window's own is the Lobby; a background one is moved
 * into this window (if this window is at work, its session carries on in the
 * background); one in another terminal stays there.
 */
function useSwitch(): (entry: SessionEntry) => Promise<void> {
  return useCallback(async (entry: SessionEntry) => {
    if (entry.where === "here") return go("#/lobby")
    if (entry.where === "elsewhere") return void toast.info(`${entry.name} runs in another terminal. Switch to that terminal to work in it.`)
    if (await act("sessions.switch", entry.key ? { key: entry.key } : { sessionId: entry.sessionId! })) go("#/lobby")
  }, [])
}

/** A session's state as a small dot: breathing while it works or starts, amber while it asks you something, hollow once it ended. */
function StateDot({ entry }: { entry: SessionEntry }) {
  return <span aria-hidden="true" data-state={entry.where === "elsewhere" ? "elsewhere" : entry.state} className="session-dot relative" />
}

/**
 * What the row shows at its end: a question count while it asks you something, a turning ring while it
 * works or starts, otherwise its state dot. The state is spelt out for screen readers.
 */
function RowStatus({ entry }: { entry: SessionEntry }) {
  if (entry.where === "elsewhere") return <StateDot entry={entry} />
  if (entry.state === "asking")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-warning tabular-nums">
        <MessageCircleQuestion aria-hidden="true" className="size-3.5" />
        {entry.waiting}
        <span className="sr-only">{entry.waiting === 1 ? " question" : " questions"}, Waiting</span>
      </span>
    )
  if (entry.state === "working" || entry.state === "starting")
    return (
      <span className={cn("inline-flex shrink-0", entry.state === "working" ? "text-primary" : "text-muted-foreground")}>
        <CircleDashed aria-hidden="true" className="session-spin size-3.5" />
        <span className="sr-only">{entry.state === "working" ? "Working" : "Starting"}</span>
      </span>
    )
  return (
    <span className="inline-flex shrink-0">
      <StateDot entry={entry} />
      <span className="sr-only">{entry.state === "exited" ? "Ended" : "Idle"}</span>
    </span>
  )
}

const WHERE = { here: "This window", background: "Background", elsewhere: "Other terminal" }

/** Put an ended session away, with Undo on the notice. */
function archive(entry: SessionEntry): Promise<unknown> {
  const key = entry.key!
  return act("sessions.archive", { key }, { undo: () => void act("sessions.archive", { key, archived: false }) })
}

/** The name, as a field while it is being renamed: Enter or leaving it saves, Esc keeps the old name. */
function RenameField({ entry, onDone }: { entry: SessionEntry; onDone: () => void }) {
  const [name, setName] = useState(entry.name)
  const settled = useRef(false)
  const save = async () => {
    if (settled.current) return
    settled.current = true
    const next = name.replace(/\s+/g, " ").trim()
    if (next && next !== entry.name) await act("sessions.rename", { ...(entry.where === "here" ? {} : { key: entry.key! }), name: next })
    onDone()
  }
  return (
    <input
      value={name}
      autoFocus
      maxLength={120}
      aria-label={`New name for ${entry.name}`}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          void save()
        } else if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          settled.current = true
          onDone()
        }
      }}
      className="-mx-1 h-6 w-[calc(100%+0.5rem)] min-w-0 rounded-sm bg-background px-1 text-sm leading-5 text-sidebar-foreground outline-none ring-2 ring-ring"
    />
  )
}

const ROW_ACTION =
  "inline-flex size-[1.625rem] items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color] duration-150 hover:bg-[var(--sidebar-selected)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

/** A session as a thin row: its name and, at the end, its state; Rename and Archive take the state's place on hover. */
function SessionRow({ entry }: { entry: SessionEntry }) {
  const pick = useSwitch()
  const [renaming, setRenaming] = useState(false)
  const quiet = entry.state === "exited" || entry.where === "elsewhere"
  const nameClass = cn("min-w-0 flex-1 truncate", entry.where === "here" ? "font-medium text-sidebar-foreground" : quiet ? "text-muted-foreground" : "text-sidebar-foreground")
  const canRename = entry.where !== "elsewhere"
  const canArchive = entry.where === "background" && entry.state === "exited" && Boolean(entry.key)
  const hasActions = canRename || canArchive
  return (
    <li className="session-enter session-item relative">
      {renaming ? (
        <div aria-current={entry.where === "here" ? "true" : undefined} className={cn(ROW, "hover:bg-transparent")}>
          <RenameField entry={entry} onDone={() => setRenaming(false)} />
        </div>
      ) : (
        <button
          type="button"
          aria-current={entry.where === "here" ? "true" : undefined}
          aria-label={entry.where === "here" ? `${entry.name}, this window` : entry.where === "elsewhere" ? `${entry.name}, in another terminal` : `Switch to ${entry.name}`}
          title={entry.name}
          data-where={entry.where}
          data-state={entry.state}
          onClick={() => void pick(entry)}
          onDoubleClick={(event) => {
            if (!canRename) return
            event.preventDefault()
            setRenaming(true)
          }}
          className={ROW}
        >
          <span className={nameClass}>{entry.name}</span>
          <span className={cn("flex shrink-0 items-center", hasActions && "session-state")}>
            <RowStatus entry={entry} />
          </span>
        </button>
      )}
      {!renaming && hasActions ? (
        <span className="session-actions absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
          {canRename ? (
            <Tip label="Rename">
              <button type="button" aria-label={`Rename ${entry.name}`} onClick={() => setRenaming(true)} className={ROW_ACTION}>
                <Pencil aria-hidden="true" className="size-3.5" />
              </button>
            </Tip>
          ) : null}
          {canArchive ? (
            <Tip label="Archive">
              <button type="button" aria-label={`Archive ${entry.name}`} onClick={() => void archive(entry)} className={ROW_ACTION}>
                <Archive aria-hidden="true" className="size-3.5" />
              </button>
            </Tip>
          ) : null}
        </span>
      ) : null}
    </li>
  )
}

/** A section label over a group of rows, as "Pinned" and "Recents" sit in the chat app. */
const LABEL = "flex h-7 items-center px-2.5 pt-2 text-xs font-medium text-muted-foreground"

/** A group of sessions under its label; it folds away when its label is clicked, remembered. */
function Shelf({ id, label, entries, archivable = false }: { id: string; label: string; entries: SessionEntry[]; archivable?: boolean }) {
  const [folded, toggle] = useCollapsed(`app.sidebar.${id}`)
  const body = useId()
  if (entries.length === 0) return null
  return (
    <section aria-label={label} className="group/shelf flex flex-col">
      <div className="flex items-center gap-1 pt-2">
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls={body}
          onClick={toggle}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span>{label}</span>
          {folded ? <span className="tabular-nums">{entries.length}</span> : null}
          <ChevronDown aria-hidden="true" className={cn("size-3 opacity-0 transition-[opacity,rotate] duration-150 group-hover/shelf:opacity-100 group-focus-within/shelf:opacity-100 motion-reduce:transition-none", folded && "-rotate-90 opacity-100")} />
        </button>
        {archivable ? (
          <button
            type="button"
            onClick={() => void (async () => { for (const entry of entries) if (entry.key) await act("sessions.archive", { key: entry.key }) })()}
            className="h-[1.625rem] shrink-0 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Archive all
          </button>
        ) : null}
      </div>
      {folded ? null : (
        <ul id={body} className="flex flex-col gap-px">
          {entries.map((entry) => <SessionRow key={entry.id} entry={entry} />)}
        </ul>
      )}
    </section>
  )
}

function matches(entry: SessionEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const text = `${entry.name} ${WHERE[entry.where]}`.toLowerCase()
  return words.every((word) => text.includes(word))
}

/** The search field and the New session button under the sidebar's top. */
function SearchRow({ query, onQuery, onNew }: { query: string; onQuery: (query: string) => void; onNew: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1 pb-2">
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent focus-within:bg-sidebar-accent focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <input
          type="search"
          value={query}
          aria-label="Search sessions"
          placeholder="Search"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault()
              event.stopPropagation()
              onQuery("")
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sidebar-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <Tip label="New session">
        <button type="button" aria-label="New session" aria-haspopup="dialog" onClick={onNew} className={ICON_BUTTON}>
          <SquarePen aria-hidden="true" className="size-4" />
        </button>
      </Tip>
    </div>
  )
}

/** The sessions: this window's under its label, then the background ones, then other terminals and ended ones. */
function Sessions({ query }: { query: string }) {
  const { entries } = useSessions()
  const shown = entries.filter((entry) => matches(entry, query))
  const here = shown.filter((entry) => entry.where === "here" && entry.state !== "exited")
  const background = shown.filter((entry) => entry.where === "background" && entry.state !== "exited")
  const elsewhere = shown.filter((entry) => entry.where === "elsewhere")
  const ended = shown.filter((entry) => entry.where !== "elsewhere" && entry.state === "exited")
  const list = useRef<HTMLElement>(null)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <nav ref={list} aria-label="Sessions list" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2">
        {shown.length === 0 ? <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No sessions match “{query.trim()}”.</p> : null}
        {here.length > 0 ? (
          <>
            <p className={LABEL}>This window</p>
            <ul className="flex flex-col gap-px">
              {here.map((entry) => <SessionRow key={entry.id} entry={entry} />)}
            </ul>
          </>
        ) : null}
        {background.length > 0 ? (
          <>
            <p className={cn(LABEL, "mt-2")}>Background</p>
            <ul className="flex flex-col gap-px">
              {background.map((entry) => <SessionRow key={entry.id} entry={entry} />)}
            </ul>
          </>
        ) : !query.trim() && entries.length === 1 ? (
          <p className="px-2.5 pt-2 text-xs text-muted-foreground">No other sessions are running.</p>
        ) : null}
        <div className="mt-auto flex flex-col pt-2">
          <Shelf id="elsewhere" label="Other terminals" entries={elsewhere} />
          <Shelf id="ended" label="Ended" entries={ended} archivable />
        </div>
      </nav>
      <ScrollHints target={list} />
    </div>
  )
}

/** The sidebar's title: the name of the project open in this window (the app's name only until the status arrives). */
function ProjectTitle() {
  const name = useTopic<StatusInfo>("status").data?.workspace.name
  return (
    <span data-slot="sidebar-title" title={name} className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
      {name ?? "Bot Lobby"}
    </span>
  )
}

/** Settings and the app's switches at the sidebar's foot. */
function Foot({ route, keys, onHelp }: SidebarProps) {
  const hint = keys.settings ?? "Alt+S"
  return (
    <div className="sidebar-foot flex flex-col gap-1 border-t border-[var(--sidebar-border)] px-1 py-2">
      <a
        href="#/settings"
        aria-label="Settings"
        aria-current={route.kind === "settings" ? "page" : undefined}
        aria-keyshortcuts={hint}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-[var(--sidebar-selected)] aria-[current=page]:font-medium [&>svg]:text-[var(--sidebar-icon)]"
      >
        <Settings aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1">Settings</span>
        <Keys chord={hint} />
      </a>
      <div className="flex items-center justify-between">
        <HelpButton hint={keys.help ?? "Alt+H"} onHelp={onHelp} className={ICON_BUTTON} />
        <ThemeToggle className={ICON_BUTTON} />
        <SoundToggle className={ICON_BUTTON} />
        <AppearanceButton className={ICON_BUTTON} />
        <NotifyToggle className={ICON_BUTTON} />
        <FullscreenToggle className={ICON_BUTTON} />
      </div>
    </div>
  )
}

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    if (stored >= WIDTH.min && stored <= WIDTH.max) return stored
  } catch {
    // A blocked store: the sidebar starts at its usual width.
  }
  return WIDTH.start
}

function saveWidth(width: number): void {
  try {
    if (width === WIDTH.start) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // The width then lasts until the page reloads.
  }
}

const clamp = (width: number) => Math.min(WIDTH.max, Math.max(WIDTH.min, Math.round(width * 4) / 4))

/**
 * The sidebar's edge: drag it to resize, double-click to put the width back,
 * click to fold the sidebar away. From the keyboard the arrows resize it and
 * Enter folds it.
 */
function EdgeHandle({ width, onWidth, onResizing, onFold }: { width: number; onWidth: (width: number) => void; onResizing: (resizing: boolean) => void; onFold: () => void }) {
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const fold = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(fold.current), [])
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-controls="app-sidebar"
      aria-valuemin={WIDTH.min}
      aria-valuemax={WIDTH.max}
      aria-valuenow={width}
      title="Drag to resize, click to fold, double-click to reset"
      className="sidebar-edge"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = { x: event.clientX, width, moved: false }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start) return
        const dx = event.clientX - start.x
        if (!start.moved && Math.abs(dx) < 3) return
        if (!start.moved) onResizing(true)
        start.moved = true
        onWidth(clamp(start.width + dx / rem()))
      }}
      onPointerUp={() => {
        const start = drag.current
        drag.current = null
        if (!start) return
        dragged.current = start.moved
        onResizing(false)
      }}
      onClick={(event) => {
        // A click (no drag) folds it, a moment later so that a double-click can reset the width instead.
        if (dragged.current || event.detail !== 1) return
        fold.current = window.setTimeout(onFold, 240)
      }}
      onPointerCancel={() => {
        drag.current = null
        onResizing(false)
      }}
      onDoubleClick={() => {
        window.clearTimeout(fold.current)
        onWidth(WIDTH.start)
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault()
          onWidth(clamp(width + (event.key === "ArrowRight" ? 1 : -1)))
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault()
          onWidth(event.key === "Home" ? WIDTH.min : WIDTH.max)
        } else if (event.key === "Enter") {
          event.preventDefault()
          onFold()
        }
      }}
    />
  )
}

export function Sidebar(props: SidebarProps) {
  // Read again when the window crosses the narrow width: unpicked, the sidebar folds below it.
  useMediaQuery(NARROW_SIDEBAR)
  const [folded, toggle] = useCollapsed(SIDEBAR_KEY)
  const [width, setWidth] = useState(readWidth)
  const [resizing, setResizing] = useState(false)
  const [query, setQuery] = useState("")
  const [starting, setStarting] = useState(false)
  const resize = useCallback((next: number) => {
    setWidth(next)
    saveWidth(next)
  }, [])
  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      data-folded={folded ? "" : undefined}
      data-resizing={resizing ? "" : undefined}
      inert={folded}
      style={{ width: folded ? 0 : `${width}rem` }}
      className="app-sidebar"
    >
      <div className="sidebar-panel flex min-h-0 flex-1 flex-col" style={{ width: `${width}rem` }}>
        <div className="flex min-h-12 items-center gap-2 pr-1 pl-3">
          <ProjectTitle />
          <Tip label="Collapse sidebar" hint={props.keys.sidebar}>
            <button type="button" aria-label="Collapse sidebar" aria-expanded aria-controls="app-sidebar" aria-keyshortcuts={props.keys.sidebar} onClick={toggle} className={ICON_BUTTON}>
              <PanelLeftClose aria-hidden="true" className="size-4" />
            </button>
          </Tip>
        </div>
        <SearchRow query={query} onQuery={setQuery} onNew={() => setStarting(true)} />
        <Sessions query={query} />
        <Foot {...props} />
      </div>
      <EdgeHandle width={width} onWidth={resize} onResizing={setResizing} onFold={toggle} />
      <NewSessionDialog open={starting} onOpenChange={setStarting} />
    </aside>
  )
}

/** The button at the start of the bar that brings a folded sidebar back. */
export function SidebarOpenButton({ hint }: { hint?: string | undefined }) {
  // Read again when the window crosses the narrow width, as the sidebar itself does.
  useMediaQuery(NARROW_SIDEBAR)
  const [folded, toggle] = useCollapsed(SIDEBAR_KEY)
  if (!folded) return null
  return (
    <Tip label="Expand sidebar" hint={hint}>
      <button type="button" aria-label="Expand sidebar" aria-expanded={false} aria-controls="app-sidebar" aria-keyshortcuts={hint} onClick={toggle} className={cn(ICON_BUTTON, "sidebar-open size-8 text-foreground")}>
        <PanelLeft aria-hidden="true" className="size-4" />
      </button>
    </Tip>
  )
}
