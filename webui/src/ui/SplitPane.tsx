/**
 * The list + detail layout the tabs share: at ≥ 1024 px a narrow list pane
 * beside a large detail pane, below it the list alone with the detail in a
 * right-hand sheet. The route decides what is open; `onClose` takes the
 * detail off the route again.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { PanelRight, X } from "lucide-react"
import { Keys, KeyHint } from "@/components/ui/kbd"
import { useMediaQuery } from "@/app/hooks"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PRIORITY, hasOverlay, useOverlaySlot } from "@/lib/overlay"
import { currentRow, horizontalStep, isTyping, stepRows, verticalStep } from "@/prompts/nav"
import { cn } from "@/lib/utils"

/** Two cards side by side from this width, in pixels. */
export function useWide(): boolean {
  return useMediaQuery("(min-width: 1024px)")
}

/** A quiet shared surface for a meaningful list or detail group. */
export function Pane({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("flat-pane min-h-0 min-w-0", className)} {...props} />
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
        className={cn("gap-0 data-[side=right]:w-[90%] data-[side=right]:sm:max-w-3xl", !shown && "!hidden")}
      >
        <SheetHeader className="flex-row items-center justify-between border-b py-2">
          <SheetTitle>Detail</SheetTitle>
          <SheetDescription className="sr-only">{describe}</SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close detail" title="Close · Esc">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
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
      <div className="flex flex-col p-3">
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
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,30fr)_minmax(0,70fr)] gap-4 px-4 pb-2">
      <Pane data-pane="list" ref={listPane} onKeyDown={onListKey} className="composer-inset overflow-y-auto">
        {list}
      </Pane>
      <Pane data-pane="detail" ref={detailPane} tabIndex={0} aria-label="Detail" onKeyDown={onDetailKey} className="composer-inset overflow-y-auto p-4 outline-none">
        {detail ?? (
          <div className="grid h-full min-h-48 place-items-center">
            <div className="flex max-w-xs flex-col items-center gap-2 text-center">
              <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <PanelRight className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">{hint}</p>
              <p className="text-xs text-muted-foreground/70">
                <KeyHint chord="ArrowUp" className="gap-1">
                  <Keys chord="ArrowDown" />
                  move, <Keys chord="ArrowRight" /> opens
                </KeyHint>
              </p>
            </div>
          </div>
        )}
      </Pane>
    </div>
  )
}

/** The list pane's title row: `Tasks            2 open · 2 finished`, then any controls. */
export function PaneHeader({ title, count, children }: { title: string; count?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <span aria-hidden="true" className="min-w-4 flex-1" />
      {count ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  )
}

/** Placeholder rows while the first answer is on its way. */
export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3" role="status" aria-label="Loading">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-9 rounded-lg bg-muted motion-safe:animate-pulse" />
      ))}
    </div>
  )
}
