/**
 * One Excalidraw session's detail, laid out in cards: the session's name with
 * its state at a glance (draw or look only, agents, last check), then the room
 * link (masked until `Reveal`, then `Copy` and `Open board` in a new tab) and
 * the room's state beside the agents assigned to it, and last the boxes to
 * rename it or add another. A revealed link lives in component state only: it
 * is never logged or persisted. The cards, the steps and the add boxes are
 * shared with the overview and the empty page.
 */
import { useId, useState, type ReactNode } from "react"
import { CircleAlert, CircleCheck, CircleDashed, Copy, ExternalLink, Eye, ListChecks, Loader, Pencil, PencilOff, Plus, ShieldCheck, Trash2, Users } from "lucide-react"
import { toast } from "@/lib/toast"
import type { ExcalidrawAgentName, ExcalidrawCheck, ExcalidrawSessionInfo } from "@protocol"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import { call } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
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
  DRAWING,
  DRAW_BADGE,
  DRAW_LINE,
  EXCALIDRAW_AGENTS,
  LAST_CHECK,
  LINK_NOTE,
  LINK_PLACEHOLDER,
  LINK_TITLE,
  LOOK_BADGE,
  LOOK_LINE,
  MANAGE_TITLE,
  NAME_PLACEHOLDER,
  NEW_ROOM_HINT,
  NEW_ROOM_LABEL,
  NOT_CHECKED,
  RENAME_LABEL,
  REVEAL_FAILED,
  ROOM_TITLE,
  STEPS,
  agentCount,
} from "./words"

/** A titled card on the page's surface. */
export function Card({ title, right, className, children }: { title: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4", className)}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {right ? <span className="text-xs text-muted-foreground tabular-nums">{right}</span> : null}
      </header>
      {children}
    </section>
  )
}

