// Adapted from T3 Code (MIT), apps/web/src/components/Sidebar.tsx and apps/web/src/components/ui/sidebar.tsx
/**
 * The sidebar on the left of every page, laid out like the coding harness it
 * takes after. At its top the app's name and the fold button, then a search
 * over the sessions and a New session button; then the running sessions as
 * cards (this window's first, then the background sessions it started), with
 * the ones in other terminals and the ended ones on shelves at the foot that
 * fold away; and last Settings and the app's switches. Switching to a session
 * is a click on its card.
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
  CircleCheck,
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

const CARD =
  "session-card flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 text-left outline-none transition-[background-color,scale] duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.98] aria-[current=true]:bg-[var(--sidebar-selected)] aria-[current=true]:shadow-control motion-reduce:active:scale-100"

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
 * into this window (the server refuses while this window's oracle works, and
 * says so); one in another terminal stays there.
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

/** What the card's top line says on its right: the state, with an icon while there is something to see. */
function CardStatus({ entry }: { entry: SessionEntry }) {
  if (entry.where === "elsewhere") return null
  if (entry.state === "asking")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-warning">
        <MessageCircleQuestion aria-hidden="true" className="size-3.5" />
        {entry.waiting === 1 ? "1 question" : `${entry.waiting} questions`}
      </span>
    )
  if (entry.state === "working" || entry.state === "starting")
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-1", entry.state === "working" ? "text-primary" : "text-muted-foreground")}>
        <CircleDashed aria-hidden="true" className="session-spin size-3.5" />
        {entry.state === "working" ? "Working" : "Starting"}
      </span>
    )
  if (entry.state === "exited")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-3.5" />
        Ended
      </span>
    )
  return <span className="shrink-0 text-muted-foreground">Idle</span>
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
      className="-mx-1 mt-1 h-5 w-[calc(100%+0.5rem)] min-w-0 rounded-sm bg-background px-1 text-sm leading-5 text-sidebar-foreground outline-none ring-2 ring-ring"
    />
  )
}

