/**
 * What a task waits on, at the top of its detail, with the actions that move
 * it on: Approve or Reject each waiting approval, Resume a paused task, Accept
 * as is (the oracle completes it without the missing checks, never merging) and
 * Force close (abandon it, keeping code, worktree and history). Each action
 * asks first in a dialog whose focus starts on Cancel, so Enter never acts by
 * accident; Force close also wants the task's exact title typed.
 */
import { useId, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertCircle, Check, CircleSlash, ShieldCheck, X, XCircle } from "lucide-react"
import type { TaskDetail as TaskDetailData, TaskRow } from "@protocol"
import { call } from "@/lib/api"
import { toast } from "@/lib/toast"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { Input } from "@/components/ui/input"
import { ActionButton } from "@/ui/Actions"
import { Section } from "@/ui/Section"
import { ResumeTask } from "./ResumeTask"
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

type WaitingItem = TaskDetailData["waiting"][number]

interface Props {
  row: TaskRow
  detail: TaskDetailData
  /** An action went through: reread the detail and the list. */
  onChanged: () => void
}

interface AskProps {
  label: string
  icon: LucideIcon
  tone?: "neutral" | "danger"
  title: string
  description: string
  confirmLabel: string
  /** When set, the confirm stays off until this exact text is typed. */
  typeToConfirm?: string
  /** Runs the call with what was typed; resolves to its notice. */
  run: (typed: string) => Promise<{ notice: string }>
  onDone: () => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "That did not work. Try again."
}

function useAsk({ run, onDone }: Pick<AskProps, "run" | "onDone">) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const change = (next: boolean) => {
    if (busy) return
    setOpen(next)
    setTyped("")
    setError("")
  }
  const submit = async () => {
    setBusy(true)
    setError("")
    try {
      toast((await run(typed)).notice)
      setOpen(false)
      onDone()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return { open, change, typed, setTyped, busy, error, submit }
}

function TypedTitle({ expected, value, onChange, disabled }: { expected: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Type the task's title to confirm
      </label>
      <p className="break-words rounded-md bg-muted px-2 py-1 font-mono text-xs select-all">{expected}</p>
      <Input id={id} value={value} disabled={disabled} autoComplete="off" spellCheck={false} className="max-md:min-h-11" onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

/** A button that opens a confirm dialog; failures stay in the dialog, typed text kept. */
function AskButton(props: AskProps) {
  const ask = useAsk(props)
  const shown = useOverlaySlot(ask.open, PRIORITY.confirm)
  const locked = props.typeToConfirm !== undefined && ask.typed !== props.typeToConfirm
  const tone = props.tone ?? "neutral"
  return (
    <AlertDialog open={ask.open && shown} onOpenChange={ask.change}>
      <ActionButton label={props.label} icon={props.icon} tone={tone} onClick={() => ask.change(true)} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {props.typeToConfirm !== undefined ? <TypedTitle expected={props.typeToConfirm} value={ask.typed} onChange={ask.setTyped} disabled={ask.busy} /> : null}
        {ask.error ? <p role="alert" className="text-sm text-destructive">{ask.error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={ask.busy} className="max-md:min-h-11 max-md:whitespace-normal">Cancel</AlertDialogCancel>
          <Button variant={tone === "danger" ? "destructive" : "default"} disabled={locked || ask.busy} aria-busy={ask.busy} className="max-md:min-h-11 max-md:whitespace-normal" onClick={() => void ask.submit()}>
            {ask.busy ? "Working…" : props.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ApprovalActions({ taskId, item, onDone }: { taskId: string; item: WaitingItem; onDone: () => void }) {
  const resolve = (decision: "approved" | "rejected") => () =>
    call("tasks.resolveApproval", { taskId, approvalId: item.id, decision })
  const what = `${item.kind}${item.domain ? ` for ${item.domain}` : ""}`
  return (
    <span className="flex flex-wrap gap-2">
      <AskButton label="Approve" icon={Check} title={`Approve the ${what}?`} description={`${item.detail} The task's oracle is told and carries on with it.`} confirmLabel="Approve" run={resolve("approved")} onDone={onDone} />
      <AskButton label="Reject" icon={X} tone="danger" title={`Reject the ${what}?`} description={`${item.detail} The task's oracle is told and works without it.`} confirmLabel="Reject" run={resolve("rejected")} onDone={onDone} />
    </span>
  )
}

function WaitingRow({ taskId, item, live, onDone }: { taskId: string; item: WaitingItem; live: boolean; onDone: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex min-w-0 flex-1 basis-60 gap-2">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <span className="min-w-0 break-words text-muted-foreground">
          {item.kind} {item.detail}
        </span>
      </span>
      {live && item.id ? <ApprovalActions taskId={taskId} item={item} onDone={onDone} /> : null}
    </li>
  )
}

function Blockers({ blockers }: { blockers: TaskDetailData["blockers"] }) {
  return blockers.map((blocker, index) => (
    <li key={`${index}-${blocker.reason}`} className="flex gap-2">
      <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span className="min-w-0 break-words text-muted-foreground">
        {blocker.reason} (needs: {blocker.need})
      </span>
    </li>
  ))
}

function TaskActions({ row, detail, onChanged }: { row: TaskRow; detail: TaskDetailData; onChanged: () => void }) {
  const taskId = row.id
  return (
    <div className="flex flex-wrap gap-2">
      {row.resumable ? <ResumeTask row={row} onResumed={onChanged} /> : null}
      {detail.canAccept ? (
        <AskButton label="Accept as is" icon={ShieldCheck} title={`Accept "${row.title}" as is?`} description="You accept the work unverified: missing QA and lint checks are waived on your word. The task's oracle is asked to complete it; nothing is merged." confirmLabel="Accept as is" run={() => call("tasks.accept", { taskId })} onDone={onChanged} />
      ) : null}
      {detail.canForceClose ? (
        <AskButton label="Force close" icon={CircleSlash} tone="danger" title={`Force close "${row.title}"?`} description="The task is abandoned and its running work cancelled. Its code, worktree and history are kept; it is not marked complete." confirmLabel="Force close" typeToConfirm={row.title} run={(title) => call("tasks.forceClose", { taskId, title })} onDone={onChanged} />
      ) : null}
    </div>
  )
}

/** The panel; nothing when the task waits on nothing and allows no intervention. */
export function TaskInterventions({ row, detail, onChanged }: Props) {
  const live = row.kind === "task" && row.check === "open"
  const acts = live && Boolean(row.resumable || detail.canAccept || detail.canForceClose)
  const waiting = detail.waiting
  if (waiting.length === 0 && detail.blockers.length === 0 && !acts) return null
  return (
    <Section title="Waiting on">
      <ul className="flex flex-col gap-2 text-sm">
        {waiting.map((item, index) => (
          <WaitingRow key={`${index}-${item.id || item.kind}`} taskId={row.id} item={item} live={live} onDone={onChanged} />
        ))}
        <Blockers blockers={detail.blockers} />
      </ul>
      {acts ? <TaskActions row={row} detail={detail} onChanged={onChanged} /> : null}
    </Section>
  )
}
