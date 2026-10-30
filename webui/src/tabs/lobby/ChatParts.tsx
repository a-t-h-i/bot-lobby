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
export function AgentMessage({ source, name, time, head, live, children, aside, named: always, waiting, tile }: { source: string; name: string; time?: string; head: boolean; live?: boolean; children?: ReactNode; aside?: ReactNode; bubble?: boolean; named?: boolean; waiting?: boolean; tile?: boolean }) {
  const named = waiting || (head && (always || !isOracle(source)))
  // The planning panel speaks beside the oracle's tile; the Lobby's agents by name alone.
  if (tile) {
    return (
      <div className="cs-pmsg">
        <span aria-hidden="true" className="cs-tile cs-lg" style={{ "--ac": "var(--c-orc)" } as CSSProperties}>O</span>
        <AgentMessage source={source} name={name} head={head} {...{ time, live, children, aside, waiting }} named={always ?? true} />
      </div>
    )
  }
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

/** The tail, one curve flowing on from the bubble's straight right edge: its outline drawn first, then the fill over it. */
const TAIL = "C13 7.5 15.4 12.6 20.6 14.8C21.4 15.2 21.1 16 20.2 16"
function BubbleTail() {
  return (
    <svg className="cs-ut" viewBox="0 0 22 16" aria-hidden="true" focusable="false">
      <path d={`M13 0${TAIL}H6`} className="cs-ut-edge" />
      <path d={`M0 0H13${TAIL}H0Z`} className="cs-ut-fill" />
    </svg>
  )
}

/**
 * Your message: a speech bubble on the right, its tail at the bottom right, drawn like the bays (an edge layer and
 * a lit fill layer through the goo filters). A message you just sent pops in, squashing and settling like a drop.
 * Who it went to shows under it; its time is its tooltip.
 */
export function YourMessage({ time, head: _head, note, children, below, actions, fresh }: { time?: string; head: boolean; note?: string; children: ReactNode; below?: ReactNode; actions?: ReactNode; fresh?: boolean }) {
  return (
    <div className="group/msg relative flex flex-col items-end gap-1">
      <div className="chat-bubble cs-umsg" data-new={fresh || undefined} title={time}>
        <i className="cs-ue" aria-hidden="true"><b className="cs-ub" /></i>
        <i className="cs-uf" aria-hidden="true"><b className="cs-ub" /></i>
        <BubbleTail />
        <div className="cs-ux">{children}</div>
      </div>
      {note ? (
        <div className="chat-meta flex items-center gap-2 pr-[9px]" data-note="">
          {actions}
          <span>{note}</span>
        </div>
      ) : actions ? (
        // Edit and the like wait beside the bubble, so the message takes no more room than the design's.
        <div className="chat-meta absolute top-1/2 right-full mr-2 flex -translate-y-1/2 items-center gap-2">{actions}</div>
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
