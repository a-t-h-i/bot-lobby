/**
 * "Comment on this line", written right under the line in the draft: a plain
 * textarea that takes focus. Enter adds the comment (the panel revises the
 * draft, or keeps it for the answers) and puts the form away; Esc or Cancel
 * puts it away unsent.
 */
import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { act } from "@/lib/act"
import { NoteForm } from "@/ui/NoteForm"

interface LineCommentProps {
  /** The draft line being commented on. */
  line: string
  onCancel: () => void
  /** Called with the comment once the server took it. */
  onSent: (text: string) => void
}

export function LineComment({ line, onCancel, onSent }: LineCommentProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = ref.current?.querySelector("textarea")
    box?.focus()
    box?.scrollIntoView({ block: "nearest" })
  }, [])
  const send = async (text: string) => {
    const result = await act("planner.commentLine", { line, text: text.trim() })
    if (!result) return false
    onSent(text.trim())
    return true
  }
  return (
    <div ref={ref} role="group" aria-label="Comment on this line" className="line-comment cs-dform">
      <Button type="button" variant="ghost" size="icon" aria-label="Cancel the comment" title="Cancel · Esc" onClick={onCancel} className="absolute top-1.5 right-1.5 size-7">
        <X aria-hidden="true" />
      </Button>
      <NoteForm label="Your comment" hint="Enter adds the comment · Esc cancels" buttonLabel="Add comment" onSend={send} />
    </div>
  )
}
