/**
 * A labelled textarea with a Send button. Enter sends, Shift+Enter breaks the
 * line; the text stays put when the call fails so nothing typed is lost.
 */
import { useId, useState, type KeyboardEvent } from "react"
import { ArrowUp, Loader } from "lucide-react"
import { ActionButton } from "./Actions"
import { Textarea } from "@/components/ui/textarea"

interface NoteFormProps {
  label: string
  hint?: string
  buttonLabel?: string
  /** Resolves `true` when the text was taken, which clears the box. */
  onSend: (text: string) => Promise<boolean>
}

function isSend(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing
}

export function NoteForm({ label, hint, buttonLabel = "Send", onSend }: NoteFormProps) {
  const id = useId()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    if (await onSend(text)) setText("")
    setBusy(false)
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Textarea
        id={id}
        value={text}
        rows={2}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (!isSend(event)) return
          event.preventDefault()
          void send()
        }}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div className="flex self-end">
        <ActionButton label={buttonLabel} icon={busy ? Loader : ArrowUp} tone="primary" shortcut="Enter" className={busy ? "[&_svg]:animate-spin" : undefined} onClick={() => void send()} disabled={!text.trim() || busy} />
      </div>
    </div>
  )
}
