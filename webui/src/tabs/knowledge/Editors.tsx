/**
 * The Knowledge editors: the picked entry as a textarea with Save/Cancel, and
 * the whole file in a pop-up. `Enter` saves the entry (`Shift+Enter` breaks
 * the line); the archive hint is the compactor's promise, shown beside every
 * write.
 */
import { useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Popup } from "@/components/ui/popup"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { ARCHIVE_HINT } from "./words"

function isSave(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing
}

interface EntryEditorProps {
  /** The entry as it was drawn; the box starts with it. */
  initial: string
  busy: boolean
  onSave: (text: string) => void
  onCancel: () => void
}

/** One entry's text in a box: Enter saves, Shift+Enter breaks the line, Cancel leaves it. */
export function EntryEditor({ initial, busy, onSave, onCancel }: EntryEditorProps) {
  const [text, setText] = useState(initial)
  const save = () => {
    if (!busy && text.trim()) onSave(text)
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-input p-3">
      <label htmlFor="knowledge-entry" className="text-sm font-medium text-foreground">
        Edit entry
      </label>
      <Textarea
        id="knowledge-entry"
        value={text}
        rows={4}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (!isSave(event)) return
          event.preventDefault()
          save()
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{ARCHIVE_HINT}</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !text.trim()}>
            {busy ? <Spinner /> : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

interface FileEditorProps {
  open: boolean
  file: string
  initial: string
  busy: boolean
  onClose: () => void
  onSave: (text: string) => void
}

/** The whole file in a pop-up, saved with `knowledge.replaceFile`. */
export function FileEditor({ open, file, initial, busy, onClose, onSave }: FileEditorProps) {
  const [text, setText] = useState(initial)
  const shown = useOverlaySlot(open, PRIORITY.confirm)
  return (
    <Popup open={open && shown} onOpenChange={(next) => !next && onClose()} label={`Edit ${file}`} description={ARCHIVE_HINT} dismissOnBackdrop={false} className="max-w-3xl">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
        <div>
          <h2 className="text-base font-semibold">Edit {file}</h2>
          <p className="text-sm text-muted-foreground">{ARCHIVE_HINT}</p>
        </div>
        <Textarea value={text} rows={14} className="min-h-0 flex-1 font-mono text-sm" onChange={(event) => setText(event.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSave(text)} disabled={busy}>
            {busy ? <Spinner /> : null}
            Save file
          </Button>
        </div>
      </div>
    </Popup>
  )
}
