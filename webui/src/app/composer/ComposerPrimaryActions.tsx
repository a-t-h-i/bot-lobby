/**
 * The composer's actions at the right of its tools row: Send, a round keycap with a paper plane (a lit top edge, a
 * darker underside; it sinks when pressed, the plane lifts and tilts on hover, and on sending it takes off up and to
 * the right while a fresh plane glides in from the lower left), a flat circle while there is nothing to send, a
 * spinner only if sending takes a while; and, while the oracle works, a muted red keycap to stop it. Stop
 * still asks first (the reply in progress is lost), on the page's own confirm dialog.
 */
import { useEffect, useRef, useState } from "react"
import { Keys } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { useHotkey } from "@/lib/hotkeys"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const preventPointerFocus = (event: { preventDefault: () => void }) => event.preventDefault()

export function ComposerStopButton({ onStop }: { onStop: () => void }) {
  const [asking, setAsking] = useState(false)
  const shown = useOverlaySlot(asking, PRIORITY.confirm)
  const confirm = () => {
    setAsking(false)
    onStop()
  }
  useHotkey("y", confirm, { enabled: asking && shown, inDialog: true })
  return (
    <AlertDialog open={asking && shown} onOpenChange={setAsking}>
      <button
        type="button"
        className="bubble-send bubble-key bubble-stop"
        data-tip="Interrupt"
        onPointerDown={preventPointerFocus}
        onClick={() => setAsking(true)}
        aria-label="Stop"
        aria-haspopup="dialog"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      </button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop the oracle?</AlertDialogTitle>
          <AlertDialogDescription>The current response stops. Work already recorded is kept.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            Keep it
            <Keys chord="Esc" className="kbd-hint ml-1" />
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm}>
            Stop
            <Keys chord="Y" className="kbd-hint ml-1" />
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ComposerSendButton({ sending, disabled, steering, onSend }: { sending: boolean; disabled: boolean; steering: boolean; onSend: () => void }) {
  // Each send launches the plane once (a new key restarts the flight); the spinner waits 600ms, so a quick send
  // shows only the flight.
  const [flight, setFlight] = useState(0)
  const [slow, setSlow] = useState(false)
  const [flying, setFlying] = useState(false)
  const was = useRef(sending)
  // The button keeps its colour while the plane is in the air, though the emptied box has nothing more to send.
  useEffect(() => {
    if (!flight) return
    setFlying(true)
    const timer = setTimeout(() => setFlying(false), 640)
    return () => clearTimeout(timer)
  }, [flight])
  useEffect(() => {
    if (sending && !was.current) setFlight((n) => n + 1)
    was.current = sending
    if (!sending) return setSlow(false)
    const timer = setTimeout(() => setSlow(true), 600)
    return () => clearTimeout(timer)
  }, [sending])
  return (
    <button
      type="button"
      className={cn("bubble-send", (!disabled || flying) && "bubble-key")}
      data-tip={steering ? "Steer" : "Send"}
      data-flying={flying || undefined}
      onPointerDown={preventPointerFocus}
      onClick={onSend}
      disabled={disabled}
      aria-label="Send"
      aria-keyshortcuts="Enter"
    >
      {slow ? (
        <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
      ) : (
        <span key={flight} className="bubble-plane-wrap" data-fly={flight > 0 ? "" : undefined} aria-hidden="true">
          <svg className="bubble-plane" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" />
            <path d="M22 2l-7 20-4-9-9-4z" />
          </svg>
          <span className="bubble-trail" />
        </span>
      )}
    </button>
  )
}
