/**
 * One session's preview and controls: who and where, its task
 * and progress, the questions it waits on (answered inline), what you can do
 * with it (move it here, stop it, message it) and its conversation.
 */
import type { LobbySnapshot } from "@protocol"
import { go } from "@/app/router"
import { Button } from "@/components/ui/button"
import { act } from "@/lib/act"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Section } from "@/ui/Section"
import { Pips } from "@/ui/task-facts"
import { ChatView, RemoteChat } from "./ChatView"
import { Dialogs } from "./Dialogs"
import { WhereIcon } from "./WhereIcon"
import { NOTHING_SAID, OTHER_TERMINAL_NOTE, addressOf, emptyNote, factsLine, waitingText, type Entry } from "./words"

function TaskLine({ task }: { task: NonNullable<LobbySnapshot["task"]> }) {
  const progress = task.progress
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span className="break-all">{task.id}</span>
      {progress && progress.total > 0 ? (
        <>
          <Pips done={progress.done} total={progress.total} />
          <span className="tabular-nums">
            {progress.done}/{progress.total}
          </span>
        </>
      ) : null}
    </p>
  )
}

function Actions({ entry }: { entry: Entry }) {
  const { key } = entry
  if (entry.where === "this window") return <Button className="h-10 self-start" onClick={() => go("#/lobby")}>Back to this window</Button>
  if (!key) return null
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void act("sessions.switch", { key })}>
        Move here
      </Button>
      <ConfirmButton
        label="Stop"
        title={`Stop ${entry.name}?`}
        description="Its process ends. The task keeps its state and can be resumed in this window."
        confirmLabel="Stop session"
        variant="destructive"
        disabled={!entry.alive}
        onConfirm={() => void act("sessions.stop", { key })}
      />
    </div>
  )
}

function Conversation({ entry, lobby }: { entry: Entry; lobby?: LobbySnapshot }) {
  const address = addressOf(entry)
  if (entry.where === "this window") {
    return <ChatView entries={lobby?.chat ?? []} more={false} empty={NOTHING_SAID} />
  }
  if (!address) return <p className="text-sm text-muted-foreground">{NOTHING_SAID}</p>
  return <RemoteChat key={entry.id} address={address} empty={entry.where === "other terminal" ? "Nothing said in this session yet." : emptyNote(entry)} />
}

export function SessionDetail({ entry, lobby, onChanged }: { entry: Entry; lobby?: LobbySnapshot; onChanged: () => void }) {
  return (
    <article aria-label="Session detail" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">
          <WhereIcon where={entry.where} className="inline size-4 align-text-bottom" />
          {entry.name}
        </h3>
        <p className="text-sm text-muted-foreground">{factsLine(entry)}</p>
        {entry.task ? <TaskLine task={entry.task} /> : null}
        {entry.where !== "background" && entry.waiting > 0 ? <p className="text-sm text-foreground">{waitingText(entry.waiting)}</p> : null}
      </header>
      <Actions entry={entry} />
      {entry.where === "other terminal" ? <p className="text-sm text-muted-foreground">{OTHER_TERMINAL_NOTE}</p> : null}
      {entry.key ? <Dialogs sessionKey={entry.key} dialogs={entry.dialogs} onAnswered={onChanged} /> : null}
      <Section title="Conversation">
        <Conversation entry={entry} lobby={lobby} />
      </Section>
    </article>
  )
}
