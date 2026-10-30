// Adapted from T3 Code (MIT), apps/web/src/components/Sidebar.tsx and apps/web/src/components/ui/sidebar.tsx
/**
 * The sidebar, after the user's design (docs/web-ui/composer-surface): a mini rail on the window's left edge
 * (sessions, new session, settings) that grows into the full sidebar while the pointer is on it, or stays open
 * when pinned (the rail's sessions button or the sidebar key). The full sidebar holds a search over the sessions
 * with the New session button, the sessions as thin rows under small labels (this window's, then the background
 * ones it started, then those in other terminals and the ended ones in groups that fold away), and at its foot
 * Settings and the app's switches. Switching to a session is a click on its row.
 */
import { useCallback, useId, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Archive, ChevronDown, CircleDashed, Pencil } from "lucide-react"
import type { StatusInfo } from "@protocol"
import { Keys } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { act } from "@/lib/act"
import { toggleCollapsed, useCollapsed } from "@/lib/collapsed"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { FullscreenToggle, HelpButton, NotifyToggle, SoundToggle } from "./AppTools.tsx"
import { useTopic } from "./hooks.ts"
import { NewSessionDialog } from "./NewSessionDialog.tsx"
import { BayGhost, TabGlyph, useHoverBay } from "./Bays.tsx"
import { go, type Route } from "./router.ts"
import { sessionEntries, type SessionEntry } from "./sessionList.ts"
import { useApiRead } from "./useApiRead"

export interface SidebarProps {
  route: Route
  keys: Record<string, string>
  onHelp: () => void
}

/** Whether the sidebar is pinned open (`useCollapsed`'s store, remembered in this browser). */
export const SIDEBAR_KEY = "app.sidebar.pinned"

export const toggleSidebarPin = () => toggleCollapsed(SIDEBAR_KEY)

/** The open sidebar's size: 244px wide, 520px tall where the window has room. */
const OPEN = { w: 244, h: "min(520px, calc(100vh - 112px))" }

const TOOL = "cs-iconbtn cs-sm"

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
function useSessions(): SessionEntry[] {
  const status = useTopic<StatusInfo>("status").data
  const list = useApiRead("sessions.list", {}, ["sessions"])
  return sessionEntries(status, list.data)
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

/**
 * What the row shows at its end: a question count while it asks you something, a turning ring while it
 * works or starts, otherwise nothing. The state is spelt out for screen readers.
 */
function RowStatus({ entry }: { entry: SessionEntry }) {
  if (entry.where !== "elsewhere" && entry.state === "asking")
    return (
      <span className="cs-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 2.5-3 4M12 17h.01" /></svg>
        {entry.waiting}
        <span className="sr-only">{entry.waiting === 1 ? " question" : " questions"}, Waiting</span>
      </span>
    )
  if (entry.where !== "elsewhere" && (entry.state === "working" || entry.state === "starting"))
    return (
      <span className={cn("inline-flex shrink-0", entry.state === "working" ? "text-primary" : "text-muted-foreground")}>
        <CircleDashed aria-hidden="true" className="session-spin size-3.5" />
        <span className="sr-only">{entry.state === "working" ? "Working" : "Starting"}</span>
      </span>
    )
  return <span className="sr-only">{entry.where === "elsewhere" ? "Other terminal" : entry.state === "exited" ? "Ended" : "Idle"}</span>
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
      className="h-6 w-full min-w-0 rounded-md bg-[var(--fill)] px-1.5 text-[13px] text-foreground outline-none ring-2 ring-ring"
    />
  )
}

