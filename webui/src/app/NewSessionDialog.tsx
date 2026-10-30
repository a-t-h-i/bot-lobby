/**
 * The sidebar's New session: a pop-up that asks what the new session should
 * do and starts it in the background (`sessions.start`), where it shows up in
 * the sidebar's list like any other background session.
 */
import { useId, useState } from "react"
import { Popup } from "@/components/ui/popup"
import { Button } from "@/components/ui/button"
import { Keys } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { call } from "@/lib/api"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { toast } from "@/lib/toast"

export function NewSessionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const shown = useOverlaySlot(open, PRIORITY.help)
  const [request, setRequest] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const field = useId()
  const close = () => {
    if (busy) return
    onOpenChange(false)
    setRequest("")
    setError("")
  }
  const start = async () => {
    const text = request.trim()
    if (!text || busy) return
    setBusy(true)
    setError("")
    try {
      toast((await call("sessions.start", { request: text })).notice)
      onOpenChange(false)
      setRequest("")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work. Try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popup open={shown} label="New session" description="Starts a task in a session of its own, in the background." onOpenChange={(next) => { if (!next) close() }} dismissOnBackdrop={!busy} className="max-w-[460px]">
      <div className="flex w-full flex-col">
        <div className="cs-dh">
          <h2>New session</h2>
          <p className="mt-[5px] text-[12.5px] leading-normal text-muted-foreground">It runs in the background and shows up in the sidebar; this window carries on with what it is doing.</p>
        </div>
        <div className="cs-db flex flex-col">
          <label htmlFor={field} className="mb-[7px] text-[12.5px] font-semibold">What should it do?</label>
          <Textarea
            id={field}
            value={request}
            autoFocus
            disabled={busy}
            aria-invalid={error ? true : undefined}
            placeholder="Fix the flaky login test, add dark mode to Settings…"
            className="cs-nsta max-h-60 min-h-[108px]"
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void start()
              }
            }}
          />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="cs-df">
          <span className="mr-auto flex items-center gap-1.5 text-xs text-[var(--faint)]"><Keys chord="Ctrl+Enter" /> to start</span>
          <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={() => void start()} disabled={!request.trim() || busy} aria-busy={busy}>{busy ? "Starting…" : "Start session"}</Button>
        </div>
      </div>
    </Popup>
  )
}
