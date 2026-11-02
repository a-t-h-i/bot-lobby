// Adapted from T3 Code (MIT), apps/web/src/components/Sidebar.tsx and apps/web/src/components/ui/sidebar.tsx
/**
 * The sidebar, after the user's design (docs/web-ui/composer-surface): a mini rail on the window's left edge
 * (sessions, new session, settings) that grows into the full sidebar while the pointer is on it, or stays open
 * when pinned (the rail's sessions button or the sidebar key). The full sidebar leads with New session, which
 * opens a fresh session in this window at once (it asks nothing; the first prompt names it), then a search over
 * the sessions, the sessions as thin rows (this window's on top, then the background ones it started, then the
 * recent and other terminals' ones in groups that fold away), and at its foot Settings and the app's switches.
 * Switching to a session is a click on its row.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react"
import { Archive, ChevronDown, CircleDashed, Pencil, Trash2 } from "lucide-react"
import { ConfirmButton } from "@/ui/ConfirmButton"
import type { StatusInfo } from "@protocol"
import { Keys } from "@/components/ui/kbd"
import { tip } from "@/ui/TipLayer"
import { act } from "@/lib/act"
import { call } from "@/lib/api"
import { endSwitch, pendingNow, sawSession, startSwitch, usePendingSwitch } from "@/lib/pendingSwitch"
import { toggleCollapsed, useCollapsed } from "@/lib/collapsed"
import { toast } from "@/lib/toast"
import { rem } from "@/lib/uiScale"
import { cn } from "@/lib/utils"
import { FullscreenToggle, HelpButton, NotifyToggle, SoundToggle } from "./AppTools.tsx"
import { useTopic } from "./hooks.ts"
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

/** The open sidebar's size: 244px wide, 600px tall where the window has room (drawn at the 15px root; see lib/uiScale). */
const OPEN = { w: 244, h: `min(${rem(600)}, calc(100vh - ${rem(40)}))` }

const TOOL = "cs-iconbtn cs-sm"

/** The sessions as the sidebar lists them, read live (`sessions` and `status` topics). */
function useSessions(): SessionEntry[] {
  const status = useTopic<StatusInfo>("status").data
  const list = useApiRead("sessions.list", {}, ["sessions"])
  const pending = usePendingSwitch()
  useEffect(() => {
    ownSession = status?.sessionId
    sawSession(status?.sessionId)
  }, [status?.sessionId])
  const entries = sessionEntries(status, list.data)
  if (!pending) return entries
  // A new session takes this window's row at once, under its new name, until this window runs it.
  if (pending.id === NEW) return entries.map((entry) => (entry.where === "here" ? { ...entry, name: "New session", state: "idle", switching: true, fresh: true } : entry))
  // The session being switched to shows as starting from the click on, until this window runs it.
  return entries.map((entry) => (entry.id === pending.id ? { ...entry, state: "starting", switching: true } : entry))
}

/** The pending switch's id while a new session opens. */
const NEW = "new"

const focusComposer = () => requestAnimationFrame(() => document.getElementById("composer-text")?.focus())

/**
 * New session: a fresh, empty session in this window, at once. Nothing is asked; the first prompt names it.
 * The Lobby opens with the composer ready while the server swaps the sessions (a session at work carries on in
 * the background, an idle one waits under Recent).
 */
export async function openNewSession(): Promise<void> {
  go("#/lobby")
  if (pendingNow()) return void toast.info("Still switching. One moment.")
  startSwitch({ id: NEW, ...(ownSession ? { from: ownSession } : {}) })
  focusComposer()
  try {
    // The server shows any notice itself (what carries on in the background, or why nothing opened).
    const { opened } = await call("sessions.new", {})
    // Nothing opened (this window's session is already empty, or a switch is under way): the composer is ready anyway.
    if (!opened) endSwitch()
  } catch (failure) {
    endSwitch()
    toast.error(failure instanceof Error ? failure.message : "Could not open a new session. Try again.")
  }
}

/** This window's session id as the status topic last said, for the switch to tell when it has landed. */
let ownSession: string | undefined

/**
 * Go to a session: this window's own is the Lobby; a background one is moved
 * into this window (if this window is at work, its session carries on in the
 * background); one in another terminal stays there.
 */