/** A session as a thin row: its name and, at the end, its state; Rename and Archive take the state's place on hover. */
function SessionRow({ entry, index }: { entry: SessionEntry; index: number }) {
  const pick = useSwitch()
  const [renaming, setRenaming] = useState(false)
  const quiet = entry.state === "exited" || entry.where === "elsewhere"
  const canRename = entry.where !== "elsewhere"
  const canArchive = entry.where === "background" && entry.state === "exited" && Boolean(entry.key)
  const hasActions = canRename || canArchive
  const style = { "--i": index } as CSSProperties
  return (
    <li className="cs-srow session-item">
      {renaming ? (
        <div className="cs-sr" data-active={entry.where === "here" || undefined} style={style}>
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
          data-dim={quiet || undefined}
          onClick={() => void pick(entry)}
          onDoubleClick={(event) => {
            if (!canRename) return
            event.preventDefault()
            setRenaming(true)
          }}
          className="cs-sr session-row"
          style={style}
        >
          <span className="cs-grow">{entry.name}</span>
          <span className={cn("flex shrink-0 items-center", hasActions && "cs-sstate")}>
            <RowStatus entry={entry} />
          </span>
        </button>
      )}
      {!renaming && hasActions ? (
        <span className="cs-sacts">
          {canRename ? (
            <Tip label="Rename">
              <button type="button" aria-label={`Rename ${entry.name}`} onClick={() => setRenaming(true)} className="cs-sact">
                <Pencil aria-hidden="true" className="size-3.5" />
              </button>
            </Tip>
          ) : null}
          {canArchive ? (
            <Tip label="Archive">
              <button type="button" aria-label={`Archive ${entry.name}`} onClick={() => void archive(entry)} className="cs-sact">
                <Archive aria-hidden="true" className="size-3.5" />
              </button>
            </Tip>
          ) : null}
        </span>
      ) : null}
    </li>
  )
}

