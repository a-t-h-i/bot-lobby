/**
 * One Excalidraw session's detail: the room link (masked until
 * `Reveal`, then the full link with `Copy` and `Open board` in a new tab), the
 * draw state, the last check, the agent checklist, the add/create/rename boxes
 * and `Remove`. A revealed link lives in component state only — it is never
 * logged or persisted.
 */
import { useState } from "react"
import { Copy, ExternalLink, Eye, ListChecks, Loader, Pencil, PencilOff, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "@/lib/toast"
import type { ExcalidrawAgentName, ExcalidrawCheck, ExcalidrawSessionInfo } from "@protocol"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import { call } from "@/lib/api"
import { ActionBar, ActionButton } from "@/ui/Actions"
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
        className="h-8 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Button type="submit" className="h-8 self-end" disabled={required && !name.trim()}>
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

function LinkLine({ session, revealed }: { session: ExcalidrawSessionInfo; revealed?: string }) {
  return <p className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm break-all text-foreground">{revealed ?? session.masked}</p>
}

function ContributeLine({ session }: { session: ExcalidrawSessionInfo }) {
  return <p className={session.contribute ? "text-sm text-primary" : "text-sm text-muted-foreground"}>{session.contribute ? DRAW_LINE : LOOK_LINE}</p>
}

function CheckLine({ check, checking }: { check?: ExcalidrawCheck; checking: boolean }) {
  if (checking) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" aria-hidden="true" />
        {CHECKING_ROOM}
      </p>
    )
  }
  if (check) {
    return (
      <p className={check.ok ? "text-sm text-primary" : "text-sm text-foreground"}>
        {check.ok ? "✓" : "!"} {check.text}
      </p>
    )
  }
  return <p className="text-xs text-muted-foreground">{CHECK_HINT}</p>
}

function AgentRow({ agent, on, onToggle }: { agent: ExcalidrawAgentName; on: boolean; onToggle: (agent: ExcalidrawAgentName) => void }) {
  return (
    <li>
      <label className="flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-muted">
        <Checkbox checked={on} onCheckedChange={() => onToggle(agent)} />
        <span className={on ? "text-foreground" : "text-muted-foreground"}>{AGENT_LABELS[agent]}</span>
      </label>
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
      <div className="flex">
        <ActionButton label={all ? "Take every agent off" : "Assign every agent"} icon={ListChecks} onClick={() => void toggleAll()} />
      </div>
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
  const [revealed, setRevealed] = useState<string>()
  const reveal = async () => {
    try {
      setRevealed((await call("excalidraw.reveal", { id: session.id })).link)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : REVEAL_FAILED)
    }
  }
  const copy = () => void navigator.clipboard?.writeText(revealed ?? "").then(() => toast(COPIED)).catch(() => undefined)
  const toggleContribute = async () => {
    if (await act("excalidraw.toggleContribute", { id: session.id })) onChanged()
  }
  return (
    <article aria-label="Session detail" className="flex flex-col gap-4">
      <ActionBar>
        {revealed ? (
          <>
            <ActionButton label="Copy the link" text="Copy" icon={Copy} shortcut="C" onClick={copy} />
            <ActionButton label="Open board" icon={ExternalLink} tone="primary" shortcut="O" href={revealed} />
          </>
        ) : (
          <ActionButton label="Reveal the link" text="Reveal" icon={Eye} shortcut="R" onClick={() => void reveal()} />
        )}
        <ActionButton label={session.contribute ? "Look only: agents stop drawing" : "Let agents draw"} text={session.contribute ? "Look only" : "Let agents draw"} icon={session.contribute ? PencilOff : Pencil} shortcut="W" pressed={session.contribute} onClick={() => void toggleContribute()} />
        <ActionButton label="Check the room" text="Check" icon={checking ? Loader : ShieldCheck} shortcut="T" disabled={checking} onClick={onCheck} />
        <ConfirmButton
          icon={Trash2}
          label="Remove the session"
          text="Remove"
          shortcut="Delete"
          title={`Remove "${session.name}"?`}
          description="Agents lose this session at once; the Excalidraw room itself is not touched."
          confirmLabel="Remove session"
          variant="destructive"
          onConfirm={onRemove}
        />
      </ActionBar>
      <h2 className="text-lg font-semibold tracking-tight break-words">{session.name}</h2>
      <LinkLine session={session} revealed={revealed} />
      <ContributeLine session={session} />
      <CheckLine check={check} checking={checking} />
      <AgentBox session={session} onChanged={onChanged} />
      <Section title={MANAGE_TITLE}>
        <AddForms onChanged={onChanged} />
        <RenameForm session={session} onChanged={onChanged} />
      </Section>
    </article>
  )
}
