// Adapted from T3 Code (MIT), apps/web/src/components/ui/sidebar.tsx
/**
 * The sidebar on the left of every page, as in the coding harnesses it takes
 * after. Open, it lists the running sessions (this window's first, then the
 * background sessions it started, then those in other terminals) and switching
 * to one is a click; at its foot sit the app's switches (the look, desktop
 * notifications, full screen, the key list, light or dark, the sounds) and
 * Settings. It folds to a rail of icons (the button at its top, or the
 * sidebar key), each session a lettered tile, and remembers which in this
 * browser; until then it starts folded on a window under 1024 px. The project itself is chosen in the composer. On a phone it is a
 * sheet from the left, opened from the menu button in the bar.
 */
import { useCallback, useRef, type ReactNode } from "react"
import { Menu, PanelLeftClose, PanelLeftOpen, Settings, X } from "lucide-react"
import type { StatusInfo } from "@protocol"
import { Keys } from "@/components/ui/kbd"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { act } from "@/lib/act"
import { useCollapsed } from "@/lib/collapsed"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { ScrollHints } from "@/ui/ScrollHints"
import { AppearanceButton, FullscreenToggle, HelpButton, NotifyToggle, SoundToggle, ThemeToggle } from "./AppTools.tsx"
import { useMediaQuery, useTopic } from "./hooks.ts"
import { NARROW_SIDEBAR } from "@/lib/panePreference"
import { go, type Route } from "./router.ts"
import { sessionEntries, sessionInitial, sessionNote, type SessionEntry } from "./sessionList.ts"
import { useApiRead } from "./useApiRead"

export interface SidebarProps {
  route: Route
  keys: Record<string, string>
  onHelp: () => void
}

/** Where the sidebar's folded state is remembered (`useCollapsed`). */
export const SIDEBAR_KEY = "app.sidebar"

/** Rail tiles shown before the rest wait behind a "+N" that opens the sidebar. */
const RAIL_SESSIONS = 6

const ITEM =
  "group/item flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm text-sidebar-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-sidebar-accent aria-[current=page]:bg-[var(--sidebar-selected)] aria-[current=page]:font-medium [&>svg]:text-[var(--sidebar-icon)] hover:[&>svg]:text-sidebar-foreground aria-[current=page]:[&>svg]:text-sidebar-foreground max-md:min-h-11"

const RAIL_ITEM =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-icon)] outline-none transition-[background-color,color,scale] duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.97] aria-pressed:text-sidebar-foreground aria-[current=page]:bg-[var(--sidebar-selected)] aria-[current=page]:text-sidebar-foreground aria-[current=page]:shadow-control motion-reduce:active:scale-100"

const SESSION_ROW =
  "session-row flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-[background-color,scale] duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.98] aria-[current=true]:bg-[var(--sidebar-selected)] aria-[current=true]:shadow-control motion-reduce:active:scale-100"

function SettingsLink({ route, keys, rail }: { route: Route; keys: Record<string, string>; rail?: boolean }) {
  const hint = keys.settings ?? "Alt+S"
  const link = (
    <a
      href="#/settings"
      aria-label="Settings"
      aria-current={route.kind === "settings" ? "page" : undefined}
      aria-keyshortcuts={hint}
      className={rail ? RAIL_ITEM : cn(ITEM, "flex-1")}
    >
      <Settings aria-hidden="true" className="size-4 shrink-0" />
      {rail ? null : <span className="flex-1">Settings</span>}
    </a>
  )
  return <RailTip label="Settings" hint={hint} side={rail ? "right" : "top"}>{link}</RailTip>
}

