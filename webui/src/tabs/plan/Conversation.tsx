/**
 * The panel's conversation, in the same shape as the Lobby's: your words in a
 * bubble on the right, the panel beside its avatar, its questions as cards
 * (who asks, the question, the options, and the mockups a seat drew for them,
 * which expand into the mockup viewer), questions the classifier settled
 * marked with a tick, three dots while a round runs, and everything else as
 * Markdown.
 */
import { useState, type CSSProperties } from "react"
import { Popup } from "@/components/ui/popup"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { MockupViewer, plainLabel } from "@/prompts/MockupViewer"
import { StaticPreview } from "@/prompts/StaticPreview"
import { Button } from "@/components/ui/button"
import { InlineEditor } from "@/ui/InlineEditor"
import { call } from "@/lib/api"
import { Check, Pencil } from "lucide-react"
import type { PlannerMessage, PanelQuestion } from "@protocol"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { AgentIcon } from "@/ui/AgentIcon"
import { AgentMessage, ChatNote, TypingDots, YourMessage } from "../lobby/ChatParts"
import { sourceColor, sourceLabel, sourceTone } from "../lobby/types"

/** The page width a mockup is laid out at before it is scaled into its thumbnail. */
const MOCKUP_WIDTH = 1200

/** The mockups a question's options carry, as thumbnails; each opens the viewer, where the user scrolls through them all. */
function OptionMockups({ question }: { question: PanelQuestion }) {
  const [open, setOpen] = useState<number>()
  const shown = useOverlaySlot(open !== undefined, PRIORITY.sheet)
  const drawn = question.options.flatMap((option, index) => (option.mockup ? [{ option, index, mockup: option.mockup }] : []))
  if (drawn.length === 0) return null
  const options = question.options.map((option) => ({ label: option.label, description: option.description, ...(option.mockup ? { htmlPreview: option.mockup } : {}) }))
  return (
    <>
      <ul aria-label="Mockups" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {drawn.map(({ option, index, mockup }) => (
          <li key={index} className="flex min-w-0 flex-col gap-1">
            <StaticPreview preview={mockup} label={plainLabel(option.label)} frameWidth={MOCKUP_WIDTH} onOpen={() => setOpen(index)} className="aspect-[3/2] h-auto" />
            <span className="truncate text-xs text-muted-foreground">
              <span className="tabular-nums">{index + 1}.</span> {plainLabel(option.label)}
            </span>
          </li>
        ))}
      </ul>
      <Popup
        open={open !== undefined && shown}
        onOpenChange={(next) => { if (!next) setOpen(undefined) }}
        label={`Mockups: ${question.text}`}
        className="h-[min(92svh,60rem)] max-h-[min(92svh,60rem)] max-w-6xl"
      >
        {open !== undefined ? <MockupViewer options={options} start={open} title={question.text} onClose={() => setOpen(undefined)} /> : null}
      </Popup>
    </>
  )
}

/** The panel's questions as cards: who asks (icon, name, colour), the question, and the options to pick from. */
function Asked({ questions }: { questions: PanelQuestion[] }) {
  return (
    <ol className="mt-1 flex flex-col gap-2">
      {questions.map((question, index) => (
        <li key={index} className="card-raised flex flex-col gap-2 rounded-xl border p-3 text-sm" style={{ "--orb": sourceTone(question.from) } as CSSProperties}>
          <p className="flex items-start gap-2">
            <span className="mt-px inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--orb)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-[color-mix(in_oklab,var(--orb)_85%,var(--foreground))]">
              <AgentIcon source={question.from} className="size-3" />
              {sourceLabel(question.from)}
            </span>
            <span className="min-w-0">
              <span className="sr-only">Question {index + 1}: </span>
              {question.text}
            </span>
          </p>
          {question.options.length ? (
            <ul aria-label="Options" className="flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <li key={option.label} className="rounded-lg border border-border bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{option.label}</span>
                  {option.description ? ` — ${option.description}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <OptionMockups question={question} />
        </li>
      ))}
    </ol>
  )
}

function Decided({ message }: { message: PlannerMessage }) {
  const decided = message.decided ?? []
  if (!decided.length) return null
  return (
    <ul className="mt-1 flex flex-col gap-1.5">
      {decided.map((entry, index) => (
        <li key={index} className="flex items-start gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm">
          <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
          <span className="min-w-0">
            <span className={cn("font-medium", sourceColor(entry.from))}>{sourceLabel(entry.from)}</span> {entry.question} → <strong>{entry.answer}</strong>
            <span className="block text-xs text-muted-foreground">decided by the classifier ({entry.probability.toFixed(2)}); comment on the plan to overrule</span>
          </span>
        </li>
      ))}
    </ul>
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
  const edit = !message.settled?.length && !editing ? (
    <Button size="xs" variant="ghost" disabled={waiting} onClick={() => setEditing(true)} className="text-muted-foreground">
      <Pencil aria-hidden="true" />
      Edit
    </Button>
  ) : null
  return (
    <YourMessage time={message.at > 0 ? formatClock(message.at) : undefined} head note={current.editedAt ? "(edited)" : undefined} below={edit}>
      {editing ? <InlineEditor text={current.text} disabled={busy} onSave={save} onCancel={() => setEditing(false)} /> : <Markdown text={current.text} />}
    </YourMessage>
  )
}

function Turn({ message, index, busy }: { message: PlannerMessage; index: number; busy: boolean }) {
  if (message.role === "you") return <UserTurn message={message} index={index} busy={busy} />
  const asked = message.questions ?? []
  return (
    <AgentMessage source="PLANNER" name="Panel" time={message.at > 0 ? formatClock(message.at) : undefined} head bubble={asked.length === 0} aside={asked.length ? `${asked.length} question${asked.length === 1 ? "" : "s"}` : undefined}>
      {asked.length > 0 ? <Asked questions={asked} /> : <Markdown text={message.text} />}
      <Decided message={message} />
    </AgentMessage>
  )
}

export function PanelConversation({ messages, seed, busy = false }: { messages: PlannerMessage[]; seed?: string; busy?: boolean }) {
  return (
    <div className="chat-column" role="log" aria-label="Panel conversation">
      {seed ? <ChatNote>{seed}</ChatNote> : null}
      {messages.map((message, index) => (
        <Turn key={`${message.at}-${index}`} message={message} index={index} busy={busy} />
      ))}
      {busy ? (
        <AgentMessage source="PLANNER" name="Panel" head live aside="the panel is thinking">
          <TypingDots className="mt-1" />
        </AgentMessage>
      ) : null}
    </div>
  )
}
