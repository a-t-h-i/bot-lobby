/**
 * The list + detail layout the tabs share: at ≥ 1024 px a narrow list pane
 * beside a large detail pane, divided by a hairline, below it the list alone
 * with the detail in a right-hand sheet. The route decides what is open;
 * `onClose` takes the detail off the route again. Arrow keys (and `j`/`k`)
 * walk the rows, `→` goes into the detail and `←` comes back.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { PanelRight, X } from "lucide-react"
import { Keys } from "@/components/ui/kbd"
import { useMediaQuery } from "@/app/hooks"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PRIORITY, hasOverlay, useOverlaySlot } from "@/lib/overlay"
import { currentRow, horizontalStep, isTyping, stepRows, verticalStep } from "@/prompts/nav"
import { cn } from "@/lib/utils"

/** Two panes side by side from this width, in pixels. */
export function useWide(): boolean {
  return useMediaQuery("(min-width: 1024px)")
}

/** A pane with no card of its own: it sits on the page's surface. */
export function Pane({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("min-h-0 min-w-0", className)} {...props} />
}

interface SplitPaneProps {
  wide: boolean
  list: ReactNode
  /** The open detail; `null` when nothing is selected. */
  detail: ReactNode
  /** Whether the Sheet is open (only used below 1024 px). */
  open: boolean
  onClose: () => void
  /** What the empty detail pane says at ≥ 1024 px. */
  hint: string
  /** Read by screen readers when the Sheet opens. */
  describe: string
}

function DetailSheet({ open, onClose, describe, children }: Pick<SplitPaneProps, "open" | "onClose" | "describe"> & { children: ReactNode }) {
  const shown = useOverlaySlot(open, PRIORITY.sheet)
  const mounted = useRef(false)
  if (shown) mounted.current = true
  if (!open) mounted.current = false
  return (
    <Sheet open={open && shown} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        forceMount={open && mounted.current ? true : undefined}
        hidden={!shown}
        showCloseButton={false}
        className={cn("gap-0 data-[side=right]:w-[92%] data-[side=right]:sm:max-w-3xl", !shown && "!hidden")}
      >
        <SheetHeader className="flex-row items-center justify-between border-b px-4 py-2">
          <SheetTitle className="text-sm">Detail</SheetTitle>
          <SheetDescription className="sr-only">{describe}</SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="sm" aria-label="Close detail" title="Close · Esc" className="gap-2">
              <X aria-hidden="true" />
              Close
              <Keys chord="Esc" className="kbd-hint" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

export function SplitPane({ wide, list, detail, open, onClose, hint, describe }: SplitPaneProps) {
  const listPane = useRef<HTMLElement>(null)
  const detailPane = useRef<HTMLElement>(null)

  // List: up/down (or k/j) step through the rows, Home/End jump, right (or l) goes into the detail.
  function onListKey(event: KeyboardEvent<HTMLElement>) {
    const root = listPane.current
    if (!root || event.defaultPrevented || event.nativeEvent.isComposing || hasOverlay() || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target) || event.target instanceof HTMLInputElement) return
    const step = verticalStep(event.key, false)
    if (step) {
      event.preventDefault()
      stepRows(root, event.target as Element, step)
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      stepRows(root, event.target as Element, event.key === "Home" ? "first" : "last")
    } else if (wide && horizontalStep(event.key) === 1 && detailPane.current) {
      event.preventDefault()
      detailPane.current.focus()
    }
  }

  // Detail: left (or h) goes back to the open row in the list.
  function onDetailKey(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || hasOverlay() || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return
    if (horizontalStep(event.key) === -1 && listPane.current) {
      event.preventDefault()
      currentRow(listPane.current)?.focus()
    }
  }

  if (!wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Pane data-pane="list" ref={listPane} onKeyDown={onListKey}>
          {list}
        </Pane>
        <DetailSheet open={open && detail !== null} onClose={onClose} describe={describe}>
          {detail}
        </DetailSheet>
      </div>
    )
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[clamp(17rem,28%,23rem)_minmax(0,1fr)]">
      <Pane data-pane="list" ref={listPane} onKeyDown={onListKey} className="overflow-y-auto border-r border-border">
        {list}
      </Pane>
      <Pane data-pane="detail" ref={detailPane} tabIndex={0} aria-label="Detail" onKeyDown={onDetailKey} className="overflow-y-auto p-5 outline-none focus-visible:bg-muted/30">
        {detail ?? (
          <div className="grid h-full min-h-48 place-items-center">
            <div className="flex max-w-xs flex-col items-center gap-3 text-center">
              <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <PanelRight className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">{hint}</p>
              <p className="kbd-hint flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Keys chord="ArrowUp" />
                  <Keys chord="ArrowDown" />
                  move
                </span>
                <span className="inline-flex items-center gap-1">
                  <Keys chord="ArrowRight" />
                  open
                </span>
              </p>
            </div>
          </div>
        )}
      </Pane>
    </div>
  )
}

/** The list pane's title row: `Tasks            2 open · 2 finished`, then any controls; it stays put while the list scrolls. */
export function PaneHeader({ title, count, children }: { title: string; count?: string; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-card/90 px-4 py-2 backdrop-blur-sm">
      <h2 className="text-sm font-medium">{title}</h2>
      <span aria-hidden="true" className="min-w-2 flex-1" />
      {count ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
      {children ? <div className="flex items-center gap-1.5">{children}</div> : null}
    </div>
  )
}

/** Placeholder rows while the first answer is on its way. */
export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-3" role="status" aria-label="Loading">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-11 rounded-lg bg-muted motion-safe:animate-pulse" />
      ))}
    </div>
  )
}
