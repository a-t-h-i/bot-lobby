/**
 * The draft plan, line by line. Each source line renders as Markdown (lines
 * inside a code fence stay literal) with a Comment button beside it; clicking
 * the line does the same. Lines the user has commented on wear a dot with their
 * comments beneath, as the terminal draws them.
 */
import { memo, useMemo } from "react"
import { MessageSquarePlus } from "lucide-react"
import type { PanelNote } from "@protocol"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { useGradual } from "@/lib/useGradual"
import { sourceColor, sourceLabel } from "../lobby/types"
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
        <p key={index} className="ml-6 rounded-lg border border-primary/15 bg-accent px-3 py-1.5 text-sm text-foreground italic">
          {note}
        </p>
      ))}
    </>
  )
}

interface LineProps {
  row: DraftRow
  notes: string[]
  onComment: (line: string) => void
}

/** A line without comments: one shared list, so an untouched line is not drawn again as more lines arrive. */
const NO_NOTES: string[] = []

const Line = memo(function Line({ row, notes, onComment }: LineProps) {
  const line = row.text.trim()
  const open = () => onComment(line)
  return (
    // Lines out of view are not laid out until scrolled to: a plan of hundreds of lines lands in one cheap frame.
    <li className="group/line [contain-intrinsic-size:auto_2.75rem] [content-visibility:auto]">
      <div className="flex items-start gap-1">
        <span className="flex w-4 shrink-0 justify-center pt-3.5" aria-hidden="true">
          {notes.length > 0 ? <span className="size-2 rounded-full bg-primary" /> : null}
        </span>
        <div
          className={cn("min-w-0 flex-1 cursor-pointer rounded-lg px-2 py-1.5 transition-colors hover:bg-muted", row.fenced && "font-mono text-sm whitespace-pre-wrap break-words")}
          onClick={(event) => !(event.target as HTMLElement).closest("a") && open()}
        >
          {row.fenced ? row.text : <Markdown text={row.text} />}
        </div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/line:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label={`Comment on this line: ${line}`} onClick={open}>
          <MessageSquarePlus aria-hidden="true" />
        </Button>
      </div>
      <Notes notes={notes} />
    </li>
  )
})

export function DraftBody({ draft, comments, onComment }: { draft: string; comments: ReadonlyMap<string, string[]>; onComment: (line: string) => void }) {
  const rows = useMemo(() => draftRows(draft), [draft])
  // A screenful at once, the rest a chunk a frame: a long plan never holds up the tab switch that shows it.
  const shown = useGradual(rows.length)
  return (
    <ul className="flex flex-col" aria-label="Draft plan lines">
      {rows.slice(0, shown).map((row, index) =>
        row.text.trim() ? (
          <Line key={index} row={row} notes={comments.get(row.text.trim()) ?? NO_NOTES} onComment={onComment} />
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
          <div key={index} className="flex gap-3">
            <dt className={cn("w-20 shrink-0 font-medium", sourceColor(note.from))}>{sourceLabel(note.from)}</dt>
            <dd className="min-w-0 flex-1">
              <Markdown text={note.text} />
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
