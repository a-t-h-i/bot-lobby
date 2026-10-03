/**
 * One Excalidraw session's detail: the room link (masked until
 * `Reveal`, then the full link with `Copy` and `Open board` in a new tab), the
 * draw state, the last check, the agent checklist, the add/create/rename boxes
 * and `Remove`. A revealed link lives in component state only — it is never
 * logged or persisted.
 */
import { useState } from "react"
import { Copy } from "lucide-react"
import { toast } from "@/lib/toast"
import type { ExcalidrawAgentName, ExcalidrawCheck, ExcalidrawSessionInfo } from "@protocol"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import { call } from "@/lib/api"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { NoteForm } from "@/ui/NoteForm"
import { Section } from "@/ui/Section"
import {
  ADD_BUTTON,
  ADD_HINT,
  ADD_LABEL,
  AGENT_LABELS,
  AGENT_NOTE,
  ASSIGNED_TO,
  CHECKING_ROOM,
  CHECK_HINT,
  COPIED,
  DRAW_LINE,
  EXCALIDRAW_AGENTS,
  LOOK_LINE,
  MANAGE_TITLE,
  NEW_ROOM_HINT,
  NEW_ROOM_LABEL,
  RENAME_LABEL,
  REVEAL_FAILED,
  agentCount,
} from "./words"

interface NameFormProps {
  id: string
  label: string
  hint?: string
  buttonLabel: string
  initial?: string
  required?: boolean
  onSubmit: (name: string) => Promise<boolean>
}

function NameForm({ id, label, hint, buttonLabel, initial = "", required, onSubmit }: NameFormProps) {
  const [name, setName] = useState(initial)
  const take = async () => {
    if (required && !name.trim()) return
    if (await onSubmit(name)) setName(initial)
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void take() }}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <input
        id={id}
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-card/40 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Button type="submit" className="h-10 self-end" disabled={required && !name.trim()}>
        {buttonLabel}
      </Button>
    </form>
  )
}

/** The add-by-link and new-room boxes, shared by the detail and the empty tab. */
export function AddForms({ onChanged }: { onChanged: () => void }) {
  const add = async (link: string) => {
    if (!(await act("excalidraw.add", { link }))) return false
    onChanged()
    return true
  }
  const create = async (name: string) => {
    const trimmed = name.trim()
    if (!(await act("excalidraw.create", trimmed ? { name: trimmed } : {}))) return false
    onChanged()
    return true
  }
  return (
    <>
      <NoteForm label={ADD_LABEL} hint={ADD_HINT} buttonLabel={ADD_BUTTON} onSend={add} />
      <NameForm id="new-room" label={NEW_ROOM_LABEL} hint={NEW_ROOM_HINT} buttonLabel={NEW_ROOM_LABEL} onSubmit={create} />
    </>
  )
}

function LinkBox({ session }: { session: ExcalidrawSessionInfo }) {
  const [revealed, setRevealed] = useState<string>()
  const reveal = async () => {
    try {
      setRevealed((await call("excalidraw.reveal", { id: session.id })).link)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : REVEAL_FAILED)
    }
  }
  const copy = () => void navigator.clipboard?.writeText(revealed ?? "").then(() => toast(COPIED)).catch(() => undefined)
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-sm break-all text-foreground">{revealed ?? session.masked}</p>
      <div className="flex flex-wrap gap-2">
        {revealed ? (
          <>
            <Button variant="outline" onClick={copy}>
              <Copy aria-hidden="true" />
              Copy
            </Button>
            <Button variant="outline" asChild>
              <a href={revealed} target="_blank" rel="noopener noreferrer">
                Open board
              </a>
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => void reveal()}>
            Reveal
          </Button>
        )}
      </div>
    </div>
  )
}

function ContributeLine({ session, onChanged }: { session: ExcalidrawSessionInfo; onChanged: () => void }) {
  const toggle = async () => {
    if (await act("excalidraw.toggleContribute", { id: session.id })) onChanged()
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className={session.contribute ? "text-sm text-primary" : "text-sm text-muted-foreground"}>{session.contribute ? DRAW_LINE : LOOK_LINE}</p>
      <Button variant="outline" onClick={() => void toggle()}>
        {session.contribute ? "Look only" : "Let agents draw"}
      </Button>
    </div>
  )
}

