/**
 * The Plan tab's top: the title with its status line, the roster, and the
 * buttons the session allows — Answer questions while some wait, Retry when a
 * round can be run again, New plan, Save.
 */
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import type { PlannerSnapshot } from "@protocol"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Roster } from "./Roster"
import { seatCells, statusParts } from "./words"

function Status({ snap }: { snap: PlannerSnapshot }) {
  const parts = statusParts(snap)
  const failed = !snap.busy && parts[0]?.startsWith("✗")
  return (
    <p role="status" className={failed ? "flex items-center gap-2 text-sm text-destructive" : "flex items-center gap-2 text-sm text-muted-foreground"}>
      {snap.busy ? <Spinner className="size-3.5" aria-hidden="true" /> : null}
      {parts.join(" · ")}
    </p>
  )
}

function Actions({ snap, onDone }: { snap: PlannerSnapshot; onDone: () => void }) {
  const run = (name: "planner.answer" | "planner.retry" | "planner.save") => async () => {
    if (await act(name, {})) onDone()
  }
  return (
    <div className="flex flex-wrap gap-2">
      {snap.questions.length > 0 && !snap.busy ? <Button className="h-10" onClick={() => void run("planner.answer")()}>Answer questions</Button> : null}
      {snap.retryable ? <Button variant="outline" className="h-10" onClick={() => void run("planner.retry")()}>Retry</Button> : null}
      <Button variant="outline" className="h-10" disabled={!snap.draft || snap.busy} onClick={() => void run("planner.save")()}>
        Save
      </Button>
      <ConfirmButton
        label="New plan"
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
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-sm font-bold">Planning</h2>
          <Status snap={snap} />
        </div>
        <Actions snap={snap} onDone={onDone} />
      </div>
      <Roster cells={seatCells(snap)} intro={false} onToggled={onDone} />
    </header>
  )
}