async function switchTo(entry: SessionEntry): Promise<void> {
  if (entry.where === "here") return go("#/lobby")
  if (entry.where === "elsewhere") return void toast.info(`${entry.name} runs in another terminal. Switch to that terminal to work in it.`)
  if (pendingNow()) return void toast.info("Still switching. One moment.")
  // Answer the click at once: the row shows the switch and the Lobby opens while the server swaps the sessions.
  startSwitch({ id: entry.id, ...(entry.sessionId ? { sessionId: entry.sessionId } : {}), ...(ownSession ? { from: ownSession } : {}) })
  go("#/lobby")
  const result = await act("sessions.switch", entry.key ? { key: entry.key } : { sessionId: entry.sessionId! })
  // The server says why when it did not start the switch: it answers with no "switching" notice.
  if (!result || !/switching this window/.test(result.notice)) endSwitch()
}

function useSwitch(): (entry: SessionEntry) => Promise<void> {
  return useCallback(switchTo, [])
}

/** The sessions as the sidebar last listed them, and how to show the sidebar for a moment: for the session keys. */
const listed: { entries: SessionEntry[]; flash?: () => void } = { entries: [] }

/**
 * Switch to the next (1) or previous (-1) session the sidebar lists, past the ones in other terminals, which
 * cannot be switched to from here; the sidebar opens for a moment to show where the key went.
 */
