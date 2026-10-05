import { useEffect, useState } from "react"

/**
 * Time since `sample` (a reply from the server) on the page's own clock, ticking each second while
 * `running`; 0 when it is not. A new sample starts it again, so the server's figure stays the baseline.
 */
export function useElapsed(running: boolean, sample: unknown): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    if (!running) return
    const sampled = performance.now()
    const timer = window.setInterval(() => setElapsed(performance.now() - sampled), 1000)
    return () => window.clearInterval(timer)
  }, [running, sample])
  return running ? elapsed : 0
}
