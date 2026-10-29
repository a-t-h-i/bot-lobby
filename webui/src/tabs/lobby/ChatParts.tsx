/**
 * The pieces both chats (the Lobby's and the planning panel's) are made of,
 * so they read as one, after the coding harnesses: the agents' words as plain
 * prose across the column, yours in a filled bubble on the right, notes as a
 * quiet centred line, and the speaker's name shimmering (as "Working" does)
 * while their reply is on its way. A reply still being written ends in a
 * beating dot, in its speaker's colour.
 */
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { isOracle } from "@/ui/AgentIcon"
import { sourceTone } from "./types"

/**
 * One message from an agent, as the design writes them: the speaker's name in small bold type over plain prose
 * across the column, no bubble and no avatar. The name heads the first of a run; the oracle's only where other
 * agents speak too (`named`: the Lobby, where any agent may answer). The time is the name's tooltip.
 * `waiting`: the reply has not started, so the name shimmers and nothing is under it yet.
 */
export function AgentMessage({ source, name, time, head, live, children, aside, named: always, waiting }: { source: string; name: string; time?: string; head: boolean; live?: boolean; children?: ReactNode; aside?: ReactNode; bubble?: boolean; named?: boolean; waiting?: boolean }) {
  const named = waiting || (head && (always || !isOracle(source)))
  return (
    <div className="chat-agent group/msg" data-live={live || undefined} style={live ? ({ "--orb": sourceTone(source) } as CSSProperties) : undefined}>
      {named || aside ? (
        <p className="chat-speaker">
          {named ? <b className="chat-name" title={time}>{waiting ? <ShimmerWord text={name} /> : name}</b> : null}
          {aside ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{aside}</span> : null}
        </p>
      ) : null}
      {waiting ? null : <div className="chat-prose" title={named ? undefined : time}>{children}</div>}
    </div>
  )
}

/**
 * Your message: a speech bubble on the right, its tail at the bottom right, drawn like the bays (an edge layer and
 * a lit fill layer through the goo filters). A message you just sent pops in, squashing and settling like a drop.
 * Who it went to shows under it; its time is its tooltip.
 */
export function YourMessage({ time, head: _head, note, children, below, actions, fresh }: { time?: string; head: boolean; note?: string; children: ReactNode; below?: ReactNode; actions?: ReactNode; fresh?: boolean }) {
  return (
    <div className="group/msg flex flex-col items-end gap-1">
      <div className="chat-bubble cs-umsg" data-new={fresh || undefined} title={time}>
        <i className="cs-ue" aria-hidden="true"><b className="cs-ub" /><b className="cs-ut" /></i>
        <i className="cs-uf" aria-hidden="true"><b className="cs-ub" /><b className="cs-ut" /></i>
        <div className="cs-ux">{children}</div>
      </div>
      {note || actions ? (
        <div className="chat-meta flex items-center gap-2 pr-[9px]" data-note={note ? "" : undefined}>
          {actions}
          {note ? <span>{note}</span> : null}
        </div>
      ) : null}
      {below}
    </div>
  )
}

/** A quiet line centred in the column: `task started · 10:44`; auto mode's is plain green text. */
export function ChatNote({ failed, auto, children }: { failed?: boolean; auto?: boolean; children: ReactNode }) {
  return (
    <div role="note" className={cn("chat-note", failed && "text-destructive", auto && "chat-note-auto")}>
      <span>{children}</span>
    </div>
  )
}

/** A word whose letters light up in a wave, every 2.4s: "Working", or the name of an agent whose reply is on its way. */
export function ShimmerWord({ text }: { text: string }) {
  return (
    <span className="activity-shimmer">
      <span className="sr-only">{text}</span>
      {[...text].map((letter, index) => (
        <span key={index} aria-hidden="true" style={{ "--i": index } as CSSProperties}>{letter}</span>
      ))}
    </span>
  )
}
