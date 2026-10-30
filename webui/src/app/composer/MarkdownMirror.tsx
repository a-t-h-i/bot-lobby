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

/** What was just typed: the span between what stayed the same at the start and at the end. `seq` counts the edits. */
interface Fresh {
  start: number
  end: number
  seq: number
}

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

const Runs = memo(function Runs({ text, fresh }: { text: string; fresh?: Fresh }) {
  let at = 0
  return (
    <>
      {markdownRuns(text).flatMap((run, index) => {
        const from = at
        at += run.text.length
        const className = run.kind ? run.kind.split(" ").map((kind) => `md-${kind}`).join(" ") : ""
        const style = run.kind === "mention" ? { color: mentionColor(run.text) } : undefined
        // The run cut where the fresh text starts and ends, the fresh part keyed by the edit so its fade restarts.
        const cuts = fresh && fresh.start < at && fresh.end > from
          ? [[from, Math.max(from, fresh.start)], [Math.max(from, fresh.start), Math.min(at, fresh.end)], [Math.min(at, fresh.end), at]]
          : [[from, at]]
        return cuts.filter(([a, b]) => b! > a!).map(([a, b]) => {
          const isNew = fresh !== undefined && cuts.length > 1 && a === Math.max(from, fresh.start)
          const piece = run.text.slice(a! - from, b! - from)
          return className || isNew ? (
            <span key={isNew ? `n${fresh!.seq}-${index}` : `${index}-${a}`} className={[className, isNew ? "md-new" : ""].filter(Boolean).join(" ")} style={style}>
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
  const last = useRef({ text, fresh: undefined as Fresh | undefined, seq: 0 })
  if (last.current.text !== text) {
    const span = insertion(last.current.text, text)
    const seq = last.current.seq + 1
    last.current = { text, seq, fresh: span ? { ...span, seq } : undefined }
  }
  return (
    <div ref={ref} className="bubble-text bubble-mirror" aria-hidden="true">
      <Runs text={text} {...(last.current.fresh ? { fresh: last.current.fresh } : {})} />
    </div>
  )
})
