/**
 * The list + detail layout the tabs share: at ≥ 1024 px a narrow list card
 * beside a large detail card, below it the list alone with the detail in a
 * right-hand sheet. The route decides what is open; `onClose` takes the
 * detail off the route again.
 */
import type { ReactNode } from "react"
import { X } from "lucide-react"
import { useMediaQuery } from "@/app/hooks"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { cn } from "@/lib/utils"

/** Two cards side by side from this width, in pixels. */
export function useWide(): boolean {
  return useMediaQuery("(min-width: 1024px)")
}

/** A card of glass; its edge lights up while you are inside it. */
export function Pane({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("glass min-h-0 min-w-0 rounded-2xl transition-[border-color] duration-200 focus-within:border-ring/50", className)} {...props} />
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
  return (
    <Sheet open={open && shown} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        showCloseButton={false}
        className="gap-0 data-[side=right]:w-[90%] data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="flex-row items-center justify-between border-b py-2">
          <SheetTitle>Detail</SheetTitle>
          <SheetDescription className="sr-only">{describe}</SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close detail">
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
  if (!wide) {
    return (
      <div className="flex flex-col p-3">
        <Pane>{list}</Pane>
        <DetailSheet open={open && detail !== null} onClose={onClose} describe={describe}>
          {detail}
        </DetailSheet>
      </div>
    )
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,30fr)_minmax(0,70fr)] gap-4 px-4 pb-2">
      <Pane className="overflow-y-auto">{list}</Pane>
      <Pane className="overflow-y-auto p-5">
        {detail ?? <p className="text-sm text-muted-foreground">{hint}</p>}
      </Pane>
    </div>
  )
}

/** The list card's title row: `Tasks ────── 2 open · 2 finished`, then any controls. */
export function PaneHeader({ title, count, children }: { title: string; count?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
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
        <div key={row} className="h-11 rounded-xl bg-muted motion-safe:animate-pulse" />
      ))}
    </div>
  )
}
