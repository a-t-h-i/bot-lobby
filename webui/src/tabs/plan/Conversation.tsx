/**
 * The panel's conversation: your words on the right, the panel's questions
 * attributed and numbered with their options, questions the classifier
 * settled marked with ✓, and everything else as Markdown.
 */
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
              <li key={option.label}>
                ○ {option.label}
                {option.description ? ` — ${option.description}` : ""}
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
          <span aria-hidden="true">✓ </span>
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
          {time} You ●
        </span>
        <div className="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2">
          <Markdown text={message.text} />
        </div>
      </div>
    )
  }
  const asked = message.questions ?? []
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">◆ Panel {time}</span>
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
