/**
 * The sidebar on the left of every page, as in the coding harnesses it takes
 * after: the project at the top, this project's sessions under it (this
 * window's opens the Lobby, any other its conversation on the Sessions page)
 * and Settings at the foot. Folded (Alt+B, or its button) it narrows to a rail
 * of icons, so the project, Sessions and Settings stay one click away. On a
 * phone it is a sheet from the left, opened from the menu button in the bar.
 */
import { useEffect, type ReactNode } from "react"
import { Layers, Menu, PanelLeftClose, PanelLeftOpen, Settings, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Keys } from "@/components/ui/kbd"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { WhereIcon } from "@/tabs/sessions/WhereIcon"
import { buildEntries, type Entry } from "@/tabs/sessions/words"
import { useTopic } from "./hooks.ts"
import { ProjectSwitcher, type Projects } from "./ProjectSwitcher.tsx"
import type { Route } from "./router.ts"
import { useApiRead } from "./useApiRead.ts"

export interface SidebarProps {
  projects: Projects
  route: Route
  keys: Record<string, string>
  status?: StatusInfo
}

/** The sessions the sidebar lists: the same entries as the Sessions page, read on every `sessions` change. */
function useSessionEntries(status: StatusInfo | undefined): { entries: Entry[]; loaded: boolean } {
  const lobby = useTopic<LobbySnapshot>("lobby").data
  const asked = useTopic<{ prompts: unknown[] }>("prompts").data?.prompts.length ?? 0
  const read = useApiRead("sessions.list", {}, ["sessions"])
  return { entries: buildEntries(status, lobby, asked, read.data?.background ?? [], read.data?.live ?? []), loaded: Boolean(read.data) }
}

/** Where a session's row leads: this window's conversation is the Lobby. */
function hrefOf(entry: Entry): string {
  return entry.where === "this window" ? "#/lobby" : `#/sessions/${encodeURIComponent(entry.id)}`
}

function isOpen(entry: Entry, route: Route): boolean {
  if (entry.where === "this window") return route.kind === "tab" && route.tab === "lobby"
  return route.kind === "sessions" && route.key === entry.id
}

const ITEM =
  "group/item flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-sm text-sidebar-foreground/85 outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-foreground max-md:min-h-11"

function SessionRow({ entry, open }: { entry: Entry; open: boolean }) {
  const working = entry.status === "working" || entry.status === "starting"
  return (
    <li>
      <a href={hrefOf(entry)} aria-current={open ? "page" : undefined} className={cn(ITEM, "py-1.5")}>
        <WhereIcon where={entry.where} className="size-3.5" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate">{entry.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{entry.where === "this window" ? "this window" : entry.where} · {entry.status.replace(/_/g, " ")}</span>
        </span>
        {entry.waiting > 0 ? (
          <Badge variant="warning-light" radius="full" size="sm" className="text-warning tabular-nums" aria-label={`${entry.waiting} waiting`}>
            {entry.waiting}
          </Badge>
        ) : working ? (
          <Spinner aria-label="working" className="size-3 text-muted-foreground" />
        ) : null}
      </a>
    </li>
  )
}

function SectionHead({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2 px-2 pt-3 pb-1">
      <h2 className="text-xs font-medium text-muted-foreground">{children}</h2>
      {action}
    </div>
  )
}

function Sessions({ route, keys, status }: Omit<SidebarProps, "projects">) {
  const { entries, loaded } = useSessionEntries(status)
  return (
    <nav aria-label="Sessions list" className="flex min-h-0 flex-1 flex-col">
      <SectionHead
        action={
          <a
            href="#/sessions"
            aria-label="Sessions"
            aria-current={route.kind === "sessions" && !route.key ? "page" : undefined}
            aria-keyshortcuts={keys.sessions ?? "Alt+O"}
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:text-sidebar-foreground max-md:h-11"
          >
            <Layers aria-hidden="true" className="size-3.5" />
            View all
          </a>
        }
      >
        Sessions
      </SectionHead>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 pb-2">
        {entries.map((entry) => (
          <SessionRow key={entry.id} entry={entry} open={isOpen(entry, route)} />
        ))}
        {!loaded ? <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"><Spinner aria-hidden="true" role="presentation" className="size-3" />Loading sessions…</li> : null}
      </ul>
    </nav>
  )
}

function SettingsLink({ route, keys, rail }: { route: Route; keys: Record<string, string>; rail?: boolean }) {
  const hint = keys.settings ?? "Alt+S"
  const link = (
    <a
      href="#/settings"
      aria-label="Settings"
      aria-current={route.kind === "settings" ? "page" : undefined}
      aria-keyshortcuts={hint}
      className={rail ? RAIL_ITEM : ITEM}
    >
      <Settings aria-hidden="true" className="size-4 shrink-0" />
      {rail ? null : (
        <>
          <span className="flex-1">Settings</span>
          <Keys chord={hint} className="kbd-hint max-md:hidden" />
        </>
      )}
    </a>
  )
  return rail ? <RailTip label="Settings" hint={hint}>{link}</RailTip> : link
}

function CollapseButton({ hint, onCollapse }: { hint: string; onCollapse: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Collapse sidebar" aria-expanded={true} aria-controls="app-sidebar" aria-keyshortcuts={hint} onClick={onCollapse} className={RAIL_ITEM}>
          <PanelLeftClose aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        Collapse sidebar <Keys chord={hint} />
      </TooltipContent>
    </Tooltip>
  )
}

/** The whole sidebar's content: the project, the sessions and Settings (also the phone sheet's). */
function SidebarBody({ projects, route, keys, status, onCollapse, closer }: SidebarProps & { onCollapse?: () => void; closer?: ReactNode }) {
  const name = status?.workspace.name ?? "bot-lobby"
  const branch = status?.branch ?? status?.workspace.branch
  return (
    <>
      <div className="flex min-w-0 items-center gap-1 px-1 pt-2">
        <ProjectSwitcher projects={projects} tab={route.kind === "tab" ? route.tab : route.kind} name={name} branch={branch} />
        {onCollapse ? <CollapseButton hint={keys.sidebar ?? "Alt+B"} onCollapse={onCollapse} /> : closer}
      </div>
      <Sessions route={route} keys={keys} {...(status ? { status } : {})} />
      <div className="border-t border-sidebar-border px-1 py-2">
        <SettingsLink route={route} keys={keys} />
      </div>
    </>
  )
}

const RAIL_ITEM =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,translate] duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-foreground motion-reduce:active:translate-none"

