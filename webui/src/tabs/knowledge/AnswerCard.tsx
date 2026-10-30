/**
 * "Answer from saved knowledge": after a question is asked from the composer
 * ("Ask the knowledge"), the card says what was asked and shows the answer as
 * it arrives in the Lobby chat (the oracle's reply streams in), with the saved
 * notes that share its words listed under it as sources. Save as a note keeps
 * the answer in the oracle's knowledge; the cross dismisses the card.
 */
import { useEffect, useState } from "react"
import { Plus, Sparkles, X } from "lucide-react"
import type { LobbySnapshot } from "@protocol"
import { useTopic } from "@/app/hooks"
import { KNOWLEDGE_ASKED } from "@/lib/composerBubbles"
import { act } from "@/lib/act"
import { Markdown } from "@/ui/Markdown"
import { AGENT_COLORS, type Note } from "./notes"
import { AGENT_LABELS } from "./words"

interface Asked {
  text: string
  at: number
  /** The newest chat message when the question went, so the answer is the first one after it. */
  after: number
}

/** The saved notes that share the most words with the question and answer. */
function sources(notes: readonly Note[], text: string): Note[] {
  const words = new Set(text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [])
  return notes
    .map((note) => ({ note, score: (note.text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []).filter((word) => words.has(word)).length }))
    .filter((hit) => hit.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((hit) => hit.note)
}

export function AnswerCard({ notes, onOpen, onSaved }: { notes: readonly Note[]; onOpen: (key: string) => void; onSaved: () => void }) {
  const lobby = useTopic<LobbySnapshot>("lobby").data
  const [asked, setAsked] = useState<Asked>()
  const [saved, setSaved] = useState(false)
  const last = lobby?.chat.at(-1)?.id ?? 0
  useEffect(() => {
    const onAsk = (event: Event) => {
      const text = String((event as CustomEvent<string>).detail ?? "")
      setSaved(false)
      setAsked({ text, at: Date.now(), after: last })
    }
    window.addEventListener(KNOWLEDGE_ASKED, onAsk)
    return () => window.removeEventListener(KNOWLEDGE_ASKED, onAsk)
  }, [last])
  if (!asked) return null
  const answer = lobby?.chat.find((message) => message.id > asked.after && message.role !== "you" && message.role !== "note")
  const text = answer?.text ?? lobby?.reply ?? ""
  const cited = text ? sources(notes, `${asked.text} ${text}`) : []
  const save = async () => {
    if (await act("knowledge.add", { agent: "master", file: "knowledge.md", text: `- ${text.replace(/\s+/g, " ").trim()}` })) {
      setSaved(true)
      onSaved()
    }
  }
  return (
    <section className="cs-knask" aria-label="Answer from saved knowledge" aria-live="polite">
      <div className="cs-ah">
        <Sparkles aria-hidden="true" className="size-3.5" />
        Answer from saved knowledge
        <button type="button" className="cs-knb cs-tip cs-b ml-auto" data-tip="Dismiss" aria-label="Dismiss the answer" onClick={() => setAsked(undefined)}><X aria-hidden="true" className="size-3.5" /></button>
      </div>
      <p className="cs-aq">You asked: {asked.text}</p>
      <div className="cs-aa">{text ? <Markdown text={text} /> : <span className="cs-wtx">Looking through what the agents know</span>}</div>
      {cited.length ? (
        <div className="cs-bs">
          {cited.map((note, index) => (
            <button key={note.key} type="button" className="cs-bsr" onClick={() => onOpen(note.key)}>
              <span className="cs-n">{index + 1}</span>
              <span className="cs-dot" style={{ background: AGENT_COLORS[note.agent] }} />
              <span className="cs-t">{note.text}</span>
              <span className="cs-f">{AGENT_LABELS[note.agent]} · {note.file}</span>
            </button>
          ))}
        </div>
      ) : null}
      {answer ? (
        <div className="cs-aact">
          <button type="button" className="cs-kc cs-sm cs-pri" disabled={saved} onClick={() => void save()}><Plus aria-hidden="true" className="size-3.5" />{saved ? "Saved as a note" : "Save as a note"}</button>
        </div>
      ) : null}
    </section>
  )
}
