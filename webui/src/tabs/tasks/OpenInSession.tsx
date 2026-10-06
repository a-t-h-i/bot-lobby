/**
 * The one place the Tasks screen moves a session: "Open in session" (S), an
 * explicit action of its own. "Conversation" (O) beside it only shows the
 * owner's chat and never starts, claims or switches anything; "Resume" (R)
 * carries a paused or stopped task on and leaves this window where it is (it
 * is the main action then, so this one steps back).
 */
import { useEffect, useRef } from "react"
import { ArrowRightToLine } from "lucide-react"
import type { TaskRow } from "@protocol"
import { go } from "@/app/router"
import { act } from "@/lib/act"
import { call } from "@/lib/api"
import { selectedProject } from "@/lib/project"
import { toast } from "@/lib/toast"
import { ActionButton } from "@/ui/Actions"

/**
 * Work on the task where it lives: this window's own task is the Lobby; a
 * task a background session drives moves that session into this window; a
 * task no running session owns is taken over here. One in another terminal
 * stays there (the toast says so). The server refuses while the oracle works.
 */
export function OpenInSession({ row, quiet = false }: { row: TaskRow; quiet?: boolean }) {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function open() {
    if (row.section === "mine") return go("#/lobby")
    const project = selectedProject()
    const still = () => alive.current && selectedProject() === project
    try {
      const where = await call("tasks.open", { taskId: row.id })
      if (!still()) return
      const status = await call("status.get", {})
      if (!still()) return
      if (where.sessionId && where.sessionId === status.sessionId) return go("#/lobby")
      if (where.sessionId && !where.key) return toast.info("This task runs in another terminal. Switch to that terminal to work on it.")
      if (status.busy) return toast.info("The oracle is working in this window. Stop it first, then open the task in its session.")
      if ((await act("sessions.switch", where.key ? { key: where.key } : { claimTaskId: row.id })) && still()) go("#/lobby")
    } catch (e) { if (still()) toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const here = row.section === "mine"
  return (
    <ActionButton
      label={here ? "Open in its session: this window" : "Open in its session"}
      text="Open in session"
      icon={ArrowRightToLine}
      tone={quiet ? "neutral" : "primary"}
      shortcut="S"
      onClick={() => void open()}
    />
  )
}
