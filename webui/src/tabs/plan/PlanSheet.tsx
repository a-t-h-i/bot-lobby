/**
 * The draft plan in the slide-over, over the page blurred behind it: from the
 * right. "View plan" above the composer (or V) opens it once there is a draft, and it follows the
 * draft as the panel revises it. Its lines still take comments, written right
 * under the line.
 */
import { useMemo, useRef, useState } from "react"
import type { PlannerSnapshot } from "@protocol"
import { SlideOver } from "@/ui/SlideOver"
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
    <SlideOver
      open={open}
      onClose={() => { setCommenting(undefined); onClose() }}
      label="Draft plan"
      closeText
      onEscape={(event) => {
        // Esc puts away the comment being written first, and the plan only after.
        if (line === undefined) return
        event.preventDefault()
        endComment()
      }}
      head={
        <div className="cs-shtitle">
          <h3>Draft plan</h3>
          <p>{snap.round > 0 ? `${roundLabel(snap.round, snap.limit)} · ` : ""}choose a line to comment on it</p>
        </div>
      }
    >
      <div ref={body} className="flex flex-col gap-5">
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
    </SlideOver>
  )
}