/** The three steps, numbered: in a row when there is room, one under another when not. */
export function Steps({ row = false }: { row?: boolean }) {
  return (
    <ol className={cn("grid gap-3", row && "@2xl:grid-cols-3")}>
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex gap-3 rounded-xl border border-border bg-card p-3.5">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-primary tabular-nums">
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{step.title}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

interface FieldFormProps {
  label: string
  hint?: string
  buttonLabel: string
  placeholder?: string
  initial?: string
  /** An empty box sends nothing. */
  required?: boolean
  mono?: boolean
  /** The page's main thing to do (the add boxes before any session): an accent button. */
  primary?: boolean
  onSubmit: (value: string) => Promise<boolean>
}

/** One labelled line and its button; Enter in the line sends it, and nothing else does. */
function FieldForm({ label, hint, buttonLabel, placeholder, initial = "", required, mono, primary, onSubmit }: FieldFormProps) {
  const id = useId()
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const empty = required && !value.trim()
  const take = async () => {
    if (empty || busy) return
    setBusy(true)
    if (await onSubmit(value)) setValue(initial)
    setBusy(false)
  }
  return (
    <form className="flex min-w-0 flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void take() }}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          maxLength={mono ? 2000 : 80}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => setValue(event.target.value)}
          className={cn(
            "h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
            mono && "font-mono text-[0.8125rem]"
          )}
        />
        <ActionButton type="submit" label={buttonLabel} icon={busy ? Loader : Plus} tone={primary ? "primary" : "neutral"} shortcut="Enter" disabled={empty || busy} className={busy ? "[&_svg]:animate-spin" : undefined} />
      </div>
      {hint ? <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </form>
  )
}

function LinkForm({ onChanged, primary }: { onChanged: () => void; primary?: boolean }) {
  const add = async (link: string) => {
    if (!(await act("excalidraw.add", { link: link.trim() }))) return false
    onChanged()
    return true
  }
  return <FieldForm label={ADD_LABEL} hint={ADD_HINT} buttonLabel={ADD_BUTTON} placeholder={LINK_PLACEHOLDER} required mono primary={primary} onSubmit={add} />
}

function NewRoomForm({ onChanged, primary }: { onChanged: () => void; primary?: boolean }) {
  const create = async (name: string) => {
    const trimmed = name.trim()
    if (!(await act("excalidraw.create", trimmed ? { name: trimmed } : {}))) return false
    onChanged()
    return true
  }
  return <FieldForm label={NEW_ROOM_LABEL} hint={NEW_ROOM_HINT} buttonLabel="Create" placeholder={NAME_PLACEHOLDER} primary={primary} onSubmit={create} />
}

/** The add-by-link and new-room boxes, side by side when there is room. */
export function AddForms({ onChanged, stacked = false }: { onChanged: () => void; stacked?: boolean }) {
  return (
    <div className={cn("grid gap-4", !stacked && "@2xl:grid-cols-2")}>
      <LinkForm onChanged={onChanged} primary />
      <NewRoomForm onChanged={onChanged} primary />
    </div>
  )
}

function RenameForm({ session, onChanged }: { session: ExcalidrawSessionInfo; onChanged: () => void }) {
  const rename = async (name: string) => {
    if (!(await act("excalidraw.rename", { id: session.id, name: name.trim() }))) return false
    onChanged()
    return true
  }
  return <FieldForm key={session.name} label={RENAME_LABEL} initial={session.name} required buttonLabel={RENAME_LABEL} onSubmit={rename} />
}

/** A small fact about the session: an icon and a word, in a tone. */
function Fact({ icon: Icon, tone = "muted", children }: { icon: typeof Users; tone?: "primary" | "muted" | "warning"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        tone === "primary" ? "bg-accent text-primary" : tone === "warning" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </span>
  )
}

function CheckFact({ check, checking }: { check?: ExcalidrawCheck; checking: boolean }) {
  if (checking) return <Fact icon={Loader}>{CHECKING_ROOM}</Fact>
  if (!check) return <Fact icon={CircleDashed}>{NOT_CHECKED}</Fact>
  return check.ok ? <Fact icon={CircleCheck} tone="primary">reachable</Fact> : <Fact icon={CircleAlert} tone="warning">unreachable</Fact>
}

/** One labelled line of the Room card. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-3 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function CheckLine({ check, checking }: { check?: ExcalidrawCheck; checking: boolean }) {
  if (checking) {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Spinner className="size-3.5" aria-hidden="true" />
        {CHECKING_ROOM}
      </span>
    )
  }
  if (check) return <span className={check.ok ? "text-primary" : "text-foreground"}>{check.ok ? "✓" : "!"} {check.text}</span>
  return <span className="text-muted-foreground">{CHECK_HINT}</span>
}

function AgentChip({ agent, on, onToggle }: { agent: ExcalidrawAgentName; on: boolean; onToggle: (agent: ExcalidrawAgentName) => void }) {
  return (
    <li>
      <label
        className={cn(
          "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 text-sm transition-[background-color,border-color,color]",
          on ? "border-primary/25 bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Checkbox checked={on} onCheckedChange={() => onToggle(agent)} />
        <span className="truncate">{AGENT_LABELS[agent]}</span>
      </label>
    </li>
  )
}

function AgentCard({ session, onChanged }: { session: ExcalidrawSessionInfo; onChanged: () => void }) {
  const toggle = async (agent: ExcalidrawAgentName) => {
    if (await act("excalidraw.toggleAgent", { id: session.id, agent })) onChanged()
  }
  const toggleAll = async () => {
    if (await act("excalidraw.toggleAll", { id: session.id })) onChanged()
  }
  const all = session.agents.length === EXCALIDRAW_AGENTS.length
  return (
    <Card title={ASSIGNED_TO} right={agentCount(session.agents.length)}>
      <ul className="grid grid-cols-1 gap-1.5 @md:grid-cols-2">
        {EXCALIDRAW_AGENTS.map((agent) => (
          <AgentChip key={agent} agent={agent} on={session.agents.includes(agent)} onToggle={toggle} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{AGENT_NOTE}</p>
        <ActionButton label={all ? "Take every agent off" : "Assign every agent"} icon={ListChecks} onClick={() => void toggleAll()} />
      </div>
    </Card>
  )
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
    <article aria-label="Session detail" className="@container flex flex-col gap-4">
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
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight break-words">{session.name}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Fact icon={session.contribute ? Pencil : Eye} tone={session.contribute ? "primary" : "muted"}>{session.contribute ? DRAW_BADGE : LOOK_BADGE}</Fact>
          <Fact icon={Users}>{agentCount(session.agents.length)}</Fact>
          <CheckFact check={check} checking={checking} />
        </div>
      </header>
      <div className="grid gap-4 @3xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={LINK_TITLE}>
            <p className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[0.8125rem] break-all text-foreground">{revealed ?? session.masked}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{LINK_NOTE}</p>
          </Card>
          <Card title={ROOM_TITLE}>
            <dl className="flex flex-col gap-2">
              <Line label={DRAWING}>
                <span className={session.contribute ? "text-primary" : "text-muted-foreground"}>{session.contribute ? DRAW_LINE : LOOK_LINE}</span>
              </Line>
              <Line label={LAST_CHECK}>
                <CheckLine check={check} checking={checking} />
              </Line>
            </dl>
          </Card>
        </div>
        <AgentCard session={session} onChanged={onChanged} />
      </div>
      <Card title={MANAGE_TITLE}>
        <div className="grid gap-4 @3xl:grid-cols-3">
          <RenameForm session={session} onChanged={onChanged} />
          <LinkForm onChanged={onChanged} />
          <NewRoomForm onChanged={onChanged} />
        </div>
      </Card>
    </article>
  )
}
