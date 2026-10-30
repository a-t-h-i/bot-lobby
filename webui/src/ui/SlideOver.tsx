/**
 * The design's slide-over: a sheet that springs in from the right over a
 * lightly blurred page, and slides back out when closed. It is a Radix dialog
 * (focus moves in, Esc and a click on the page close it) that stays mounted
 * through its exit, showing what it last held. It asks for the overlay slot at
 * sheet priority and stays on screen when a confirmation comes in over it;
 * the keys of the buttons it holds work while nothing is over it.
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { Dialog } from "radix-ui"
import { SheetScope } from "@/lib/hotkeys"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { cn } from "@/lib/utils"
import { ScrollHints } from "./ScrollHints"

const EXIT_MS = 480

interface SlideOverProps {
  open: boolean
  onClose: () => void
  /** Read by screen readers as the sheet's name. */
  label: string
  /** The row above the body: the action bar of a task, a note's title. */
  head?: ReactNode
  children: ReactNode
  className?: string
}

export function SlideOver({ open, onClose, label, head, children, className }: SlideOverProps) {
  const top = useRef(false)
  top.current = useOverlaySlot(open, PRIORITY.sheet)
  const live = open
  // What the sheet held when it was last open, kept while it slides away.
  const last = useRef<{ head: ReactNode; children: ReactNode }>({ head, children })
  if (live) last.current = { head, children }
  const [mounted, setMounted] = useState(live)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (live) {
      setMounted(true)
      // One frame closed first, so the spring has somewhere to start from.
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
      return () => cancelAnimationFrame(frame)
    }
    setOn(false)
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [live])
  const body = useRef<HTMLDivElement>(null)
  if (!mounted && !live) return null
  return (
    <Dialog.Root open={live} onOpenChange={(next) => !next && onClose()} modal={live}>
      <SheetScope.Provider value={top}>
      <Dialog.Portal forceMount>
        <div className={cn("cs-shw", className)} data-open={on && live ? "true" : undefined}>
          <Dialog.Overlay forceMount className="cs-shbd" />
          <Dialog.Content forceMount aria-describedby={undefined} className="cs-shp">
            <Dialog.Title className="sr-only">{label}</Dialog.Title>
            <div className="cs-shh">
              <div className="min-w-0 flex-1">{last.current.head}</div>
              <Dialog.Close className="cs-kc cs-sm cs-ib" aria-label="Close" title="Close · Esc">
                <X aria-hidden="true" className="size-3.5" />
              </Dialog.Close>
            </div>
            <div ref={body} data-pane="detail" className="cs-shb">{last.current.children}</div>
            <ScrollHints target={body} />
          </Dialog.Content>
        </div>
      </Dialog.Portal>
      </SheetScope.Provider>
    </Dialog.Root>
  )
}
