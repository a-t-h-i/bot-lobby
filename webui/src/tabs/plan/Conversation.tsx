/**
 * The panel's conversation: your words on the right, the panel's questions
 * attributed and numbered with their options, questions the classifier
 * settled marked with a tick, and everything else as Markdown.
 */
import { Check } from "lucide-react"
import type { PlannerMessage, PanelQuestion } from "@protocol"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { sourceColor } from "../lobby/types"

function Asked({ questions }: { questions: PanelQuestion[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {questions.map((question, index) => (
        <li key={index} className="flex flex-col gap-1 text-sm">
          <p>
            <span className="tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}. </span>
            <span className={cn("font-medium", sourceColor(question.from))}>{question.from}</span> {question.text}
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
          <span className={cn("font-medium", sourceColor(entry.from))}>[{entry.from}]</span> {entry.question} → <strong>{entry.answer}</strong>{" "}
          <span className="text-muted-foreground">· decided by the classifier ({entry.probability.toFixed(2)}); comment on the plan to overrule</span>
        </p>
      ))}
    </>
  )
}

function Turn({ message }: { message: PlannerMessage }) {
  const time = message.at > 0 ? formatClock(message.at) : ""
  if (message.role === "you") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">
          {time} You
        </span>
        <div className="max-w-[85%] rounded-md rounded-tr-md border border-primary/15 bg-you px-4 py-2">
          <Markdown text={message.text} />
        </div>
      </div>
    )
  }
  const asked = message.questions ?? []
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
        <span className="font-semibold text-foreground">Panel</span> {time}
      </span>
      {asked.length > 0 ? <Asked questions={asked} /> : <Markdown text={message.text} />}
      <Decided message={message} />
    </div>
  )
}

export function PanelConversation({ messages, seed }: { messages: PlannerMessage[]; seed?: string }) {
  return (
    <div className="flex flex-col gap-4" role="log" aria-label="Panel conversation">
      {seed ? <p className="text-sm text-muted-foreground">{seed}</p> : null}
      {messages.map((message, index) => (
        <Turn key={`${message.at}-${index}`} message={message} />
      ))}
    </div>
  )
}
