/**
 * The Plan tab's top: the title with its status line, the roster, and the
 * buttons the session allows — Answer questions while some wait, Retry when a
 * round can be run again, New plan, Save. When the header is wide enough the
 * roster sits on the buttons' row; otherwise it drops to a row of its own.
 */
import { FilePlus, History, MessageCircleQuestion, RotateCw, Save } from "lucide-react"
import { go, tabHash } from "@/app/router"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import type { PlannerSnapshot, StatusInfo } from "@protocol"
import { useTopic } from "@/app/hooks"
import { ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Roster } from "./Roster"
import { failure, seatCells, statusParts } from "./words"

function Status({ snap }: { snap: PlannerSnapshot }) {
  const parts = statusParts(snap)
  const failed = !snap.busy && failure(snap) !== undefined
  return (
    <p role="status" className={failed ? "flex items-center gap-2 text-sm text-destructive" : "flex items-center gap-2 text-sm text-muted-foreground"}>
      {snap.busy ? <Spinner className="size-3.5" aria-hidden="true" /> : null}
      {parts.join(" · ")}
    </p>
  )
}

/** To the plans left behind without being saved as a task. */
export function PreviousButton() {
  return <ActionButton label="Previous plans" text="Previous" icon={History} shortcut="H" onClick={() => go(tabHash("plan", "previous"))} />
}

function Actions({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  const shortcut = useTopic<StatusInfo>("status").data?.keys.find((key) => key.action === "savePlan")?.label
  const run = (name: "planner.answer" | "planner.retry" | "planner.save") => async () => {
    if (await act(name, {})) onDone()
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {snap.questions.length > 0 && !snap.busy ? <ActionButton label="Answer questions" icon={MessageCircleQuestion} tone="primary" shortcut="A" onClick={() => void run("planner.answer")()} /> : null}
      {snap.retryable ? <ActionButton label="Retry" icon={RotateCw} shortcut="R" onClick={() => void run("planner.retry")()} /> : null}
      <PreviousButton />
      <ActionButton data-plan-save label="Save the plan" text="Save" icon={Save} shortcut={shortcut ?? "Ctrl+S"} disabled={!snap.draft || snap.busy} onClick={() => void run("planner.save")()} />
      <ConfirmButton
        icon={FilePlus}
        label="New plan"
        shortcut="N"
        title="Start a new plan?"
        description="The conversation and the draft are left behind. Saved plans are not touched."
        confirmLabel="New plan"
        onConfirm={() => void act("planner.new", {}).then(onDone)}
      />
    </div>
  )
}

export function PlanHeader({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  return (
    <header className="@container shrink-0 border-b border-border px-5 py-3 max-md:shrink max-md:px-4 max-md:py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 @min-[84rem]:flex-nowrap">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg font-semibold tracking-tight">Planning</h2>
          <Status snap={snap} />
        </div>
        <Roster cells={seatCells(snap)} intro={false} onToggled={onDone} className="order-last basis-full @min-[84rem]:order-none @min-[84rem]:min-w-0 @min-[84rem]:flex-1 @min-[84rem]:basis-auto @min-[84rem]:justify-end" />
        <Actions snap={snap} onDone={onDone} />
      </div>
    </header>
  )
}