function CheckBox({ check, checking, onCheck }: { check?: ExcalidrawCheck; checking: boolean; onCheck: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={checking} onClick={onCheck}>
        {checking ? <Spinner className="size-3.5" /> : null}
        Check
      </Button>
      {checking ? (
        <p className="text-sm text-muted-foreground">{CHECKING_ROOM}</p>
      ) : check ? (
        <p className={check.ok ? "text-sm text-primary" : "text-sm text-foreground"}>
          {check.ok ? "✓" : "!"} {check.text}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{CHECK_HINT}</p>
      )}
    </div>
  )
}

function AgentRow({ agent, on, onToggle }: { agent: ExcalidrawAgentName; on: boolean; onToggle: (agent: ExcalidrawAgentName) => void }) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        onClick={() => onToggle(agent)}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <span aria-hidden="true" className={on ? "text-primary" : "text-muted-foreground"}>{on ? "[x]" : "[ ]"}</span>
        <span className={on ? "text-foreground" : "text-muted-foreground"}>{AGENT_LABELS[agent]}</span>
      </button>
    </li>
  )
}

function AgentBox({ session, onChanged }: { session: ExcalidrawSessionInfo; onChanged: () => void }) {
  const toggle = async (agent: ExcalidrawAgentName) => {
    if (await act("excalidraw.toggleAgent", { id: session.id, agent })) onChanged()
  }
  const toggleAll = async () => {
    if (await act("excalidraw.toggleAll", { id: session.id })) onChanged()
  }
  const all = session.agents.length === EXCALIDRAW_AGENTS.length
  return (
    <Section title={ASSIGNED_TO} right={agentCount(session.agents.length)}>
      <ul className="flex flex-col gap-0.5">
        {EXCALIDRAW_AGENTS.map((agent) => (
          <AgentRow key={agent} agent={agent} on={session.agents.includes(agent)} onToggle={toggle} />
        ))}
      </ul>
      <Button variant="ghost" className="h-10 self-start" onClick={() => void toggleAll()}>
        {all ? "No agents" : "Every agent"}
      </Button>
      <p className="text-xs text-muted-foreground">{AGENT_NOTE}</p>
    </Section>
  )
}

function RenameForm({ session, onChanged }: { session: ExcalidrawSessionInfo; onChanged: () => void }) {
  const rename = async (name: string) => {
    if (!(await act("excalidraw.rename", { id: session.id, name: name.trim() }))) return false
    onChanged()
    return true
  }
  return <NameForm key={session.name} id="rename-room" label={RENAME_LABEL} initial={session.name} required buttonLabel={RENAME_LABEL} onSubmit={rename} />
}

interface SessionDetailProps {
  session: ExcalidrawSessionInfo
  check?: ExcalidrawCheck
  checking: boolean
  onCheck: () => void
  onChanged: () => void
  onRemove: () => void
}

export function SessionDetail({ session, check, checking, onCheck, onChanged, onRemove }: SessionDetailProps) {
  return (
    <article aria-label="Session detail" className="flex flex-col gap-4">
      <h2 className="text-sm font-bold break-words">{session.name}</h2>
      <LinkBox session={session} />
      <ContributeLine session={session} onChanged={onChanged} />
      <CheckBox check={check} checking={checking} onCheck={onCheck} />
      <AgentBox session={session} onChanged={onChanged} />
      <Section title={MANAGE_TITLE}>
        <AddForms onChanged={onChanged} />
        <RenameForm session={session} onChanged={onChanged} />
      </Section>
      <div>
        <ConfirmButton
          label="Remove"
          title={`Remove "${session.name}"?`}
          description="Agents lose this session at once; the Excalidraw room itself is not touched."
          confirmLabel="Remove session"
          variant="destructive"
          onConfirm={onRemove}
        />
      </div>
    </article>
  )
}
