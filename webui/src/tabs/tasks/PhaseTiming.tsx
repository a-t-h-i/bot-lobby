import { useEffect, useState } from "react"
import { executionMs, executionWords, type PhaseClock, type WorkClock } from "@/lib/phaseTiming"
import { useElapsed } from "@/lib/useElapsed"

/** A task without a work clock (from before it was kept): its phase's execution time. */
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

/** How long the task's agents have worked on it, idle time left out, ticking while they work. */
function Worked({ work, timing, stopped }: { work: WorkClock; timing?: PhaseClock; stopped: boolean }) {
  const counting = work.running && !stopped && !timing?.waiting
  const elapsed = useElapsed(counting, work)
  return (
    <span className="tabular-nums" data-work-clock={counting ? "running" : "stopped"}>
      {timing?.waiting ? "Waiting for you · " : ""}
      {timing ? `${timing.phase.replaceAll("_", " ")} · ` : ""}
      worked {executionWords(work.workedMs + elapsed)}
    </span>
  )
}

export function PhaseTiming({ timing, work, stopped = false }: { timing?: PhaseClock; work?: WorkClock; stopped?: boolean }) {
  if (work) return <Worked work={work} {...(timing ? { timing } : {})} stopped={stopped} />
  return timing ? <Clock key={JSON.stringify(timing)} timing={timing} stopped={stopped} /> : <span>Timing unavailable</span>
}