const CARD_ACTION =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color] duration-150 hover:bg-[var(--sidebar-selected)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

/** A session as a card: where it runs and its state, its name, and a line on what it is; Rename and Archive on hover. */
function SessionCard({ entry, branch }: { entry: SessionEntry; branch: string | undefined }) {
  const pick = useSwitch()
  const [renaming, setRenaming] = useState(false)
  const foot =
    entry.where === "here" ? (branch ? `on ${branch}` : "Where you are now")
    : entry.where === "elsewhere" ? "Switch in that terminal"
    : entry.state === "exited" ? "Its task keeps its state"
    : "Click to bring it here"
  const nameClass = cn("mt-1 truncate text-sm", entry.where === "here" ? "font-medium text-sidebar-foreground" : entry.state === "exited" || entry.where === "elsewhere" ? "text-muted-foreground" : "text-sidebar-foreground")
  const top = (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <StateDot entry={entry} />
      <span className="min-w-0 flex-1 truncate">{WHERE[entry.where]}</span>
      <CardStatus entry={entry} />
    </span>
  )
  const canRename = entry.where !== "elsewhere"
  const canArchive = entry.where === "background" && entry.state === "exited" && Boolean(entry.key)
  return (
    <li className="session-enter session-item relative py-0.5">
      {renaming ? (
        <div aria-current={entry.where === "here" ? "true" : undefined} className={cn(CARD, "hover:bg-transparent active:scale-100")}>
          {top}
          <RenameField entry={entry} onDone={() => setRenaming(false)} />
          <span className="mt-0.5 truncate text-xs text-muted-foreground">{foot}</span>
        </div>
      ) : (
        <button
          type="button"
          aria-current={entry.where === "here" ? "true" : undefined}
          aria-label={entry.where === "here" ? `${entry.name}, this window` : entry.where === "elsewhere" ? `${entry.name}, in another terminal` : `Switch to ${entry.name}`}
          data-where={entry.where}
          data-state={entry.state}
          onClick={() => void pick(entry)}
          onDoubleClick={(event) => {
            if (!canRename) return
            event.preventDefault()
            setRenaming(true)
          }}
          className={CARD}
        >
          {top}
          <span className={nameClass}>{entry.name}</span>
          <span className={cn("mt-0.5 truncate text-xs text-muted-foreground", (canRename || canArchive) && "pr-14")}>{foot}</span>
        </button>
      )}
      {!renaming && (canRename || canArchive) ? (
        <span className="session-actions absolute right-1 bottom-1 flex items-center gap-0.5">
          {canRename ? (
            <Tip label="Rename">
              <button type="button" aria-label={`Rename ${entry.name}`} onClick={() => setRenaming(true)} className={CARD_ACTION}>
                <Pencil aria-hidden="true" className="size-3.5" />
              </button>
            </Tip>
          ) : null}
          {canArchive ? (
            <Tip label="Archive">
              <button type="button" aria-label={`Archive ${entry.name}`} onClick={() => void archive(entry)} className={CARD_ACTION}>
                <Archive aria-hidden="true" className="size-3.5" />
              </button>
            </Tip>
          ) : null}
        </span>
      ) : null}
    </li>
  )
}

/** A shelf of sessions at the sidebar's foot: a header with a rule and a chevron that folds it, remembered. */
function Shelf({ id, label, entries, branch, archivable = false }: { id: string; label: string; entries: SessionEntry[]; branch: string | undefined; archivable?: boolean }) {
  const [folded, toggle] = useCollapsed(`app.sidebar.${id}`)
  const body = useId()
  if (entries.length === 0) return null
  return (
    <section aria-label={label} className="flex flex-col">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls={body}
          onClick={toggle}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span>{label}</span>
          {folded ? <span className="tabular-nums">{entries.length}</span> : null}
          <span aria-hidden="true" className="h-px flex-1 bg-[var(--sidebar-border)]" />
          <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", folded && "-rotate-90")} />
        </button>
        {archivable ? (
          <button
            type="button"
            onClick={() => void (async () => { for (const entry of entries) if (entry.key) await act("sessions.archive", { key: entry.key }) })()}
            className="h-7 shrink-0 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Archive all
          </button>
        ) : null}
      </div>
      {folded ? null : (
        <ul id={body} className="flex flex-col">
          {entries.map((entry) => <SessionCard key={entry.id} entry={entry} branch={branch} />)}
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

/** The sessions: the active ones as cards, then the shelves for other terminals and ended ones. */
function Sessions({ query }: { query: string }) {
  const { entries, branch } = useSessions()
  const shown = entries.filter((entry) => matches(entry, query))
  const active = shown.filter((entry) => entry.where !== "elsewhere" && entry.state !== "exited")
  const elsewhere = shown.filter((entry) => entry.where === "elsewhere")
  const ended = shown.filter((entry) => entry.where !== "elsewhere" && entry.state === "exited")
  const list = useRef<HTMLElement>(null)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <nav ref={list} aria-label="Sessions list" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2">
        {shown.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No sessions match “{query.trim()}”.</p>
        ) : (
          <ul className="flex flex-col">
            {active.map((entry) => <SessionCard key={entry.id} entry={entry} branch={branch} />)}
          </ul>
        )}
        {!query.trim() && entries.length === 1 ? <p className="px-2.5 pt-1 text-xs text-muted-foreground">No other sessions are running.</p> : null}
        <div className="mt-auto flex flex-col pt-2">
          <Shelf id="elsewhere" label="Other terminals" entries={elsewhere} branch={branch} />
          <Shelf id="ended" label="Ended" entries={ended} branch={branch} archivable />
        </div>
      </nav>
      <ScrollHints target={list} />
    </div>
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
          <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-sidebar-foreground">Bot Lobby</span>
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
