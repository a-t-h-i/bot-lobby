// Adapted from T3 Code (MIT), apps/web/src/components/ui/sidebar.tsx
/**
 * The rail on the left of every page, as in the coding harnesses it takes
 * after: up top the things you reach for while working (the look, desktop
 * notifications, full screen), at the foot the app's switches (the key list,
 * light or dark, the sounds) and Settings. The project itself is chosen in the composer. On a phone it is a
 * sheet from the left, opened from the menu button in the bar.
 */
import type { ReactNode } from "react"
import { Menu, Settings, X } from "lucide-react"
import { Keys } from "@/components/ui/kbd"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { AppearanceButton, FullscreenToggle, HelpButton, NotifyToggle, SoundToggle, ThemeToggle } from "./AppTools.tsx"
import type { Route } from "./router.ts"

export interface SidebarProps {
  route: Route
  keys: Record<string, string>
  onHelp: () => void
}

const ITEM =
  "group/item flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm text-sidebar-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-sidebar-accent aria-[current=page]:bg-[var(--sidebar-selected)] aria-[current=page]:font-medium [&>svg]:text-[var(--sidebar-icon)] hover:[&>svg]:text-sidebar-foreground aria-[current=page]:[&>svg]:text-sidebar-foreground max-md:min-h-11"

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

/** The phone sheet's content: the way to close it, then Settings and the app's switches. */
function SidebarBody({ route, keys, onHelp, closer, phone = false }: SidebarProps & { closer?: ReactNode; phone?: boolean }) {
  const tool = cn(RAIL_ITEM, phone ? "size-11" : "size-8")
  return (
    <>
      <div className="flex min-h-12 items-center justify-end px-1">{closer}</div>
      <span className="flex-1" />
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

const RAIL_ITEM =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-icon)] outline-none transition-[background-color,color,scale] duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.97] aria-pressed:text-sidebar-foreground aria-[current=page]:bg-[var(--sidebar-selected)] aria-[current=page]:text-sidebar-foreground aria-[current=page]:shadow-control motion-reduce:active:scale-100"

function RailTip({ label, hint, side = "right", children }: { label: string; hint?: string; side?: "right" | "top"; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {label} {hint ? <Keys chord={hint} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** The sidebar from 768 px: a rail of icons, the app's switches at its foot and Settings last. */
function Rail({ route, keys, onHelp }: SidebarProps) {
  return (
    <>
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
  return (
    <aside id="app-sidebar" aria-label="Sidebar" data-folded className="app-sidebar">
      <Rail {...props} />
    </aside>
  )
}

/** The phone's way in: a menu button in the bar that opens the sidebar as a sheet. */
export function SidebarSheet({ open, onOpenChange, ...props }: SidebarProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} aria-describedby="sidebar-sheet-description" className="app-sidebar-sheet gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <SheetTitle className="sr-only">Sidebar</SheetTitle>
        <SheetDescription id="sidebar-sheet-description" className="sr-only">
          Settings and the app's switches.
        </SheetDescription>
        {/* Following any link closes the sheet: the page it leads to is the point. */}
        <div className="flex min-h-0 flex-1 flex-col px-1" onClick={(event) => { if ((event.target as HTMLElement).closest("a[href]")) onOpenChange(false) }}>
          <SidebarBody
            {...props}
            phone
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
    <button type="button" aria-label="Open sidebar" aria-haspopup="dialog" aria-expanded={expanded} onClick={onOpen} className={cn(RAIL_ITEM, "size-11 text-foreground")}>
      <Menu aria-hidden="true" className="size-[1.15rem]" />
    </button>
  )
}
