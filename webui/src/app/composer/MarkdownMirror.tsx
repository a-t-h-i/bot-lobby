/**
 * The message box's text drawn again behind it, its Markdown styled (see `markdownMirror.ts`). The box keeps the
 * caret, the selection and the typing; its own text is clear, so what shows is this layer, scrolled with it.
 */
import { forwardRef, memo, useRef } from "react"
import { agentColor } from "@/ui/AgentIcon"
import { markdownRuns } from "./markdownMirror"

/** A `/command` wears the accent; an `@name` its agent's colour, or the accent for a name that is no agent. */
function mentionColor(text: string): string {
  if (text.startsWith("/")) return "var(--primary)"
  const colour = agentColor(text.slice(1))
  return colour === "var(--muted-foreground)" ? "var(--primary)" : colour
}

/** Text typed lately: the span each keystroke added, `seq` naming the edit and `at` when it happened. */
interface Fresh {
  start: number
  end: number
  seq: number
  at: number
}

/** How long typed text keeps its own span: a little over the fade in the stylesheet (.md-new), so a fade is never cut. */
const FADE_MS = 260

function insertion(before: string, after: string): { start: number; end: number } | undefined {
  if (after.length <= before.length) return undefined
  let start = 0
  while (start < before.length && before[start] === after[start]) start++
  let tail = 0
  while (tail < before.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const end = after.length - tail
  // A paste or a big insert shows at once; only typing fades in.
  return end - start > 0 && end - start <= 24 ? { start, end } : undefined
}

/**
 * The fresh spans after an edit: the new keystroke's span added, the ones after it moved along, and spans whose fade
 * has finished let go. Each keystroke keeps its own span (and key) until its fade ends, so fast typing never cuts
 * the last letter's fade short. Anything but an insertion (a delete, a paste) shows at once.
 */
function nextFresh(before: string, after: string, now: Fresh[], seq: number, at: number): Fresh[] {
  const span = insertion(before, after)
  if (!span) return []
  const size = span.end - span.start
  const kept = now
    .filter((fresh) => at - fresh.at < FADE_MS && !(fresh.start < span.start && fresh.end > span.start))
    .map((fresh) => (fresh.start >= span.start ? { ...fresh, start: fresh.start + size, end: fresh.end + size } : fresh))
  return [...kept, { ...span, seq, at }].sort((x, y) => x.start - y.start)
}

const Runs = memo(function Runs({ text, fresh }: { text: string; fresh: Fresh[] }) {
  let at = 0
  return (
    <>
      {markdownRuns(text).flatMap((run, index) => {
        const from = at
        at += run.text.length
        const className = run.kind ? run.kind.split(" ").map((kind) => `md-${kind}`).join(" ") : ""
        const style = run.kind === "mention" ? { color: mentionColor(run.text) } : undefined
        // The run cut at each fresh span inside it; a fresh piece is keyed by its edit, so its fade runs on to the end.
        const pieces: { a: number; b: number; seq?: number }[] = []
        let cursor = from
        for (const span of fresh) {
          const a = Math.max(from, span.start)
          const b = Math.min(at, span.end)
          if (b <= a) continue
          if (a > cursor) pieces.push({ a: cursor, b: a })
          pieces.push({ a, b, seq: span.seq })
          cursor = b
        }
        if (cursor < at) pieces.push({ a: cursor, b: at })
        return pieces.map(({ a, b, seq }) => {
          const piece = run.text.slice(a - from, b - from)
          const isNew = seq !== undefined
          return className || isNew ? (
            <span key={isNew ? `n${seq}-${index}` : `${index}-${a}`} className={[className, isNew ? "md-new" : ""].filter(Boolean).join(" ")} style={style}>
              {piece}
            </span>
          ) : (
            piece
          )
        })
      })}
      {/* A last empty line still takes its height, as it does in the box. */}
      {"\u200b"}
    </>
  )
})

export const MarkdownMirror = forwardRef<HTMLDivElement, { text: string }>(function MarkdownMirror({ text }, ref) {
  const last = useRef({ text, fresh: [] as Fresh[], seq: 0 })
  if (last.current.text !== text) {
    const seq = last.current.seq + 1
    last.current = { text, seq, fresh: nextFresh(last.current.text, text, last.current.fresh, seq, performance.now()) }
  }
  return (
    <div ref={ref} className="bubble-text bubble-mirror" aria-hidden="true">
      <Runs text={text} fresh={last.current.fresh} />
    </div>
  )
})
