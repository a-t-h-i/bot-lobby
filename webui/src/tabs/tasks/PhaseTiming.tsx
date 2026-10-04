import { useEffect, useState } from "react"
import { executionMs, executionWords, type PhaseClock } from "@/lib/phaseTiming"

function Clock({ timing, stopped }: { timing: PhaseClock; stopped: boolean }) {
  const [delta, setDelta] = useState(0)
  useEffect(() => {
    setDelta(0)
    if (stopped || timing.waiting || !timing.runningSince) return
    const sampled = performance.now()
    const timer = window.setInterval(() => setDelta(performance.now() - sampled), 1000)
    return () => window.clearInterval(timer)
  }, [timing, stopped])
  return <span className="tabular-nums">{timing.waiting ? "Waiting for you · " : ""}{timing.phase.replaceAll("_", " ")} · {executionWords(executionMs(timing, delta, stopped))} execution</span>
}

export function PhaseTiming({ timing, stopped = false }: { timing?: PhaseClock; stopped?: boolean }) {
  return timing ? <Clock key={JSON.stringify(timing)} timing={timing} stopped={stopped} /> : <span>Timing unavailable</span>
}
