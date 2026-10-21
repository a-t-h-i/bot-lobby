/**
 * The pieces both chats (the Lobby's and the planning panel's) are made of,
 * so they read as one, after the coding harnesses: the agents' words as plain
 * prose across the column, yours in a filled bubble on the right, notes as a
 * quiet centred line, and three dots while someone is still typing. A reply
 * still being written ends in a beating dot, in its speaker's colour.
 */
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { AgentIcon, isOracle } from "@/ui/AgentIcon"
import { sourceTone } from "./types"

/**
 * One message from an agent, the way the coding harnesses write theirs: plain
 * prose across the column, no bubble and no avatar. A speaker gets a small
 * line with its icon and name over the first of a run; the oracle only where
 * other agents speak too (`named`: the Lobby, where any agent may answer).
 * The time shows under the message while it is pointed at. `bubble={false}`
 * is kept for content that brings its own cards (the panel's questions).
 */
export function AgentMessage({ source, name, time, head, live, children, aside, named: always }: { source: string; name: string; time?: string; head: boolean; live?: boolean; children: ReactNode; aside?: ReactNode; bubble?: boolean; named?: boolean }) {
  const named = head && (always || !isOracle(source))
  return (
    <div className="chat-agent group/msg" data-live={live || undefined} style={live ? ({ "--orb": sourceTone(source) } as CSSProperties) : undefined}>
      {named || aside ? (
        <p className="chat-speaker">
          {named ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground" style={{ "--orb": sourceTone(source) } as CSSProperties}>
              <AgentIcon source={source} strokeWidth={2.25} className="size-3.5 text-[color-mix(in_oklab,var(--orb)_85%,var(--foreground))]" />
              {name}
            </span>
          ) : null}
          {named && time ? <time className="text-xs text-muted-foreground tabular-nums">{time}</time> : null}
          {aside ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{aside}</span> : null}
        </p>
      ) : null}
      <div className="chat-prose">{children}</div>
      {time && !named ? <time className="chat-meta">{time}</time> : null}
    </div>
  )
}

/** Your message: a filled bubble on the right; its time shows under it while it is pointed at. */
export function YourMessage({ time, head: _head, note, children, below, actions }: { time?: string; head: boolean; note?: string; children: ReactNode; below?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="group/msg flex flex-col items-end gap-1">
      <div className="chat-bubble">{children}</div>
      {time || note || actions ? (
        <div className="chat-meta flex items-center gap-2" data-note={note ? "" : undefined}>
          {actions}
          {note ? <span>{note}</span> : null}
          {time ? <time className="tabular-nums">{time}</time> : null}
        </div>
      ) : null}
      {below}
    </div>
  )
}

/** A quiet line centred in the column: `task started · 10:44`. */
export function ChatNote({ failed, children }: { failed?: boolean; children: ReactNode }) {
  return (
    <div role="note" className={cn("chat-note", failed && "text-destructive")}>
      <span>{children}</span>
    </div>
  )
}

/** Three dots in a wave that lights them in the speaker's colour, for a reply on its way. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("typing-dots", className)}>
      <span />
      <span />
      <span />
    </span>
  )
}
