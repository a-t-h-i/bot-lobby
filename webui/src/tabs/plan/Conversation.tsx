/**
 * The panel's conversation: your words on the right, the panel's questions
 * attributed and numbered with their options, questions the classifier
 * settled marked with a tick, and everything else as Markdown.
 */
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineEditor } from "@/ui/InlineEditor"
import { call } from "@/lib/api"
import { Check } from "lucide-react"
import type { PlannerMessage, PanelQuestion } from "@protocol"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { sourceColor, sourceLabel } from "../lobby/types"

function Asked({ questions }: { questions: PanelQuestion[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {questions.map((question, index) => (
        <li key={index} className="flex flex-col gap-1 text-sm">
          <p>
            <span className="tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}. </span>
            <span className={cn("font-medium", sourceColor(question.from))}>{sourceLabel(question.from)}</span> {question.text}
          </p>
          <ul className="flex flex-col gap-0.5 pl-6 text-muted-foreground">
            {question.options.map((option) => (
              <li key={option.label} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full border border-muted-foreground/60" />
                <span>
                  {option.label}
                  {option.description ? ` — ${option.description}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

function Decided({ message }: { message: PlannerMessage }) {
  return (
    <>
      {(message.decided ?? []).map((entry, index) => (
        <p key={index} className="text-sm">
          <Check aria-hidden="true" className="mr-1 inline size-3.5 text-success" />
          <span className={cn("font-medium", sourceColor(entry.from))}>{sourceLabel(entry.from)}</span> {entry.question} → <strong>{entry.answer}</strong>{" "}
          <span className="text-muted-foreground">· decided by the classifier ({entry.probability.toFixed(2)}); comment on the plan to overrule</span>
        </p>
      ))}
    </>
  )
}

function UserTurn({ message, index, busy }: { message: PlannerMessage; index: number; busy: boolean }) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<PlannerMessage>()
  const current = saved && (saved.editedAt ?? 0) > (message.editedAt ?? 0) ? saved : message
  const waiting = busy || current !== message
  const save = async (text: string) => {
    const result = await call("planner.editMessage", { messageIndex: index, at: message.at, text })
    setSaved(result.message)
  }
  return <div className="flex flex-col items-end gap-1">
    <span className="text-xs text-muted-foreground">{message.at > 0 ? formatClock(message.at) : ""} You{current.editedAt ? " (edited)" : ""}</span>
    <div className="max-w-[85%] rounded-lg rounded-tr-lg border border-primary/15 bg-you px-4 py-2">
      {editing ? <InlineEditor text={current.text} disabled={busy} onSave={save} onCancel={() => setEditing(false)} /> : <Markdown text={current.text} />}
    </div>
    {!message.settled?.length && !editing ? <Button size="sm" variant="ghost" disabled={waiting} onClick={() => setEditing(true)}>Edit</Button> : null}
  </div>
}

function Turn({ message, index, busy }: { message: PlannerMessage; index: number; busy: boolean }) {
  const time = message.at > 0 ? formatClock(message.at) : ""
  if (message.role === "you") return <UserTurn message={message} index={index} busy={busy} />
  const asked = message.questions ?? []
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
        <span className="font-medium text-foreground">Panel</span> {time}
      </span>
      {asked.length > 0 ? <Asked questions={asked} /> : <Markdown text={message.text} />}
      <Decided message={message} />
    </div>
  )
}

export function PanelConversation({ messages, seed, busy = false }: { messages: PlannerMessage[]; seed?: string; busy?: boolean }) {
  return (
    <div className="flex flex-col gap-4" role="log" aria-label="Panel conversation">
      {seed ? <p className="text-sm text-muted-foreground">{seed}</p> : null}
      {messages.map((message, index) => (
        <Turn key={`${message.at}-${index}`} message={message} index={index} busy={busy} />
      ))}
    </div>
  )
}