/** A group of sessions under its label; it folds away when its label is clicked, remembered. */
function Shelf({ id, label, entries, start, archivable = false }: { id: string; label: string; entries: SessionEntry[]; start: number; archivable?: boolean }) {
  const [folded, toggle] = useCollapsed(`app.sidebar.${id}`)
  const body = useId()
  if (entries.length === 0) return null
  return (
    <section aria-label={label} className="group/shelf flex flex-col">
      <div className="cs-sh" style={{ "--i": start } as CSSProperties}>
        <button type="button" aria-expanded={!folded} aria-controls={body} onClick={toggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none hover:text-foreground focus-visible:underline">
          <span>{label}</span>
          {folded ? <span className="tabular-nums">{entries.length}</span> : null}
          <ChevronDown aria-hidden="true" className={cn("size-3 opacity-0 transition-[opacity,rotate] duration-150 group-hover/shelf:opacity-100 group-focus-within/shelf:opacity-100", folded && "-rotate-90 opacity-100")} />
        </button>
        {archivable ? (
          <button
            type="button"
            onClick={() => void (async () => { for (const entry of entries) if (entry.key) await act("sessions.archive", { key: entry.key }) })()}
            className="shrink-0 outline-none hover:text-foreground focus-visible:underline"
          >
            Archive all
          </button>
        ) : null}
      </div>
      {folded ? null : (
        <ul id={body} className="flex flex-col">
          {entries.map((entry, index) => <SessionRow key={entry.id} entry={entry} index={start + 1 + index} />)}
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

/** The search field with the New session button at its end, sunk into the sidebar. */
function SearchRow({ query, onQuery, onNew }: { query: string; onQuery: (query: string) => void; onNew: () => void }) {
  return (
    <label className="cs-sr cs-search" style={{ "--i": 0 } as CSSProperties}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
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
      />
      <Tip label="New session">
        <button type="button" aria-label="New session" aria-haspopup="dialog" onClick={onNew} className="flex text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
        </button>
      </Tip>
    </label>
  )
}

/** The sessions: this window's under its label, then the background ones, then other terminals and ended ones. */
function Sessions({ query }: { query: string }) {
  const entries = useSessions()
  const shown = entries.filter((entry) => matches(entry, query))
  const here = shown.filter((entry) => entry.where === "here" && entry.state !== "exited")
  const background = shown.filter((entry) => entry.where === "background" && entry.state !== "exited")
  const elsewhere = shown.filter((entry) => entry.where === "elsewhere")
  const ended = shown.filter((entry) => entry.where !== "elsewhere" && entry.state === "exited")
  let i = 1
  const at = (count: number) => {
    const start = i
    i += count + 1
    return start
  }
  const hereAt = at(here.length)
  const backAt = at(background.length)
  return (
    <nav aria-label="Sessions list" className="cs-sblist">
      {shown.length === 0 ? <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No sessions match “{query.trim()}”.</p> : null}
      {here.length > 0 ? (
        <>
          <p className="cs-sh" style={{ "--i": hereAt } as CSSProperties}>This window</p>
          <ul className="flex flex-col">{here.map((entry, index) => <SessionRow key={entry.id} entry={entry} index={hereAt + 1 + index} />)}</ul>
        </>
      ) : null}
      {background.length > 0 ? (
        <>
          <p className="cs-sh" style={{ "--i": backAt } as CSSProperties}>Background</p>
          <ul className="flex flex-col">{background.map((entry, index) => <SessionRow key={entry.id} entry={entry} index={backAt + 1 + index} />)}</ul>
        </>
      ) : !query.trim() && entries.length === 1 ? (
        <p className="cs-sh" style={{ "--i": backAt } as CSSProperties}>No other sessions are running.</p>
      ) : null}
      <Shelf id="elsewhere" label="Other terminals" entries={elsewhere} start={at(elsewhere.length)} />
      <Shelf id="ended" label="Ended" entries={ended} start={at(ended.length)} archivable />
    </nav>
  )
}

/** Settings and the app's switches at the sidebar's foot. */
function Foot({ route, keys, onHelp }: SidebarProps) {
  const hint = keys.settings ?? "Alt+S"
  return (
    <div className="cs-sbfoot">
      <a href="#/settings" aria-label="Settings" aria-current={route.kind === "settings" ? "page" : undefined} aria-keyshortcuts={hint} className="cs-sr" style={{ "--i": 20 } as CSSProperties}>
        <TabGlyph id="settings" />
        <span className="cs-grow">Settings</span>
        <Keys chord={hint} />
      </a>
      <div className="cs-sr cs-tools" style={{ "--i": 21 } as CSSProperties}>
        <HelpButton hint={keys.help ?? "Alt+H"} onHelp={onHelp} className={TOOL} />
        <SoundToggle className={TOOL} />
        <NotifyToggle className={TOOL} />
        <FullscreenToggle className={TOOL} />
      </div>
    </div>
  )
}

/**
 * The sidebar bay. Returns whether it is open (the frame marks it, so the ghost and the bay grow together), its
 * ghost and the bay itself.
 */
export function useSidebar(props: SidebarProps) {
  const [pinned, togglePin] = useCollapsed(SIDEBAR_KEY)
  const bay = useHoverBay(160)
  const [query, setQuery] = useState("")
  const [starting, setStarting] = useState(false)
  const open = pinned || bay.open || starting
  const vars = { "--wL": `${open ? OPEN.w : 46}px`, "--hL": open ? OPEN.h : "148px", "--sb-open-h": OPEN.h } as CSSProperties
  const newSession = useCallback(() => setStarting(true), [])
  return {
    open,
    ghost: <BayGhost className="cs-gl" style={vars} />,
    bay: (
      <div className="cs-sbwrap" style={vars} {...bay.handlers}>
        <aside id="app-sidebar" aria-label="Sidebar" className="cs-sbx">
          <div className="cs-sbmini" inert={open}>
            <Tip label={pinned ? "Unpin sidebar" : "Pin sidebar"} hint={props.keys.sidebar} side="right">
              <button type="button" aria-label="Sessions" aria-pressed={pinned} aria-keyshortcuts={props.keys.sidebar} onClick={togglePin} className="cs-iconbtn">
                <TabGlyph id="lobby" />
              </button>
            </Tip>
            <Tip label="New session" side="right">
              <button type="button" aria-label="New session" aria-haspopup="dialog" onClick={newSession} className="cs-iconbtn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
              </button>
            </Tip>
            <Tip label="Settings" hint={props.keys.settings ?? "Alt+S"} side="right">
              <a href="#/settings" aria-label="Settings" aria-current={props.route.kind === "settings" ? "page" : undefined} className="cs-iconbtn">
                <TabGlyph id="settings" />
              </a>
            </Tip>
          </div>
          <div className="cs-sbfull" inert={!open}>
            <SearchRow query={query} onQuery={setQuery} onNew={newSession} />
            <Sessions query={query} />
            <Foot {...props} />
          </div>
        </aside>
        <NewSessionDialog open={starting} onOpenChange={setStarting} />
      </div>
    ),
  }
}
