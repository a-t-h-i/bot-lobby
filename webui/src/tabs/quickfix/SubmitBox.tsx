/**
 * Where a quick fix is typed: a labelled box and Send, under the list (the
 * intro says "below"). Enter sends; the text stays when the call fails.
 */
import { NoteForm } from "@/ui/NoteForm"
import { Pane } from "@/ui/SplitPane"
import { act } from "@/lib/act"

export function SubmitBox({ onSent }: { onSent: () => void }) {
  const send = async (text: string) => {
    const result = await act("quickfix.submit", { text })
    if (result) onSent()
    return result !== undefined
  }
  return (
    <Pane className="mx-4 mb-4 shrink-0 p-3">
      <NoteForm label="Describe a small change" hint="Enter sends · Shift+Enter adds a line" onSend={send} />
    </Pane>
  )
}
