import { useEffect, useRef, useState } from "react"
import type { TaskDetail } from "@protocol"
import { call } from "@/lib/api"
import { selectedProject } from "@/lib/project"
import { Popup } from "@/components/ui/popup"
import { Button } from "@/components/ui/button"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { Section } from "@/ui/Section"
import { tip } from "@/ui/TipLayer"
import { AlertCircle, RefreshCw } from "lucide-react"

type Delivery = NonNullable<TaskDetail["delivery"]>
type Action = "create_pr" | "merge_main"
type RequestKind = "refresh" | "defer" | Action
interface ReviewProps { taskId: string; title: string; delivery: Delivery; onChanged: () => void }
const CONFIRM = "This merges the reviewed commit into main and pushes main, then removes the task worktree after verifying the merge. The task branch is kept."
const STATUS = { pending_approval: "Ready for your review", deferred: "Saved for later", in_progress: "Delivery in progress", successful: "Delivered", recoverable_failure: "Delivery needs attention" }

const CHECK_WORDS: Record<NonNullable<Delivery["verification"]>["checks"], string> = { passing: "passing", failing: "failing", pending: "pending", absent: "none", unavailable: "unavailable", stale: "out of date" }

/** Only the facts that are known: nothing reads "unavailable"; what is missing shows as a problem below instead. */
function Facts({ delivery: d, title, state }: { delivery: Delivery; title: string; state: string }) {
  const v = d.verification
  return <div className="cs-dlv">
    <p className="cs-dlvt"><span>{title}</span><span role="status" className="cs-dlvst">{state}</span></p>
    <dl>
      <div><dt>Branch</dt><dd>{d.sourceBranch} → main</dd></div>
      {d.sourceCommit ? <div><dt>Commit</dt><dd>{d.sourceCommit}{d.targetCommit ? ` onto ${d.targetCommit}` : ""}</dd></div> : null}
      {d.repository ? <div><dt>Repository</dt><dd>{d.repository}</dd></div> : null}
      {v ? <div><dt>Checks</dt><dd title={v.summary}>{CHECK_WORDS[v.checks]} · local QA {v.localVerified ? "passed" : "not verified"}{v.requiredChecks.length ? ` · needs ${v.requiredChecks.join(", ")}` : ""}</dd></div> : null}
    </dl>
  </div>
}

/** Every distinct problem once: the same sentence from the error and both blocked actions collapses into one line. */
function problems(d: Delivery, local?: string): string[] {
  const all = [local ?? d.error, d.cleanupError, d.blocked.create_pr, d.blocked.merge_main].filter((text): text is string => Boolean(text))
  return [...new Set(all.map((text) => text.trim()))]
}

/** An action that can run right now; a blocked or finished one is left out, not greyed. */
function available(action: Action, d: Delivery): boolean {
  if (d.blocked[action] || d.status === "in_progress") return false
  if (d.status === "successful") return action === "merge_main" && Boolean(d.cleanupError)
  return true
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
  const d = r.current
  const issues = problems(d, r.error)
  return <>
    {issues.length ? <ul role="alert" className="cs-dlvp">{issues.map((text) => <li key={text}><AlertCircle aria-hidden="true" />{text}</li>)}</ul> : null}
    {d.result ? <p className="cs-dlvs break-all">{d.result.action === "create_pr" ? `PR #${d.result.pullNumber ?? ""} created` : `main pushed · ${d.result.commit ?? ""}`}{d.result.pullUrl ? <> · <a href={d.result.pullUrl} target="_blank" rel="noreferrer">{d.result.pullUrl}</a></> : null}{d.operation?.worktreeRemoved ? " · worktree removed" : ""}</p> : null}
  </>
}

function Actions({ review: r }: { review: Controller }) {
  const d = r.current
  const retryCleanup = d.status === "successful" && Boolean(d.cleanupError)
  return <div className="cs-dlva">
    {available("create_pr", d) ? <Button variant="outline" size="sm" disabled={r.busy} onClick={() => void r.request("create_pr")} {...tip("Pushes the task branch and opens a PR to main. Does not merge.")}>Create PR</Button> : null}
    {available("merge_main", d) ? <Button variant="outline" size="sm" disabled={r.busy} onClick={r.reviewMerge} {...tip(retryCleanup ? "Removes the kept worktree. Asks first." : "Merges into main, pushes, then removes the worktree. Asks first.")}>{retryCleanup ? "Retry worktree cleanup" : "Merge to main"}</Button> : null}
    <Button variant="ghost" size="sm" disabled={r.busy} onClick={() => void r.request("refresh")}><RefreshCw aria-hidden="true" />Refresh</Button>
    {r.terminal ? null : <Button variant="ghost" size="sm" disabled={r.busy} onClick={() => void r.request("defer")}>Not now</Button>}
  </div>
}

function Confirmation({ review: r }: { review: Controller }) {
  const retryCleanup = r.current.status === "successful" && Boolean(r.current.cleanupError)
  const description = retryCleanup ? "Main was already delivered. Remove the task worktree if it still contains only the reviewed commit. The task branch is kept." : CONFIRM
  return <Popup open={r.slot} onOpenChange={r.setConfirm} label={retryCleanup ? "Confirm worktree removal" : "Confirm merge to main"} description={description} onCloseAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => r.trigger.current?.focus()) }}>
    <div className="grid gap-3 p-4">
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
  const d = review.current
  const blocked = d.status === "pending_approval" && problems(d, review.error).length > 0
  const state = review.busy ? "Updating…" : d.operation && d.status === "in_progress" ? d.operation.stage : blocked ? "Needs a fix first" : STATUS[d.status]
  return <Section title="Delivery">
    <div className="cs-sunkbox grid gap-3">
      <Facts delivery={review.current} title={title} state={state} />
      <Status review={review} />
      <Actions review={review} />
    </div>
    <Confirmation review={review} />
  </Section>
}

export function DeliveryReview(props: ReviewProps) {
  const review = useDeliveryController(props)
  return <Panel title={props.title} review={review} />
}
