import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface Props { text: string; disabled?: boolean; onSave: (text: string) => Promise<void>; onCancel: () => void }

function editorKey(event: KeyboardEvent, save: () => void, cancel: () => void) {
  if (event.nativeEvent.isComposing) return
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel() }
  if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); event.stopPropagation(); save() }
}

export function InlineEditor({ text, disabled = false, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(text)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { field.current?.focus({ preventScroll: true }); field.current?.select() }, [])
  const save = async () => {
    if (disabled || pending || !draft.trim()) return
    setPending(true); setError("")
    try { await onSave(draft.trim()); onCancel() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setPending(false) }
  }
  return <div className="flex w-full flex-col gap-2" onKeyDown={(event) => editorKey(event, () => void save(), () => { if (!pending) onCancel() })}>
    <label className="text-sm">Edit message<Textarea ref={field} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={pending} className="mt-2 max-h-[40vh] min-h-24" /></label>
    {error ? <p role="alert" className="text-sm text-destructive">Could not save. {error}</p> : null}
    <div className="flex gap-2"><Button size="sm" onClick={() => void save()} disabled={disabled || pending || !draft.trim()}>{pending ? "Saving…" : "Save"}</Button><Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button></div>
  </div>
}
