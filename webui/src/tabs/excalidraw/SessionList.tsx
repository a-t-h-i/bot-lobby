/**
 * The Excalidraw list: one 44 px row per shared session — its
 * check mark (`⠋ ✓ !`), name, masked link, agent count and a draw/look badge —
 * with an inset ring on the selected row. At most five, as the terminal keeps.
 */
import type { ExcalidrawCheck, ExcalidrawSessionInfo } from "@protocol"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { DRAW_BADGE, LOOK_BADGE, agentCount, checkMark } from "./words"

function Mark({ check, checking }: { check?: ExcalidrawCheck; checking: boolean }) {
  if (checking) return <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
  const mark = checkMark(check)
  if (!mark) return <span className="w-3.5 shrink-0" aria-hidden="true" />
  return (
    <span className={cn("w-3.5 shrink-0 text-center", check?.ok ? "text-primary" : "text-foreground")} aria-hidden="true">
      {mark}
    </span>
  )
}

function Row({ session, check, checking, selected, onSelect }: { session: ExcalidrawSessionInfo; check?: ExcalidrawCheck; checking: boolean; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(session.id)}
        className="flex min-h-11 w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=true]:bg-accent"
      >
        <span className="flex items-center gap-2 text-sm">
          <Mark check={check} checking={checking} />
          <span className={cn("min-w-0 flex-1 break-words text-foreground", selected && "font-medium")}>{session.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{agentCount(session.agents.length)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono break-all">{session.masked}</span>
          <Badge variant="secondary">{session.contribute ? DRAW_BADGE : LOOK_BADGE}</Badge>
        </span>
      </button>
    </li>
  )
}

export function SessionList({ sessions, checks, checking, selectedId, onSelect }: { sessions: readonly ExcalidrawSessionInfo[]; checks: Record<string, ExcalidrawCheck>; checking: readonly string[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-2">
      {sessions.map((session) => (
        <Row
          key={session.id}
          session={session}
          check={checks[session.id]}
          checking={checking.includes(session.id)}
          selected={session.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}
