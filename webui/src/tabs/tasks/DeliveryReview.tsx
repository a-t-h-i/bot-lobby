import { useEffect, useRef, useState } from "react"
import type { TaskDetail } from "@protocol"
import { call } from "@/lib/api"
import { selectedProject } from "@/lib/project"
import { Popup } from "@/components/ui/popup"
import { Button } from "@/components/ui/button"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { Section } from "@/ui/Section"

type Delivery = NonNullable<TaskDetail["delivery"]>
type Action = "create_pr" | "merge_main"
type RequestKind = "refresh" | "defer" | Action
interface ReviewProps { taskId: string; title: string; delivery: Delivery; onChanged: () => void }
const CONFIRM = "This merges the reviewed commit into main and pushes main, then removes the task worktree after verifying the merge. The task branch is kept."
const STATUS = { pending_approval: "Ready for your review", deferred: "Saved for later", in_progress: "Delivery in progress", successful: "Delivered", recoverable_failure: "Delivery needs attention" }

function Facts({ delivery: d, title }: { delivery: Delivery; title: string }) {
  return <div className="grid gap-2 text-sm">
    <p className="font-medium break-words">{title}</p>
    <dl className="grid gap-1 break-all text-muted-foreground">
      <div><dt className="inline">Project: </dt><dd className="inline">{d.project}</dd></div>
      <div><dt className="inline">Repository: </dt><dd className="inline">{d.repository ?? "Unavailable — refresh review"}</dd></div>
      <div><dt className="inline">Source: </dt><dd className="inline">{d.sourceBranch} · {d.sourceCommit ?? "Commit unavailable"}</dd></div>
      <div><dt className="inline">Target: </dt><dd className="inline">main{d.targetCommit ? ` · ${d.targetCommit}` : ""}</dd></div>
    </dl>
    <p>Checks: {d.verification?.checks ?? "unavailable"}</p>
    <p>{d.verification?.summary ?? "Verification unavailable. Refresh the review before delivery."}</p>
    {d.verification ? <p className="text-muted-foreground">Local completion/QA: {d.verification.localVerified ? "passed" : "not verified"} · Repository rules: {d.verification.rulesKnown ? "known" : "unavailable"}{d.verification.requiredChecks.length ? ` · Required: ${d.verification.requiredChecks.join(", ")}` : ""}</p> : null}
  </div>
}

function DeliveryAction({ action, delivery, busy, onAction }: { action: Action; delivery: Delivery; busy: boolean; onAction: (action: Action) => void }) {
  const reason = delivery.blocked[action]
  const retryCleanup = action === "merge_main" && delivery.status === "successful" && Boolean(delivery.cleanupError)
  const disabled = busy || delivery.status === "in_progress" || (delivery.status === "successful" && !retryCleanup) || Boolean(reason)
  return <div className="grid gap-1">
    <Button variant="outline" disabled={disabled} onClick={() => onAction(action)}>{action === "create_pr" ? "Create PR" : retryCleanup ? "Retry worktree cleanup" : "Merge to main"}</Button>
    <p className="text-xs text-muted-foreground">{action === "create_pr" ? "Pushes the task branch and opens a PR targeting main. Does not merge." : retryCleanup ? "Main was delivered. Removes the retained worktree after confirmation." : "Updates and pushes main, then removes the task worktree. Requires confirmation."}</p>
    {reason ? <p className="text-sm text-destructive">{reason} Refresh review after resolving this restriction, then choose the action again.</p> : null}
  </div>
}

async function sendRequest(kind: RequestKind, taskId: string, reviewId: string) {
  const body = { taskId, reviewId }
  if (kind === "refresh") return call("tasks.deliveryReview", { taskId })
  if (kind === "defer") return call("tasks.deliveryDefer", body)
  return call("tasks.deliver", { ...body, action: kind, ...(kind === "merge_main" ? { confirmMain: true } : {}) })
}

function useReviewState({ taskId, delivery }: ReviewProps) {
  const [current, setCurrent] = useState(delivery)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const project = selectedProject()
  const identity = `${project}:${taskId}`
  const scope = useRef(identity)
  scope.current = identity
  useEffect(() => { scope.current = identity; return () => { scope.current = "" } }, [identity])
  useEffect(() => { setCurrent(delivery); setConfirm(false) }, [delivery, taskId])
  return { current, setCurrent, busy, setBusy, error, setError, confirm, setConfirm, trigger, project, identity, scope }
}

type ReviewState = ReturnType<typeof useReviewState>
function isActive(state: ReviewState) {
  return state.scope.current === state.identity && state.project === selectedProject()
}

