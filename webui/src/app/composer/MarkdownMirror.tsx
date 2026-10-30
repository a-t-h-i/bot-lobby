/**
 * The message box's text drawn again behind it, its Markdown styled (see `markdownMirror.ts`). The box keeps the
 * caret, the selection and the typing; its own text is clear, so what shows is this layer, scrolled with it.
 */
import { forwardRef, memo } from "react"
import { markdownRuns } from "./markdownMirror"

const Runs = memo(function Runs({ text }: { text: string }) {
  return (
    <>
      {markdownRuns(text).map((run, index) =>
        run.kind ? (
          <span key={index} className={run.kind.split(" ").map((kind) => `md-${kind}`).join(" ")}>
            {run.text}
          </span>
        ) : (
          run.text
        )
      )}
      {/* A last empty line still takes its height, as it does in the box. */}
      {"​"}
    </>
  )
})

export const MarkdownMirror = forwardRef<HTMLDivElement, { text: string }>(function MarkdownMirror({ text }, ref) {
  return (
    <div ref={ref} className="bubble-text bubble-mirror" aria-hidden="true">
      <Runs text={text} />
    </div>
  )
})
