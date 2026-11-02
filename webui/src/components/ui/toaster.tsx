import { useEffect } from "react"
import { BubbleFilters } from "@/app/composer/ComposerSurface"
import { ToastBody, ToastShape, useToastBubble } from "@/app/composer/ToastBubble"
import { useAnyOverlay } from "@/lib/overlay"
import { dismissToast, useToast, useToastHosted, type ToastKind } from "@/lib/toast"

const KIND_WORDS: Record<ToastKind, string> = { info: "Note:", success: "Done:", warning: "Warning:", error: "Error:" }

/**
 * The one toast on screen. A composer on screen draws it as a bubble rising out of its top edge
 * (app/composer/ToastBubble.tsx); with none, it rises alone from the window's foot, drawn here. Either way it
 * waits while a pop-up is open and leaves sooner when more are queued, and a screen reader hears it from here.
 */
export function Toaster() {
  const { item, waiting } = useToast()
  const blocked = useAnyOverlay()
  const hosted = useToastHosted()
  const showing = item && !blocked ? item : undefined

  useEffect(() => {
    if (!item || blocked) return
    const timer = window.setTimeout(() => dismissToast(item.id), waiting > 0 ? Math.min(item.duration, 1600) : item.duration)
    return () => window.clearTimeout(timer)
  }, [item, blocked, waiting])

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {showing ? `${KIND_WORDS[showing.kind]} ${showing.message}` : ""}
      </div>
      <LoneToast enabled={!hosted} />
    </>
  )
}

/** The toast with no composer to rise from: the same bubble, coming up from below the window's foot. */
function LoneToast({ enabled }: { enabled: boolean }) {
  const toast = useToastBubble(enabled, "floor")
  if (!toast.item) return null
  return (
    <div className="bubble toast-lone" style={toast.vars}>
      <BubbleFilters id="toast" />
      <div className="bubble-layer bubble-edge" aria-hidden="true">
        <ToastShape t={toast} />
      </div>
      <div className="bubble-layer bubble-fill" aria-hidden="true">
        <ToastShape t={toast} />
      </div>
      <div className="bubble-real">
        <ToastBody t={toast} />
      </div>
    </div>
  )
}
