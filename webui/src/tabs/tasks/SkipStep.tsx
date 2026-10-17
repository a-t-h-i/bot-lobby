/**
 * Skipping a plan step: a quiet Skip beside each step not yet done opens a
 * dialog that asks why, and the step is only skipped with a reason. The reason
 * stays with the step (the checklist shows it under the struck-through text)
 * and the task's oracle is told to carry on without that step.
 */
import { useId, useState } from "react"
import { SkipForward } from "lucide-react"
import { call } from "@/lib/api"
import { toast } from "@/lib/toast"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/** Longest reason the server keeps. */
const MAX_REASON = 1000

interface Props {
  taskId: string
  /** 0-based, as the plan lists it. */
  index: number
  text: string
  /** The skip went through: reread the task. */
  onSkipped: () => void
}

/** The Skip button on a step row; it shows on hover or focus with a pointer, always on touch. */
export function SkipStep({ taskId, index, text, onSkipped }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const shown = useOverlaySlot(open, PRIORITY.confirm)
  const field = useId()
  const hint = useId()
  const why = reason.trim()
  const change = (next: boolean) => {
    if (busy) return
    setOpen(next)
    setReason("")
    setError("")
  }
  const submit = async () => {
    if (!why || busy) return
    setBusy(true)
    setError("")
    try {
      toast((await call("tasks.skipStep", { taskId, step: index, text, reason: why })).notice)
      setOpen(false)
      setReason("")
      onSkipped()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work. Try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open={open && shown} onOpenChange={change}>
      <button
        type="button"
        aria-label={`Skip step ${index + 1}`}
        onClick={() => change(true)}
        className={cn(
          "step-skip -my-0.5 ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none",
          "transition-[opacity,background-color,color,scale] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.96] motion-reduce:active:scale-100",
          "max-md:h-11 max-md:px-2.5",
        )}
      >
        <SkipForward aria-hidden="true" className="size-3.5" />
        Skip
      </button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Skip step {index + 1}?</AlertDialogTitle>
          <AlertDialogDescription>
            The oracle is told to carry on without it, and your reason stays with the step in the task's history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded-md bg-muted px-2.5 py-1.5 text-sm break-words">{text}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field} className="text-sm font-medium">
            Why skip it?
          </label>
          <Textarea
            id={field}
            value={reason}
            autoFocus
            required
            maxLength={MAX_REASON}
            disabled={busy}
            aria-describedby={hint}
            aria-invalid={error ? true : undefined}
            placeholder="Already done by hand, not needed any more, out of scope…"
            className="max-h-48 min-h-20"
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <p id={hint} className="text-xs text-muted-foreground">
            A reason is required.
          </p>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="max-md:min-h-11 max-md:whitespace-normal">Cancel</AlertDialogCancel>
          <Button disabled={!why || busy} aria-busy={busy} className="max-md:min-h-11 max-md:whitespace-normal" onClick={() => void submit()}>
            {busy ? "Skipping…" : "Skip step"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