function RailTip({ label, hint, side = "right", children }: { label: string; hint?: string | undefined; side?: "right" | "top" | "bottom"; children: ReactNode }) {
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
function StateDot({ entry, className }: { entry: SessionEntry; className?: string }) {
  return <span aria-hidden="true" data-state={entry.where === "elsewhere" ? "elsewhere" : entry.state} className={cn("session-dot", className ?? "relative")} />
}

/** The sessions, open: a row each, the name over what it is doing. */
function SessionList({ entries, onPicked }: { entries: SessionEntry[]; onPicked?: () => void }) {
  const pick = useSwitch()
  return (
    <nav aria-label="Sessions list" className="flex min-h-0 flex-col">
      <h2 className="flex items-center justify-between px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        Sessions
        <span className="tabular-nums">{entries.length}</span>
      </h2>
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry) => (
          <li key={entry.id} className="session-enter">
            <button
              type="button"
              aria-current={entry.where === "here" ? "true" : undefined}
              aria-label={entry.where === "here" ? `${entry.name}, this window` : entry.where === "elsewhere" ? `${entry.name}, in another terminal` : `Switch to ${entry.name}`}
              data-where={entry.where}
              onClick={() => {
                onPicked?.()
                void pick(entry)
              }}
              className={SESSION_ROW}
            >
              <StateDot entry={entry} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate text-sm", entry.where === "here" ? "font-medium text-sidebar-foreground" : entry.state === "exited" ? "text-muted-foreground" : "text-sidebar-foreground")}>{entry.name}</span>
                <span className={cn("truncate text-xs", entry.state === "asking" ? "text-warning" : "text-muted-foreground")}>{sessionNote(entry)}</span>
              </span>
              {entry.waiting > 0 ? (
                <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-warning/16 px-1.5 text-xs font-medium text-warning tabular-nums">
                  {entry.waiting}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {entries.length === 1 ? <p className="px-2.5 pt-1.5 text-xs text-muted-foreground">No other sessions are running.</p> : null}
    </nav>
  )
}

/** The sessions, folded: a lettered tile each, the current one raised, its state a dot in the corner. */
function RailSessions({ entries, onMore }: { entries: SessionEntry[]; onMore: () => void }) {
  const pick = useSwitch()
  const shown = entries.slice(0, RAIL_SESSIONS)
  const rest = entries.length - shown.length
  return (
    <nav aria-label="Sessions list" className="flex flex-col items-center gap-1 border-y border-[var(--glass-edge)] py-1.5">
      {shown.map((entry) => (
        <RailTip key={entry.id} label={`${entry.name} · ${sessionNote(entry)}`}>
          <button
            type="button"
            aria-current={entry.where === "here" ? "true" : undefined}
            aria-label={entry.where === "here" ? `${entry.name}, this window` : entry.where === "elsewhere" ? `${entry.name}, in another terminal` : `Switch to ${entry.name}`}
            data-where={entry.where}
            onClick={() => void pick(entry)}
            className={cn(RAIL_ITEM, "session-tile relative text-xs font-semibold aria-[current=true]:bg-[var(--sidebar-selected)] aria-[current=true]:text-sidebar-foreground aria-[current=true]:shadow-control")}
          >
            {sessionInitial(entry.name)}
            <StateDot entry={entry} className="absolute right-0.5 bottom-0.5 ring-2 ring-[var(--sidebar)]" />
          </button>
        </RailTip>
      ))}
      {rest > 0 ? (
        <RailTip label={`${rest} more ${rest === 1 ? "session" : "sessions"}`}>
          <button type="button" aria-label={`Show all ${entries.length} sessions`} onClick={onMore} className={cn(RAIL_ITEM, "text-xs tabular-nums")}>
            +{rest}
          </button>
        </RailTip>
      ) : null}
    </nav>
  )
}

/** The button at the sidebar's top that folds it to the rail, or opens it again. */
function FoldButton({ folded, onToggle, hint }: { folded: boolean; onToggle: () => void; hint?: string | undefined }) {
  const label = folded ? "Expand sidebar" : "Collapse sidebar"
  const Icon = folded ? PanelLeftOpen : PanelLeftClose
  return (
    <RailTip label={label} hint={hint} side={folded ? "right" : "bottom"}>
      <button type="button" aria-label={label} aria-expanded={!folded} aria-controls="app-sidebar" aria-keyshortcuts={hint} onClick={onToggle} className={RAIL_ITEM}>
        <Icon aria-hidden="true" className="size-4" />
      </button>
    </RailTip>
  )
}

/** The app's switches and Settings, two rows at the foot of the open sidebar (and the phone's sheet). */
function Foot({ route, keys, onHelp, phone = false }: SidebarProps & { phone?: boolean }) {
  const tool = cn(RAIL_ITEM, phone ? "size-11" : "size-8")
  return (
    <>
      <div className="sidebar-foot flex items-center gap-1 px-1 py-2">
        <SettingsLink route={route} keys={keys} />
        {/* No key list on a phone: there are no keys to list. */}
        {phone ? null : <HelpButton hint={keys.help ?? "Alt+H"} onHelp={onHelp} className={tool} />}
        <ThemeToggle className={tool} />
        <SoundToggle className={tool} />
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--glass-edge)] px-1 py-2">
        <AppearanceButton className={tool} />
        <NotifyToggle className={tool} />
        <FullscreenToggle className={tool} />
      </div>
    </>
  )
}

/** The sidebar open from 768 px: the fold button, the sessions, and the foot. */
function Panel({ props, entries, onToggle }: { props: SidebarProps; entries: SessionEntry[]; onToggle: () => void }) {
  const list = useRef<HTMLDivElement>(null)
  return (
    <div className="sidebar-panel flex min-h-0 w-[15rem] flex-1 flex-col">
      <div className="flex min-h-12 items-center px-1">
        <FoldButton folded={false} onToggle={onToggle} hint={props.keys.sidebar} />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-2">
          <SessionList entries={entries} />
        </div>
        <ScrollHints target={list} />
      </div>
      <Foot {...props} />
    </div>
  )
}

/** The sidebar folded: a rail of icons, the sessions as tiles, the app's switches at its foot and Settings last. */
function Rail({ props, entries, onToggle }: { props: SidebarProps; entries: SessionEntry[]; onToggle: () => void }) {
  const { route, keys, onHelp } = props
  return (
    <>
      <FoldButton folded onToggle={onToggle} hint={keys.sidebar} />
      <RailSessions entries={entries} onMore={onToggle} />
      <AppearanceButton className={RAIL_ITEM} side="right" />
      <NotifyToggle className={RAIL_ITEM} side="right" />
      <FullscreenToggle className={RAIL_ITEM} side="right" />
      <span className="flex-1" />
      <HelpButton hint={keys.help ?? "Alt+H"} onHelp={onHelp} className={RAIL_ITEM} side="right" />
      <ThemeToggle className={RAIL_ITEM} side="right" />
      <SoundToggle className={RAIL_ITEM} side="right" />
      <SettingsLink route={route} keys={keys} rail />
    </>
  )
}

export function Sidebar(props: SidebarProps) {
  // Read again when the window crosses the narrow width: unpicked, the sidebar folds below it.
  useMediaQuery(NARROW_SIDEBAR)
  const [folded, toggle] = useCollapsed(SIDEBAR_KEY)
  const entries = useSessions()
  return (
    <aside id="app-sidebar" aria-label="Sidebar" data-folded={folded ? "" : undefined} className="app-sidebar">
      {folded ? <Rail props={props} entries={entries} onToggle={toggle} /> : <Panel props={props} entries={entries} onToggle={toggle} />}
    </aside>
  )
}

/** The phone's way in: a menu button in the bar that opens the sidebar as a sheet. */
export function SidebarSheet({ open, onOpenChange, ...props }: SidebarProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const entries = useSessions()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} aria-describedby="sidebar-sheet-description" className="app-sidebar-sheet gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <SheetTitle className="sr-only">Sidebar</SheetTitle>
        <SheetDescription id="sidebar-sheet-description" className="sr-only">
          The running sessions, Settings and the app's switches.
        </SheetDescription>
        {/* Following any link closes the sheet: the page it leads to is the point. */}
        <div className="flex min-h-0 flex-1 flex-col px-1" onClick={(event) => { if ((event.target as HTMLElement).closest("a[href]")) onOpenChange(false) }}>
          <div className="flex min-h-12 items-center justify-end px-1">
            <SheetClose aria-label="Close sidebar" className={cn(RAIL_ITEM, "size-11")}>
              <X aria-hidden="true" className="size-4" />
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SessionList entries={entries} onPicked={() => onOpenChange(false)} />
          </div>
          <Foot {...props} phone />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function SidebarMenuButton({ onOpen, expanded }: { onOpen: () => void; expanded: boolean }) {
  return (
    <button type="button" aria-label="Open sidebar" aria-haspopup="dialog" aria-expanded={expanded} onClick={onOpen} className={cn(RAIL_ITEM, "size-11 text-foreground")}>
      <Menu aria-hidden="true" className="size-[1.15rem]" />
    </button>
  )
}
