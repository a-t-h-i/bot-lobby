/**
 * How many of a long list's items to render: a screenful at once, and the
 * rest once the tab switch that brought the page in has played, a frame's
 * budget at a time. A page of hundreds of items (a long plan) never builds in
 * one frame, so neither the tab animation nor typing stalls while it does; a
 * short list renders whole at once. Each chunk is committed in its own frame
 * and sized from how long the last one took, so it always finishes, however
 * busy the page's other updates keep React.
 */
import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { afterSwitch } from "./switching"

/** A frame's share for building more of the list, in ms: the rest is the browser's. */
const BUDGET_MS = 8

export function useGradual(total: number, first = 24): number {
  const [shown, setShown] = useState(first)
  const step = useRef(8)
  const short = shown < total
  useEffect(() => {
    if (!short) return
    let frame = 0
    const cancel = afterSwitch(() => {
      frame = requestAnimationFrame(() => {
        const started = performance.now()
        flushSync(() => setShown((count) => count + step.current))
        const took = Math.max(1, performance.now() - started)
        step.current = Math.max(2, Math.min(400, Math.round((step.current * BUDGET_MS) / took)))
      })
    })
    return () => {
      cancel()
      cancelAnimationFrame(frame)
    }
  }, [short, shown])
  return Math.min(shown, total)
}
