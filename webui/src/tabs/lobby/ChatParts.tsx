/**
 * The pieces both chats (the Lobby's and the planning panel's) are made of,
 * so they read as one, after the coding harnesses: the agents' words as plain
 * prose across the column, yours in a filled bubble on the right, notes as a
 * quiet centred line, and the speaker's name shimmering with its role's motion (as the working word does)
 * while their reply is on its way. A reply still being written ends in a
 * beating dot, in its speaker's colour.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { ui } from "@/lib/uiScale"
import { cn } from "@/lib/utils"
import { isOracle } from "@/ui/AgentIcon"
import { sourceTone } from "./types"
import { agentColor } from "@/ui/AgentIcon"
import { RoleWord } from "./RoleWord"

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
        <AgentMessage source={source} name={name} head={head} {...{ time, live, children, aside, waiting }} named={always ?? true} />
      </div>
    )
  }
  return (
    <div className="chat-agent group/msg" data-live={live || undefined} style={live ? ({ "--orb": sourceTone(source) } as CSSProperties) : undefined}>
      {named || aside ? (
        <p className="chat-speaker">
          {named ? <b className="chat-name" title={time} style={{ "--who": agentColor(source) } as CSSProperties}>{waiting ? <RoleWord source={source} text={name} className="cs-rw-name" /> : name}</b> : null}
          {aside ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{aside}</span> : null}
        </p>
      ) : null}
      {waiting ? null : <div className="chat-prose" title={named ? undefined : time}>{children}</div>}
    </div>
  )
}

/**
 * The tail: one curve flowing on from the bubble's straight right edge out to a soft tip, its underside sweeping back
 * in a concave curve to meet the bubble's foot, so a small notch shows under it as in a real speech bubble.
 */
function BubbleTail() {
  return (
    <svg className="cs-ut" viewBox="0 0 22 16" aria-hidden="true" focusable="false">
      <path d="M0 0H13C13 8 16 12.9 21 15.5C17.6 16.4 13.7 15.9 10.7 14.2C9.2 15.4 6.6 16 3 16H0Z" className="cs-ut-fill" />
    </svg>
  )
}

/**
 * Your message: a speech bubble on the right, its tail at the bottom right: a plain soft fill, no outline.
 * A message you just sent pops in, squashing and settling like a drop.
 * Who it went to shows under it; its time is its tooltip.
 */
export function YourMessage({ time, head: _head, note, children, below, actions, fresh }: { time?: string; head: boolean; note?: string; children: ReactNode; below?: ReactNode; actions?: ReactNode; fresh?: boolean }) {
  return (
    <div className="group/msg relative flex flex-col items-end gap-1">
      <div className="chat-bubble cs-umsg" data-new={fresh || undefined} title={time}>
        <i className="cs-uf" aria-hidden="true"><b className="cs-ub" /></i>
        <BubbleTail />
        <div className="cs-ux">{children}</div>
        {/* Edit and the like wait just left of the bubble, bound to it, shown on hover or focus. */}
        {actions && !note ? <div className="chat-meta absolute top-1/2 right-full mr-2 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap">{actions}</div> : null}
      </div>
      {note ? (
        <div className="chat-meta flex items-center gap-2 pr-[9px]" data-note="">
          {actions}
          <span>{note}</span>
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

/** A long message of yours folds to about this height (at the 15px root): eleven lines or so. */
const FOLD_PX = 252
/** Only a message this much taller than the fold folds; a line or two over just shows. */
const FOLD_SLACK_PX = 66

/**
 * A long message of yours, folded: its first lines with the foot fading out, and Show more under them, which opens
 * it to its full height on a soft spring (and Show less folds it back). Short messages show as they are.
 */
export function Fold({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(0)
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    setFull(el.offsetHeight)
    const observer = new ResizeObserver(() => setFull(el.offsetHeight))
    observer.observe(el)
    // The fold takes its first height at once; only later changes (Show more, Show less) move.
    const frame = requestAnimationFrame(() => setReady(true))
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  const limit = ui(FOLD_PX)
  const long = full > limit + ui(FOLD_SLACK_PX)
  const toggle = () => {
    setOpen((now) => !now)
    // Folding a tall message back keeps its top in view rather than leaving the page far below it.
    if (open && box.current && box.current.getBoundingClientRect().top < 0) box.current.scrollIntoView({ block: "start", behavior: "smooth" })
  }
  return (
    <>
      <div
        ref={box}
        className="cs-fold"
        data-folded={(long && !open) || undefined}
        data-ready={ready || undefined}
        style={long ? { height: open ? full : limit } : undefined}
      >
        <div ref={inner} className="cs-fold-in">{children}</div>
      </div>
      {long ? (
        <button type="button" className="cs-fold-btn" aria-expanded={open} onClick={toggle}>
          {open ? "Show less" : "Show more"}
          <ChevronDown aria-hidden="true" className="cs-fold-chev" data-open={open || undefined} />
        </button>
      ) : null}
    </>
  )
}