export async function cycleSession(delta: number): Promise<void> {
  const ring = listed.entries.filter((entry) => entry.where !== "elsewhere")
  const at = ring.findIndex((entry) => entry.where === "here")
  if (ring.length < 2 || at < 0) return void toast.info("No other session to switch to.")
  listed.flash?.()
  await switchTo(ring[(at + delta + ring.length) % ring.length]!)
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

const WHERE = { here: "Current", background: "Background", elsewhere: "Other terminal", saved: "Recent" }

/** Put an ended session away, with Undo on the notice. */
function archive(entry: SessionEntry): Promise<unknown> {
  const which = entry.key ? { key: entry.key } : { sessionId: entry.sessionId! }
  return act("sessions.archive", which, { undo: () => void act("sessions.archive", { ...which, archived: false }) })
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
  const canRename = entry.where === "here" || entry.where === "background"
  const canArchive = (entry.where === "background" && entry.state === "exited" && Boolean(entry.key)) || entry.where === "saved"
  const canDelete = entry.where === "saved"
  const hasActions = canRename || canArchive || canDelete
  const style = { "--i": index } as CSSProperties
  return (
    <li className="cs-srow session-item" data-fresh={entry.fresh || undefined}>
      {renaming ? (
        <div className="cs-sr" data-active={entry.where === "here" || undefined} style={style}>
          <RenameField entry={entry} onDone={() => setRenaming(false)} />
        </div>
      ) : (
        <button
          type="button"
          aria-current={entry.where === "here" ? "true" : undefined}
          aria-label={entry.where === "here" ? `${entry.name}, this window` : entry.where === "elsewhere" ? `${entry.name}, in another terminal` : `Switch to ${entry.name}`}
          {...tip(entry.name, { side: "right" })}
          data-tip-trunc=""
          data-where={entry.where}
          data-state={entry.state}
          data-dim={quiet || undefined}
          data-active={entry.switching || undefined}
          aria-busy={entry.switching || undefined}
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
            <button type="button" aria-label={`Rename ${entry.name}`} onClick={() => setRenaming(true)} className="cs-sact" {...tip("Rename", { side: "right" })}>
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
          {canArchive ? (
            <button type="button" aria-label={`Archive ${entry.name}`} onClick={() => void archive(entry)} className="cs-sact" {...tip("Archive", { side: "right" })}>
              <Archive aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
          {canDelete ? (
            <ConfirmButton
              iconOnly
              className="cs-sact"
              side="right"
              label={`Delete ${entry.name}`}
              text="Delete"
              icon={Trash2}
              variant="destructive"
              title={`Delete ${entry.name}?`}
              description="Its conversation file is removed for good. Archive it instead to keep it."
              confirmLabel="Delete"
              onConfirm={() => void act("sessions.delete", { sessionId: entry.sessionId! })}
            />
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
        <button type="button" aria-expanded={!folded} aria-controls={body} onClick={toggle} className="cs-shf flex flex-1 items-center gap-1.5 text-left">
          <span>{label}</span>
          {folded ? <span className="tabular-nums">{entries.length}</span> : null}
          <ChevronDown aria-hidden="true" className={cn("size-3 opacity-0 transition-[opacity,rotate] duration-150 group-hover/shelf:opacity-100 group-focus-within/shelf:opacity-100", folded && "-rotate-90 opacity-100")} />
        </button>
        {archivable ? (
          <button
            type="button"
            onClick={() => void (async () => { for (const entry of entries) await act("sessions.archive", entry.key ? { key: entry.key } : { sessionId: entry.sessionId! }) })()}
            className="cs-shf shrink-0"
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

const PENCIL = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>

/** New session, the sidebar's first row: one click, nothing asked. */
function NewRow({ hint }: { hint: string }) {
  return (
    <button type="button" onClick={() => void openNewSession()} aria-keyshortcuts={hint} className="cs-sr cs-snew" style={{ "--i": 0 } as CSSProperties}>
      {PENCIL}
      <span className="cs-grow">New session</span>
      <Keys chord={hint} className="cs-kbd-quiet" />
    </button>
  )
}

/** The search over the sessions, sunk into the sidebar. */
function SearchRow({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  return (
    <label className="cs-sr cs-search" style={{ "--i": 1 } as CSSProperties}>
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
    </label>
  )
}

/**
 * The sessions: the running ones in one list (this window's on top, marked; the background ones under it, each
 * with its state at the end), then the recent ones and other terminals' in groups that fold away.
 */
function Sessions({ query }: { query: string }) {
  const entries = useSessions()
  const shown = entries.filter((entry) => matches(entry, query))
  const running = [
    ...shown.filter((entry) => entry.where === "here" && entry.state !== "exited"),
    ...shown.filter((entry) => entry.where === "background" && entry.state !== "exited"),
  ]
  const elsewhere = shown.filter((entry) => entry.where === "elsewhere")
  // Ended background sessions first, then the project's saved ones, newest first: they stay until archived or deleted.
  const ended = shown.filter((entry) => entry.where !== "elsewhere" && entry.state === "exited")
  let i = 2
  const at = (count: number) => {
    const start = i
    i += count + 1
    return start
  }
  const runAt = at(running.length)
  return (
    <nav aria-label="Sessions list" className="cs-sblist">
      {shown.length === 0 ? <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No sessions match “{query.trim()}”.</p> : null}
      {running.length > 0 ? (
        <>
          <p className="cs-sh" style={{ "--i": runAt } as CSSProperties}>Sessions</p>
          <ul className="flex flex-col">{running.map((entry, index) => <SessionRow key={entry.id} entry={entry} index={runAt + 1 + index} />)}</ul>
        </>
      ) : null}
      <Shelf id="ended" label="Recent" entries={ended} start={at(ended.length)} archivable />
      <Shelf id="elsewhere" label="Other terminals" entries={elsewhere} start={at(elsewhere.length)} />
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
  const bay = useHoverBay(160, 1600)
  listed.entries = useSessions()
  listed.flash = bay.flash
  const [query, setQuery] = useState("")
  const open = pinned || bay.open
  const vars = { "--wL": rem(open ? OPEN.w : 122), "--hL": open ? OPEN.h : rem(40), "--sb-open-h": OPEN.h } as CSSProperties
  return {
    open,
    pinned,
    ghost: <BayGhost className="cs-gl" style={vars} />,
    bay: (
      <div className="cs-sbwrap" style={vars} {...bay.handlers}>
        <aside id="app-sidebar" aria-label="Sidebar" className="cs-sbx">
          <div className="cs-sbmini" inert={open}>
            <button type="button" aria-label="Sessions" aria-pressed={pinned} aria-keyshortcuts={props.keys.sidebar} onClick={togglePin} className="cs-iconbtn" {...tip(pinned ? "Unpin sidebar" : "Pin sidebar", { keys: props.keys.sidebar, side: "bottom", keep: true })}>
              <TabGlyph id="lobby" />
            </button>
            <button type="button" aria-label="New session" aria-keyshortcuts={props.keys.newSession} onClick={() => void openNewSession()} className="cs-iconbtn" {...tip("New session", { keys: props.keys.newSession ?? "Alt+N", side: "bottom" })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
            </button>
            <a href="#/settings" aria-label="Settings" aria-current={props.route.kind === "settings" ? "page" : undefined} className="cs-iconbtn" {...tip("Settings", { keys: props.keys.settings ?? "Alt+S", side: "bottom" })}>
              <TabGlyph id="settings" />
            </a>
          </div>
          <div className="cs-sbfull" inert={!open}>
            <NewRow hint={props.keys.newSession ?? "Alt+N"} />
            <SearchRow query={query} onQuery={setQuery} />
            <Sessions query={query} />
            <Foot {...props} />
          </div>
        </aside>
      </div>
    ),
  }
}
