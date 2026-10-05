/**
 * The pieces both chats (the Lobby's and the planning panel's) are made of,
 * so they read as one: a speaker's round avatar with its icon in its colour,
 * the speaker's line (name, then time), your messages as a tinted bubble on
 * the right, notes as a quiet rule across the column, and three dots while
 * someone is still typing.
 */
import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { AgentIcon } from "@/ui/AgentIcon"
import { sourceTone } from "./types"

/** A round avatar in the speaker's colour; `live` while it is working. */
export function ChatAvatar({ source, live }: { source: string; live?: boolean }) {
  return (
    <span aria-hidden="true" className="chat-avatar" data-live={live || undefined} style={{ "--orb": sourceTone(source) } as CSSProperties}>
      <AgentIcon source={source} strokeWidth={2.25} className="size-3.5" />
    </span>
  )
}

/** One message from an agent: avatar and name on its first line, the text under the name. A follow-on message drops both. */
export function AgentMessage({ source, name, time, head, live, children, aside }: { source: string; name: string; time?: string; head: boolean; live?: boolean; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="chat-row group/msg">
      <div className="chat-gutter">{head ? <ChatAvatar source={source} live={live} /> : time ? <time className="chat-hover-time">{time}</time> : null}</div>
      <div className="min-w-0">
        {head ? (
          <p className="chat-speaker">
            <span className="font-medium text-foreground">{name}</span>
            {time ? <time className="text-xs text-muted-foreground tabular-nums">{time}</time> : null}
            {aside ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{aside}</span> : null}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}

/** Your message: a bubble on the right, with "You" and the time over the first of a run. */
export function YourMessage({ time, head, note, children, below }: { time?: string; head: boolean; note?: string; children: ReactNode; below?: ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {head ? (
        <p className="flex items-baseline gap-2 text-xs text-muted-foreground">
          {time ? <time className="tabular-nums">{time}</time> : null}
          <span className="font-medium text-foreground">You</span>
          {note ? <span>{note}</span> : null}
        </p>
      ) : null}
      <div className="chat-bubble">{children}</div>
      {below}
    </div>
  )
}

/** A note across the column: `── task started · 10:44 ──`. */
export function ChatNote({ failed, children }: { failed?: boolean; children: ReactNode }) {
  return (
    <div role="note" className={cn("chat-note", failed && "text-destructive")}>
      <span>{children}</span>
    </div>
  )
}

/** Three dots, for a reply on its way. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("typing-dots", className)}>
      <span />
      <span />
      <span />
    </span>
  )
}
