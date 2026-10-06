/**
 * Resume (R): carry a paused or stopped task on from the Tasks screen, without
 * opening it in a session. The server unpauses it where it runs, or starts it
 * in a background session (its old one again when it can); this window and
 * this page stay where they are. The toast offers to watch the session.
 */
import { useEffect, useRef, useState } from "react"
import { Play } from "lucide-react"
import type { TaskRow } from "@protocol"
import { go } from "@/app/router"
import { call } from "@/lib/api"
import { selectedProject } from "@/lib/project"
import { toast } from "@/lib/toast"
import { ActionButton } from "@/ui/Actions"

export function ResumeTask({ row, onResumed }: { row: TaskRow; onResumed: () => void }) {
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function resume() {
    const project = selectedProject()
    setBusy(true)
    try {
      const result = await call("tasks.resume", { taskId: row.id })
      if (selectedProject() !== project) return
      const key = result.key
      toast(result.notice, key ? { action: { label: "Watch", onClick: () => go(`#/sessions/${encodeURIComponent(key)}`) } } : undefined)
      onResumed()
    } catch (e) {
      if (selectedProject() === project) toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const stopped = row.owner === "not running"
  return (
    <ActionButton
      label={stopped ? "Resume: carry it on in a background session" : "Resume: unpause it where it runs"}
      text="Resume"
      icon={Play}
      tone="primary"
      shortcut="R"
      disabled={busy}
      onClick={() => void resume()}
    />
  )
}
