/**
 * The list + detail layout the tabs share (batch-2 §Conventions): at ≥ 1024 px
 * the terminal's two panes side by side, below it the list alone with the
 * detail in a right-hand Sheet. The route decides what is open; `onClose`
 * takes the detail off the route again.
 */
import type { ReactNode } from "react"
import { X } from "lucide-react"
import { useMediaQuery } from "@/app/hooks"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/** The terminal's `*_COLUMNS_MIN` split, in pixels. */
export function useWide(): boolean {
  return useMediaQuery("(min-width: 1024px)")
}

/** A pane framed as the terminal frames one, drawn in the focus colour while you are in it (D-21). */
export function Pane({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("min-h-0 min-w-0 rounded-md border border-border bg-card text-card-foreground focus-within:border-ring", className)} {...props} />
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
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        showCloseButton={false}
        className="gap-0 data-[side=right]:w-[90%] data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="flex-row items-center justify-between border-b py-2">
          <SheetTitle>Detail</SheetTitle>
          <SheetDescription className="sr-only">{describe}</SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" className="size-10" aria-label="Close detail">
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
      <div className="flex flex-col p-[1ch]">
        <Pane>{list}</Pane>
        <DetailSheet open={open && detail !== null} onClose={onClose} describe={describe}>
          {detail}
        </DetailSheet>
      </div>
    )
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,36fr)_minmax(0,64fr)] gap-[1ch] p-[1ch]">
      <Pane className="overflow-y-auto">{list}</Pane>
      <Pane className="overflow-y-auto p-4">
        {detail ?? <p className="text-sm text-muted-foreground">{hint}</p>}
      </Pane>
    </div>
  )
}

/** The list pane's title row, as the terminal heads a list: `Tasks ────── 2 open · 2 finished`, then any controls. */
export function PaneHeader({ title, count, children }: { title: string; count?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[1ch] gap-y-2 px-[1ch] py-2">
      <h2 className="text-sm font-bold">{title}</h2>
      <span aria-hidden="true" className="min-w-[2ch] flex-1 border-t border-border" />
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
        <div key={row} className="h-11 bg-muted motion-safe:animate-pulse" />
      ))}
    </div>
  )
}
