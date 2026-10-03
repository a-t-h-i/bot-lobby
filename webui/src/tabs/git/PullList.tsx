/**
 * The Git list: one row per open pull request: number, checks mark, `draft`,
 * title, our review outcome and the change size, with a muted line of files,
 * labels and a stale mark under it. The chosen row is lit.
 */
import type { PullInfo } from "@protocol"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { changeSize, checkMark, checkTone, metaLine, reviewMark } from "./words"

function Checks({ checks }: { checks: PullInfo["checks"] }) {
  const mark = checkMark(checks)
  if (!mark) return <span className="w-4 shrink-0" aria-hidden="true" />
  return (
    <span className={cn("w-4 shrink-0 text-center", checkTone(checks))} aria-hidden="true">
      {mark}
    </span>
  )
}

function Row({ pull, selected, onSelect }: { pull: PullInfo; selected: boolean; onSelect: (number: number) => void }) {
  const review = reviewMark(pull.review)
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(pull.number)}
        className="flex min-h-11 w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=true]:bg-accent"
      >
        <span className="flex items-start gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground tabular-nums">#{pull.number}</span>
          <Checks checks={pull.checks} />
          {pull.draft ? <Badge variant="secondary">draft</Badge> : null}
          <span className={cn("min-w-0 flex-1 break-words text-foreground", selected && "font-medium")}>{pull.title}</span>
        </span>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
          <span>{metaLine(pull)}</span>
          <span className="flex items-baseline gap-2">
            {review ? <span>{review}</span> : null}
            <span className="tabular-nums">{changeSize(pull.additions, pull.deletions)}</span>
          </span>
        </span>
      </button>
    </li>
  )
}

export function PullList({ pulls, selectedId, onSelect }: { pulls: readonly PullInfo[]; selectedId?: number; onSelect: (number: number) => void }) {
  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-2">
      {pulls.map((pull) => (
        <Row key={pull.number} pull={pull} selected={pull.number === selectedId} onSelect={onSelect} />
      ))}
    </ul>
  )
}