function RailTip({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">
        {label} {hint ? <Keys chord={hint} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** The folded sidebar: the same three ways out as icons, and the button that opens it again. */
function Rail({ projects, route, keys, status, onExpand }: SidebarProps & { onExpand: () => void }) {
  const name = status?.workspace.name ?? "bot-lobby"
  const branch = status?.branch ?? status?.workspace.branch
  const hint = keys.sidebar ?? "Alt+B"
  return (
    <>
      <RailTip label="Expand sidebar" hint={hint}>
        <button type="button" aria-label="Expand sidebar" aria-expanded={false} aria-controls="app-sidebar" aria-keyshortcuts={hint} onClick={onExpand} className={RAIL_ITEM}>
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        </button>
      </RailTip>
      <ProjectSwitcher projects={projects} tab={route.kind === "tab" ? route.tab : route.kind} name={name} branch={branch} rail />
      <RailTip label="Sessions" hint={keys.sessions ?? "Alt+O"}>
        <a href="#/sessions" aria-label="Sessions" aria-current={route.kind === "sessions" ? "page" : undefined} aria-keyshortcuts={keys.sessions ?? "Alt+O"} className={RAIL_ITEM}>
          <Layers aria-hidden="true" className="size-4" />
        </a>
      </RailTip>
      <span className="flex-1" />
      <SettingsLink route={route} keys={keys} rail />
    </>
  )
}

/**
 * The sidebar from 768 px: full width, or folded to the rail. `over` is a
 * narrow window's open sidebar: it lies over the page, the rail's room kept
 * beside it, until Esc, a click outside or a new page puts it away.
 */
export function Sidebar({ folded, over = false, onToggle, ...props }: SidebarProps & { folded: boolean; over?: boolean; onToggle: () => void }) {
  useEffect(() => {
    if (!over) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("[role='dialog']:not([data-state='closed']), [role='listbox']")) return
      event.preventDefault()
      onToggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [over, onToggle])
  const aside = (
    <aside id="app-sidebar" aria-label="Sidebar" data-folded={folded || undefined} data-over={over || undefined} className="app-sidebar">
      {folded ? <Rail {...props} onExpand={onToggle} /> : <SidebarBody {...props} onCollapse={onToggle} />}
    </aside>
  )
  if (!over) return aside
  return (
    <div className="app-sidebar-room">
      <div aria-hidden="true" className="app-sidebar-scrim" onClick={onToggle} />
      {aside}
    </div>
  )
}

/** The phone's way in: a menu button in the bar that opens the sidebar as a sheet. */
export function SidebarSheet({ open, onOpenChange, ...props }: SidebarProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} aria-describedby="sidebar-sheet-description" className="app-sidebar-sheet gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <SheetTitle className="sr-only">Sidebar</SheetTitle>
        <SheetDescription id="sidebar-sheet-description" className="sr-only">
          The project, its sessions and settings.
        </SheetDescription>
        {/* Following any link closes the sheet: the page it leads to is the point. */}
        <div className="flex min-h-0 flex-1 flex-col px-1" onClick={(event) => { if ((event.target as HTMLElement).closest("a[href]")) onOpenChange(false) }}>
          <SidebarBody
            {...props}
            closer={
              <SheetClose aria-label="Close sidebar" className={cn(RAIL_ITEM, "size-11")}>
                <X aria-hidden="true" className="size-4" />
              </SheetClose>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function SidebarMenuButton({ onOpen, expanded }: { onOpen: () => void; expanded: boolean }) {
  return (
    <button type="button" aria-label="Open sidebar" aria-haspopup="dialog" aria-expanded={expanded} onClick={onOpen} className="toolbar-button inline-flex size-11 shrink-0 items-center justify-center rounded-lg border text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
      <Menu aria-hidden="true" className="size-[1.15rem]" />
    </button>
  )
}
