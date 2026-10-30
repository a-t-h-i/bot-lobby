/**
 * Previous plans: the project's planning sessions that were never saved as a
 * task (one saved as a task is flagged and leaves this list). One list, newest
 * first, the archived ones behind a check chip; the open plan slides over from
 * the right with its draft and conversation, to read, carry on, archive or
 * delete. `#/plan/previous` lists them, `#/plan/previous/<id>` opens one.
 */
import { useState } from "react"
import { Archive, ArchiveRestore, ArrowLeft, Play, Trash2 } from "lucide-react"
import type { PreviousPlanInfo } from "@protocol"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { act } from "@/lib/act"
import { formatSince } from "@/lib/format"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Markdown } from "@/ui/Markdown"
import { ListSkeleton } from "@/ui/SplitPane"
import { CheckChip, Page } from "@/ui/Page"
import { SlideOver } from "@/ui/SlideOver"
import { Section } from "@/ui/Section"
import { PanelConversation } from "./Conversation"
import { SeatNeeds } from "./Draft"

const list = () => go(tabHash("plan", "previous"))
const open = (id: string) => go(tabHash("plan", "previous", id))

/** `3h ago`, from an ISO time. */
function ago(at: string): string {
  const ms = Date.now() - Date.parse(at)
  return Number.isFinite(ms) ? formatSince(Math.max(0, ms)) : ""
}

function facts(plan: { rounds: number; updatedAt: string }, messages: number): string {
  return [`${messages} message${messages === 1 ? "" : "s"}`, `round ${plan.rounds}`, ago(plan.updatedAt)].filter(Boolean).join(" · ")
}

function Row({ plan, selected }: { plan: PreviousPlanInfo; selected: boolean }) {
  return (
    <li>
      <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help" type="button" data-row aria-current={selected ? "true" : undefined} onClick={() => open(plan.id)} className="cs-trw cs-prw">
        <span className="cs-tt1">
          <span className="cs-t">{plan.title}</span>
          <span className="cs-mt">{facts(plan, plan.messages)}</span>
        </span>
        {plan.hasDraft ? <span className="cs-bdg" data-t="acc">draft</span> : <span />}
      </button>
    </li>
  )
}

function Detail({ id, onGone }: { id: string; onGone: () => void }) {
  const read = useApiRead("planner.previousGet", { id }, ["planner"])
  const plan = read.data
  if (!plan) return read.error ? <ErrorState message={`Could not load that plan. ${read.error}`} onRetry={read.reload} /> : null
  const archived = Boolean(plan.archivedAt)
  const carryOn = async () => {
    if (await act("planner.previousOpen", { id })) go(tabHash("plan"))
  }
  const archive = async () => {
    if (await act("planner.previousArchive", { id, archived: !archived })) onGone()
  }
  const remove = async () => {
    if (await act("planner.previousDelete", { id })) onGone()
  }
  return (
    <article className="cs-dt flex flex-col" aria-label={plan.title}>
      <ActionBar className="cs-abm">
        <ActionButton label="Carry on planning" text="Carry on" icon={Play} tone="primary" shortcut="C" onClick={() => void carryOn()} />
        <ActionButton label={archived ? "Bring it back from the archive" : "Archive"} text={archived ? "Unarchive" : "Archive"} icon={archived ? ArchiveRestore : Archive} shortcut="E" onClick={() => void archive()} />
        <ConfirmButton
          icon={Trash2}
          label="Delete"
          shortcut="Delete"
          title={`Delete "${plan.title}"?`}
          description="The conversation and the draft are removed for good."
          confirmLabel="Delete plan"
          variant="destructive"
          onConfirm={() => void remove()}
        />
      </ActionBar>
      <header>
        <h2>{plan.title}</h2>
        <p className="cs-sub">
          {[archived ? "archived" : "", facts(plan, plan.messages.length), plan.seed ?? ""].filter(Boolean).join(" · ")}
        </p>
      </header>
      <Section title="Draft plan">
        {plan.draft ? <Markdown text={plan.draft} /> : <p className="text-sm text-muted-foreground">The panel had not written a draft yet.</p>}
        <SeatNeeds notes={plan.notes} />
      </Section>
      <Section title="Conversation">
        <div className="cs-pvc"><PanelConversation messages={plan.messages} readOnly /></div>
      </Section>
    </article>
  )
}

export function PreviousPlans({ id }: { id?: string }) {
  const [archived, setArchived] = useState(false)
  const read = useApiRead("planner.previous", archived ? { archived: true } : {}, ["planner"])
  const plans = read.data?.plans ?? []
  if (!read.data && read.error) return <ErrorState message={`Could not load the previous plans. ${read.error}`} onRetry={read.reload} />
  const aside = (
    <>
      <ActionButton label="Back to the current plan" text="Back" icon={ArrowLeft} onClick={() => go(tabHash("plan"))} />
      <CheckChip on={archived} label="Archived" describe={archived ? "Show the previous plans" : "Show the archived plans"} onToggle={() => { setArchived((on) => !on); list() }} />
    </>
  )
  const body = !read.data ? (
    <ListSkeleton />
  ) : plans.length === 0 ? (
    <p className="px-2.5 py-6 text-sm text-muted-foreground">
      {archived ? "No archived plans." : "No previous plans. A plan you leave without saving it as a task waits here; one saved as a task is in the Tasks tab."}
    </p>
  ) : (
    <ul className="cs-lst" aria-label={archived ? "Archived plans" : "Previous plans"}>
      {plans.map((plan) => <Row key={plan.id} plan={plan} selected={plan.id === id} />)}
    </ul>
  )
  return (
    <>
      <Page title={archived ? "Archived plans" : "Previous plans"} sub={read.data ? `${plans.length} ${plans.length === 1 ? "plan" : "plans"}` : undefined} className="cs-ts" aside={aside}>
        {body}
      </Page>
      <SlideOver open={id !== undefined} onClose={list} label="A previous plan" className="cs-tdw">
        {id ? <Detail key={id} id={id} onGone={() => { read.reload(); list() }} /> : null}
      </SlideOver>
    </>
  )
}
