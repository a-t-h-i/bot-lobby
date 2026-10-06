/**
 * Previous plans: the project's planning sessions that were never saved as a
 * task (one saved as a task is flagged and leaves this list). The list on the
 * left, newest first, the archived ones behind a toggle; the open plan on the
 * right with its draft and conversation, to read, carry on, archive or
 * delete. `#/plan/previous` lists them, `#/plan/previous/<id>` opens one.
 */
import { useState } from "react"
import { Archive, ArchiveRestore, ArrowLeft, History, Play, Trash2 } from "lucide-react"
import type { PreviousPlanInfo } from "@protocol"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Badge } from "@/components/ui/badge"
import { act } from "@/lib/act"
import { formatSince } from "@/lib/format"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Markdown } from "@/ui/Markdown"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { ROW, ROWS } from "@/ui/rows"
import { Section } from "@/ui/Section"
import { cn } from "@/lib/utils"
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
      <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help" type="button" data-row aria-current={selected ? "true" : undefined} onClick={() => open(plan.id)} className={ROW}>
        <span className="flex items-center gap-2 text-sm">
          <span className={cn("min-w-0 flex-1 break-words text-foreground", selected && "font-medium")}>{plan.title}</span>
          {plan.hasDraft ? <Badge variant="secondary">draft</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">{facts(plan, plan.messages)}</span>
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
    <article className="flex flex-col gap-5" aria-label={plan.title}>
      <ActionBar>
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
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{plan.title}</h2>
        <p className="text-sm text-muted-foreground">
          {[archived ? "archived" : "", facts(plan, plan.messages.length), plan.seed ?? ""].filter(Boolean).join(" · ")}
        </p>
      </header>
      <Section title="Draft plan">
        {plan.draft ? <Markdown text={plan.draft} /> : <p className="text-sm text-muted-foreground">The panel had not written a draft yet.</p>}
        <SeatNeeds notes={plan.notes} />
      </Section>
      <Section title="Conversation">
        <PanelConversation messages={plan.messages} readOnly />
      </Section>
    </article>
  )
}

export function PreviousPlans({ id }: { id?: string }) {
  const wide = useWide()
  const [archived, setArchived] = useState(false)
  const read = useApiRead("planner.previous", archived ? { archived: true } : {}, ["planner"])
  const plans = read.data?.plans ?? []
  if (!read.data && read.error) return <ErrorState message={`Could not load the previous plans. ${read.error}`} onRetry={read.reload} />
  const header = (
    <PaneHeader title={archived ? "Archived plans" : "Previous plans"} count={read.data ? String(plans.length) : undefined}>
      <ActionButton label="Back to the current plan" icon={ArrowLeft} iconOnly onClick={() => go(tabHash("plan"))} />
      <ActionButton label={archived ? "Show the previous plans" : "Show the archived plans"} text={archived ? "Previous" : "Archived"} icon={archived ? History : Archive} pressed={archived} onClick={() => { setArchived((on) => !on); list() }} />
    </PaneHeader>
  )
  const body = !read.data ? (
    <ListSkeleton />
  ) : plans.length === 0 ? (
    <p className="px-4 py-6 text-sm text-muted-foreground">
      {archived ? "No archived plans." : "No previous plans. A plan you leave without saving it as a task waits here; one saved as a task is in the Tasks tab."}
    </p>
  ) : (
    <ul className={cn(ROWS, "pt-2")} aria-label={archived ? "Archived plans" : "Previous plans"}>
      {plans.map((plan) => <Row key={plan.id} plan={plan} selected={plan.id === id} />)}
    </ul>
  )
  return (
    <SplitPane
      wide={wide}
      list={<>{header}{body}</>}
      detail={id ? <Detail key={id} id={id} onGone={() => { read.reload(); list() }} /> : null}
      open={id !== undefined}
      onClose={list}
      hint="Pick a plan to read it, carry it on, archive it or delete it."
      describe="A previous plan"
    />
  )
}
