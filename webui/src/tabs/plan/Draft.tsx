/**
 * The draft plan, line by line. Each source line renders as Markdown (lines
 * inside a code fence stay literal) with a Comment button beside it; clicking
 * the line does the same, and the comment is written right under the line.
 * Lines the user has commented on wear a dot with their comments beneath, as
 * the terminal draws them.
 */
import { memo, useMemo, type ReactNode } from "react"
import { MessageSquarePlus } from "lucide-react"
import type { PanelNote } from "@protocol"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { useGradual } from "@/lib/useGradual"
import { sourceLabel } from "../lobby/types"
import { agentColor } from "@/ui/AgentIcon"
import { SEATS_NEED } from "./words"

export interface DraftRow {
  /** The source line, untrimmed. */
  text: string
  fenced: boolean
}

/** The draft's lines, each marked as inside a code fence or not (the fence lines themselves count as inside). */
export function draftRows(draft: string): DraftRow[] {
  let open = false
  return draft.split("\n").map((text) => {
    const fence = text.trimStart().startsWith("```")
    if (fence) open = !open
    return { text, fenced: open || fence }
  })
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <>
      {notes.map((note, index) => (
        <p key={index} className="cs-dnote">
          {note}
        </p>
      ))}
    </>
  )
}

interface LineProps {
  row: DraftRow
  index: number
  notes: string[]
  /** The comment being written on this line, drawn under it. */
  form?: ReactNode
  onComment: (index: number) => void
}

/** A line without comments: one shared list, so an untouched line is not drawn again as more lines arrive. */
const NO_NOTES: string[] = []

const Line = memo(function Line({ row, index, notes, form, onComment }: LineProps) {
  const line = row.text.trim()
  const open = () => onComment(index)
  return (
    // Lines out of view are not laid out until scrolled to: a plan of hundreds of lines lands in one cheap frame.
    <li data-line={index} className={cn("cs-dr", !form && "[contain-intrinsic-size:auto_2.75rem] [content-visibility:auto]")}>
      <div className="cs-dln">
        <span className="cs-dd" aria-hidden="true">
          {notes.length > 0 ? <i /> : null}
        </span>
        <div
          className={cn("cs-dtx", row.fenced && "font-mono text-[12.5px] whitespace-pre-wrap break-words")}
          data-on={form ? "true" : undefined}
          data-k={/^#{1,6}\s/.test(line) ? "h" : undefined}
          onClick={(event) => !(event.target as HTMLElement).closest("a") && open()}
        >
          {row.fenced ? row.text : <Markdown text={row.text} />}
        </div>
        <button type="button" className="cs-dcb" aria-label={`Comment on this line: ${line}`} onClick={open}>
          <MessageSquarePlus aria-hidden="true" className="size-[15px]" />
        </button>
      </div>
      <Notes notes={notes} />
      {form}
    </li>
  )
})

/** The draft's lines; `commenting` is the line a comment is being written on, with its `form`. */
export function DraftBody({ draft, comments, commenting, form, onComment }: { draft: string; comments: ReadonlyMap<string, string[]>; commenting?: number; form?: ReactNode; onComment: (index: number) => void }) {
  const rows = useMemo(() => draftRows(draft), [draft])
  // A screenful at once, the rest a chunk a frame: a long plan never holds up the tab switch that shows it.
  const shown = useGradual(rows.length)
  return (
    <ul className="cs-drl" aria-label="Draft plan lines">
      {rows.slice(0, shown).map((row, index) =>
        row.text.trim() ? (
          <Line key={index} row={row} index={index} notes={comments.get(row.text.trim()) ?? NO_NOTES} form={index === commenting ? form : undefined} onComment={onComment} />
        ) : (
          <li key={index} aria-hidden="true" className="h-2" />
        )
      )}
    </ul>
  )
}

export function SeatNeeds({ notes }: { notes: PanelNote[] }) {
  if (notes.length === 0) return null
  return (
    <Section title={SEATS_NEED}>
      <dl className="flex flex-col gap-2 text-sm">
        {notes.map((note, index) => (
          <div key={index} className="flex min-w-0 gap-3">
            <dt className="w-20 shrink-0 font-semibold" style={{ color: agentColor(note.from) }}>{sourceLabel(note.from)}</dt>
            <dd className="min-w-0 flex-1">
              <Markdown text={note.text} />
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
