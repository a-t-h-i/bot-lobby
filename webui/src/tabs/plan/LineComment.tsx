/**
 * "Comment on this line": a bottom Sheet with a plain textarea. Enter adds
 * the comment (the panel revises the draft, or keeps it for the answers) and
 * closes the Sheet; Esc cancels.
 */
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { act } from "@/lib/act"
import { NoteForm } from "@/ui/NoteForm"

interface LineCommentProps {
  /** The draft line being commented on; `undefined` keeps the Sheet closed. */
  line: string | undefined
  onClose: () => void
  /** Called with the line and the comment once the server took it. */
  onSent: (line: string, text: string) => void
}

export function LineComment({ line, onClose, onSent }: LineCommentProps) {
  const send = async (text: string) => {
    if (line === undefined) return false
    const result = await act("planner.commentLine", { line, text: text.trim() })
    if (!result) return false
    onSent(line, text.trim())
    onClose()
    return true
  }
  return (
    <Sheet open={line !== undefined} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[80svh] w-full max-w-2xl gap-3 p-4">
        <SheetHeader className="p-0">
          <SheetTitle>Comment on this line</SheetTitle>
          <SheetDescription className="line-clamp-3 break-words">{line}</SheetDescription>
        </SheetHeader>
        <NoteForm label="Your comment" hint="Enter adds the comment · Esc cancels" buttonLabel="Add comment" onSend={send} />
      </SheetContent>
    </Sheet>
  )
}
