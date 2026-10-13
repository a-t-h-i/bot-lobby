/**
 * The draft plan in a slide-out, over the page blurred behind it: from the
 * right, or from the bottom across the whole screen on a phone. The "View
 * plan" link in the header opens it once there is a draft, and it follows the
 * draft as the panel revises it. Its lines still take comments, written right
 * under the line.
 */
import { useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import type { PlannerSnapshot } from "@protocol"
import { useMediaQuery } from "@/app/hooks"
import { Button } from "@/components/ui/button"
import { Keys } from "@/components/ui/kbd"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { cn } from "@/lib/utils"
import { DraftBody, SeatNeeds, draftRows } from "./Draft"
import { LineComment } from "./LineComment"
import { DRAFT_WAITS, NO_DRAFT, roundLabel } from "./words"

export function PlanSheet({ open, onClose, snap, comments, onSent }: {
  open: boolean
  onClose: () => void
  snap: PlannerSnapshot
  comments: ReadonlyMap<string, string[]>
  /** Called with the line and the comment once the server took it. */
  onSent: (line: string, text: string) => void
}) {
  const shown = useOverlaySlot(open, PRIORITY.sheet)
  const phone = useMediaQuery("(max-width: 767.98px)")
  const body = useRef<HTMLDivElement>(null)
  // The line a comment is being written on, by its place in the draft.
  const [commenting, setCommenting] = useState<number>()
  const rows = useMemo(() => (snap.draft ? draftRows(snap.draft) : []), [snap.draft])
  const line = commenting !== undefined ? rows[commenting]?.text.trim() : undefined
  const endComment = () => {
    const at = commenting
    setCommenting(undefined)
    // Focus goes back to the line's Comment button, so Esc again closes the plan.
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`[data-line="${at}"] button[aria-label^="Comment on this line"]`)?.focus())
  }
  return (
    <Sheet open={open && shown} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        showCloseButton={false}
        side={phone ? "bottom" : "right"}
        aria-label="Draft plan"
        onEscapeKeyDown={(event) => {
          // Esc puts away the comment being written first, and the plan only after.
          if (line === undefined) return
          event.preventDefault()
          endComment()
        }}
        onCloseAutoFocus={() => setCommenting(undefined)}
        className={cn(
          "plan-sheet gap-0",
          phone
            ? "data-[side=bottom]:inset-0 data-[side=bottom]:h-full data-[side=bottom]:max-w-none data-[side=bottom]:rounded-none"
            : "data-[side=right]:w-[min(44rem,92vw)] data-[side=right]:sm:max-w-none",
        )}
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-3 max-md:px-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle className="text-base font-semibold tracking-tight">Draft plan</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {snap.round > 0 ? `${roundLabel(snap.round, snap.limit)} · ` : ""}choose a line to comment on it
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="sm" aria-label="Close the plan" title="Close · Esc" className={cn("gap-2 text-muted-foreground", phone && "h-11 px-3 text-sm")}>
              <X aria-hidden="true" />
              Close
              {phone ? null : <Keys chord="Esc" className="kbd-hint" />}
            </Button>
          </SheetClose>
        </SheetHeader>
        <div ref={body} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pt-4 pb-8 max-md:px-3 max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {snap.draft ? (
            <DraftBody
              draft={snap.draft}
              comments={comments}
              commenting={line !== undefined ? commenting : undefined}
              form={line !== undefined ? <LineComment key={commenting} line={line} onCancel={endComment} onSent={(text) => (onSent(line, text), endComment())} /> : undefined}
              onComment={setCommenting}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{snap.busy ? DRAFT_WAITS : NO_DRAFT}</p>
          )}
          <SeatNeeds notes={snap.notes} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
