/**
 * "Comment on this line": a pop-up with a plain textarea. Enter adds the
 * comment (the panel revises the draft, or keeps it for the answers) and
 * closes the pop-up; Esc cancels.
 */
import { Popup } from "@/components/ui/popup"
import { act } from "@/lib/act"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { NoteForm } from "@/ui/NoteForm"

interface LineCommentProps {
  /** The draft line being commented on; `undefined` keeps the pop-up closed. */
  line: string | undefined
  onClose: () => void
  /** Called with the line and the comment once the server took it. */
  onSent: (line: string, text: string) => void
}

export function LineComment({ line, onClose, onSent }: LineCommentProps) {
  const shown = useOverlaySlot(line !== undefined, PRIORITY.confirm)
  const send = async (text: string) => {
    if (line === undefined) return false
    const result = await act("planner.commentLine", { line, text: text.trim() })
    if (!result) return false
    onSent(line, text.trim())
    onClose()
    return true
  }
  return (
    <Popup open={line !== undefined && shown} onOpenChange={(next) => !next && onClose()} label="Comment on this line" className="max-w-xl">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
        <div>
          <h2 className="text-base font-medium">Comment on this line</h2>
          <p className="mt-1 line-clamp-3 text-sm break-words text-muted-foreground">{line}</p>
        </div>
        <NoteForm label="Your comment" hint="Enter adds the comment · Esc cancels" buttonLabel="Add comment" onSend={send} />
      </div>
    </Popup>
  )
}
