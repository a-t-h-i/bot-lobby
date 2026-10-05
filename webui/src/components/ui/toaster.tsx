import { useEffect } from "react"
import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"
import { useAnyOverlay } from "@/lib/overlay"
import { dismissToast, useToast, type ToastKind } from "@/lib/toast"
import { cn } from "@/lib/utils"

const ICONS: Record<ToastKind, typeof Info> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }
const TONES: Record<ToastKind, string> = { info: "text-primary", success: "text-success", warning: "text-warning", error: "text-destructive" }

/**
 * The one toast on screen: it scales up with a bounce just above the composer,
 * on a pane with a light blur behind it (the composer's height is `--composer-h`). It waits while a pop-up is
 * open and leaves sooner when more are queued.
 */
export function Toaster() {
  const { item, waiting } = useToast()
  const blocked = useAnyOverlay()
  const showing = item && !blocked

  useEffect(() => {
    if (!item || blocked) return
    const timer = window.setTimeout(() => dismissToast(item.id), waiting > 0 ? Math.min(item.duration, 1600) : item.duration)
    return () => window.clearTimeout(timer)
  }, [item, blocked, waiting])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: "calc(var(--composer-h, 0px) + 0.25rem)" }}
    >
      <AnimatePresence mode="wait">
        {showing ? (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, scale: 0.55, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 6, transition: { duration: 0.14, ease: "easeIn" } }}
            transition={{ type: "spring", stiffness: 560, damping: 15, mass: 0.8 }}
            className="pointer-events-auto flex max-w-[min(32rem,100%)] items-center gap-3 rounded-xl border border-glass-border bg-popover/80 px-4 py-2.5 text-sm text-popover-foreground shadow-glass backdrop-blur-xs"
          >
            <ToastIcon kind={item.kind} />
            <span className="min-w-0 break-words">{item.message}</span>
            {item.action ? (
              <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
                type="button"
                className="btn-raised -my-1.5 -mr-1 h-7 shrink-0 rounded-lg border bg-card px-2.5 font-medium text-primary transition-[box-shadow,translate] active:translate-y-px focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                onClick={() => {
                  item.action?.onClick()
                  dismissToast(item.id)
                }}
              >
                {item.action.label}
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  const Icon = ICONS[kind]
  return <Icon aria-hidden="true" className={cn("size-5 shrink-0", TONES[kind])} />
}
