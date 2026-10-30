/**
 * The panel's conversation, in the same shape as the Lobby's: your words in a
 * bubble on the right, the panel by name, its questions inline under a rule in
 * the asker's colour (who asks, the question, the options, and the mockups a
 * seat drew for them, which expand into the mockup viewer), questions the classifier settled
 * marked with a tick, the panel's name shimmering while a round runs, and everything else as
 * Markdown.
 */
import { useState, type CSSProperties } from "react"
import { Popup } from "@/components/ui/popup"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { MockupViewer, plainLabel } from "@/prompts/MockupViewer"
import { StaticPreview } from "@/prompts/StaticPreview"
import { InlineEditor } from "@/ui/InlineEditor"
import { call } from "@/lib/api"
import { Check, Pencil } from "lucide-react"
import type { PlannerMessage, PanelQuestion } from "@protocol"
import { formatClock } from "@/lib/format"
import { Markdown } from "@/ui/Markdown"
import { agentColor } from "@/ui/AgentIcon"
import { AgentMessage, ChatNote, YourMessage } from "../lobby/ChatParts"
import { sourceLabel } from "../lobby/types"

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
      <ul aria-label="Mockups" className="cs-mocks">
        {drawn.map(({ option, index, mockup }) => (
          <li key={index} className="flex min-w-0 flex-col gap-1">
            <StaticPreview preview={mockup} label={plainLabel(option.label)} frameWidth={MOCKUP_WIDTH} onOpen={() => setOpen(index)} className="cs-mk3f aspect-[3/2] h-auto" />
            <span className="truncate">
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

/** The panel's questions inline: a rule in the asker's colour, who asks and the question, the options as dotted-underline words. */
function Asked({ questions }: { questions: PanelQuestion[] }) {
  return (
    <ol className="cs-qs">
      {questions.map((question, index) => (
        <li key={index} className="cs-qc" style={{ "--ac": agentColor(question.from) } as CSSProperties}>
          <p className="cs-qh">
            <span className="cs-qwho">
              {sourceLabel(question.from)}
            </span>
            <span className="min-w-0">
              <span className="sr-only">Question {index + 1}: </span>
              {question.text}
            </span>
          </p>
          {question.options.length ? (
            <ul aria-label="Options" className="cs-opts">
              {question.options.map((option) => (
                <li key={option.label} className="cs-op">
                  <b>{option.label}</b>
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
    <ul aria-label="Settled for you" className="cs-decided">
      {decided.map((entry, index) => (
        <li key={index} title={`Settled by the classifier, ${Math.round(entry.probability * 100)}% sure. Comment on the plan to overrule it.`}>
          <Check aria-hidden="true" className="size-3.5" />
          <span className="min-w-0">
            <b className="font-semibold" style={{ color: agentColor(entry.from) }}>{sourceLabel(entry.from)}</b> <span className="text-muted-foreground">{entry.question}</span> <b className="font-semibold">{entry.answer}</b>
            <span className="cs-dh2">
              auto · {Math.round(entry.probability * 100)}% · comment to overrule
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function UserTurn({ message, index, busy, readOnly }: { message: PlannerMessage; index: number; busy: boolean; readOnly: boolean }) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<PlannerMessage>()
  const current = saved && (saved.editedAt ?? 0) > (message.editedAt ?? 0) ? saved : message
  const waiting = busy || current !== message
  const save = async (text: string) => {
    const result = await call("planner.editMessage", { messageIndex: index, at: message.at, text })
    setSaved(result.message)
  }
  // A quiet word beside the time, shown with it when the message is pointed at or focused.
  const edit = !readOnly && !message.settled?.length && !editing ? (
    <button type="button" disabled={waiting} onClick={() => setEditing(true)} className="chat-action">
      <Pencil aria-hidden="true" className="size-3" />
      Edit
    </button>
  ) : null
  return (
    <YourMessage time={message.at > 0 ? formatClock(message.at) : undefined} head note={current.editedAt ? "(edited)" : undefined} actions={edit}>
      {editing ? <InlineEditor text={current.text} disabled={busy} onSave={save} onCancel={() => setEditing(false)} /> : <Markdown text={current.text} />}
    </YourMessage>
  )
}

function Turn({ message, index, busy, readOnly }: { message: PlannerMessage; index: number; busy: boolean; readOnly: boolean }) {
  if (message.role === "you") return <UserTurn message={message} index={index} busy={busy} readOnly={readOnly} />
  const asked = message.questions ?? []
  return (
    <AgentMessage tile source="PLANNER" name="Panel" time={message.at > 0 ? formatClock(message.at) : undefined} head bubble={asked.length === 0} aside={asked.length ? `${asked.length} question${asked.length === 1 ? "" : "s"}` : undefined}>
      {asked.length > 0 ? <Asked questions={asked} /> : <Markdown text={message.text} />}
      <Decided message={message} />
    </AgentMessage>
  )
}

/** The panel's conversation; `readOnly` (a previous plan) offers no edits. */
export function PanelConversation({ messages, seed, busy = false, readOnly = false }: { messages: PlannerMessage[]; seed?: string; busy?: boolean; readOnly?: boolean }) {
  return (
    <div className="chat-column" role="log" aria-label="Panel conversation">
      {seed ? <ChatNote>{seed}</ChatNote> : null}
      {messages.map((message, index) => (
        <Turn key={`${message.at}-${index}`} message={message} index={index} busy={busy} readOnly={readOnly} />
      ))}
      {busy ? (
        <AgentMessage tile source="PLANNER" name="Panel" head live waiting aside="the panel is thinking" />
      ) : null}
    </div>
  )
}