function useReviewRequest(state: ReviewState, props: ReviewProps) {
  const submitting = useRef(false)
  async function request(kind: RequestKind) {
    if (submitting.current || (kind === "merge_main" && !state.confirm)) return
    submitting.current = true
    state.setBusy(true)
    state.setError(undefined)
    state.setConfirm(false)
    try {
      const result = await sendRequest(kind, props.taskId, state.current.reviewId)
      if (isActive(state)) { state.setCurrent(result.delivery); props.onChanged() }
    } catch (error) {
      if (isActive(state)) state.setError(error instanceof Error ? error.message : String(error))
    } finally {
      submitting.current = false
      if (state.scope.current) state.setBusy(false)
    }
  }
  return request
}

function useDeliveryController(props: ReviewProps) {
  const state = useReviewState(props)
  const request = useReviewRequest(state, props)
  const slot = useOverlaySlot(state.confirm, PRIORITY.confirm)
  const terminal = state.current.status === "successful" || state.current.status === "in_progress"
  function reviewMerge() {
    state.trigger.current = document.activeElement as HTMLElement
    state.setConfirm(true)
  }
  return { ...state, request, slot, terminal, reviewMerge }
}

type Controller = ReturnType<typeof useDeliveryController>
function Status({ review: r }: { review: Controller }) {
  return <>
    <p className="mt-2 text-sm text-muted-foreground">Task completion is recorded separately. Nothing is published without your approval.</p>
    <p role="status" className="text-sm">{r.busy ? "Updating delivery…" : r.current.operation ? `Operation: ${r.current.operation.stage}` : STATUS[r.current.status]}</p>
    {r.current.error || r.error ? <p role="alert" className="text-sm text-destructive">{r.error ?? r.current.error} Completed work is retained. Refresh review to reconcile the result before retrying.</p> : null}
    {r.current.cleanupError ? <p role="alert" className="text-sm text-destructive">{r.current.cleanupError} Retry cleanup after resolving it.</p> : null}
    {r.current.operation?.worktreeRemoved ? <p className="text-sm">Task worktree removed.</p> : null}
    {r.current.result ? <p className="text-sm break-all">{r.current.result.action === "create_pr" ? `PR #${r.current.result.pullNumber ?? ""} created` : `main pushed · ${r.current.result.commit ?? ""}`}{r.current.result.pullUrl ? <span> · {r.current.result.pullUrl}</span> : null}</p> : null}
  </>
}

function Actions({ review: r }: { review: Controller }) {
  return <>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <DeliveryAction action="create_pr" delivery={r.current} busy={r.busy} onAction={() => void r.request("create_pr")} />
      <DeliveryAction action="merge_main" delivery={r.current} busy={r.busy} onAction={r.reviewMerge} />
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="ghost" disabled={r.busy} onClick={() => void r.request("refresh")}>Refresh review</Button>
      <Button variant="ghost" disabled={r.busy || r.terminal} onClick={() => void r.request("defer")}>Not now</Button>
    </div>
  </>
}

function Confirmation({ review: r }: { review: Controller }) {
  const retryCleanup = r.current.status === "successful" && Boolean(r.current.cleanupError)
  const description = retryCleanup ? "Main was already delivered. Remove the task worktree if it still contains only the reviewed commit. The task branch is kept." : CONFIRM
  return <Popup open={r.slot} onOpenChange={r.setConfirm} label={retryCleanup ? "Confirm worktree removal" : "Confirm merge to main"} description={description} onCloseAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => r.trigger.current?.focus()) }}>
    <div className="grid gap-4 p-4">
      <h3 className="font-medium">{retryCleanup ? "Remove task worktree?" : "Merge to main?"}</h3>
      <p className="text-sm">{description}</p>
      <p className="break-all text-sm text-muted-foreground">{r.current.repository} · {r.current.sourceCommit} → main</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => r.setConfirm(false)}>Cancel</Button>
        <Button disabled={r.busy || Boolean(r.current.blocked.merge_main) || (r.terminal && !retryCleanup)} onClick={() => void r.request("merge_main")}>{retryCleanup ? "Confirm worktree removal" : "Confirm merge and push main"}</Button>
      </div>
    </div>
  </Popup>
}

function Panel({ title, review }: { title: string; review: Controller }) {
  return <Section title="Completed work · delivery review" right={STATUS[review.current.status]}>
    <Facts delivery={review.current} title={title} />
    <Status review={review} />
    <Actions review={review} />
    <Confirmation review={review} />
  </Section>
}

export function DeliveryReview(props: ReviewProps) {
  const review = useDeliveryController(props)
  return <Panel title={props.title} review={review} />
}
