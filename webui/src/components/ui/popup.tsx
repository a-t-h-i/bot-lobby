/** Adapted from T3 Code (MIT), apps/web/src/components/ui/dialog.tsx and dialog-styles.ts. */
import type { CSSProperties, ReactNode } from "react"
import { Dialog } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/app/hooks"
import { usePhoneViewport } from "@/app/usePhoneViewport"

interface PhonePopupBounds {
  wrapper: CSSProperties
  content: CSSProperties
}

interface PopupProps {
  open: boolean
  /** Called when Escape, the backdrop or a close control asks to close it. */
  onOpenChange?: (open: boolean) => void
  /** The popup's accessible name. */
  label: string
  /** Read by screen readers when the popup opens. */
  description?: string
  /** When false, clicking the backdrop never closes it (a question keeps its answers). */
  dismissOnBackdrop?: boolean
  className?: string
  /** Inline style for the pane (a caller's colour variables). */
  style?: CSSProperties
  /** Where focus goes when it closes (the control that opened it, unless the caller says otherwise). */
  onCloseAutoFocus?: (event: Event) => void
  children: ReactNode
}

/**
 * Every pop-up in the page: a pane that springs up in the middle of
 * the window over a backdrop blurred a little (`backdrop-blur-sm`). Callers
 * show it only while they hold the page's one overlay slot (see
 * `lib/overlay.ts`), so two never stack.
 */
function phonePopupBounds(phone: boolean, keyboardOpen: boolean, keyboardInset: number): PhonePopupBounds | undefined {
  if (!phone || typeof window === "undefined") return undefined
  const viewport = window.visualViewport
  const height = viewport?.height ?? Math.max(0, window.innerHeight - (keyboardOpen ? keyboardInset : 0))
  const top = Math.max(0, viewport?.offsetTop ?? 0)
  return {
    wrapper: { top: `${top}px`, bottom: "auto", height: `${height}px` },
    content: { width: "calc(100vw - 24px)", maxWidth: "calc(100vw - 24px)", maxHeight: `${Math.max(0, height - 32)}px` },
  }
}

export function Popup({ open, onOpenChange, label, description, dismissOnBackdrop = true, className, style, onCloseAutoFocus, children }: PopupProps) {
  const reduceMotion = useReducedMotion()
  const phone = useMediaQuery("(max-width: 767.98px)")
  const { keyboardOpen, keyboardInset } = usePhoneViewport()
  const bounds = phonePopupBounds(phone, keyboardOpen, keyboardInset)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              />
            </Dialog.Overlay>
            <div className={cn("pointer-events-none fixed inset-0 z-50 grid place-items-center", phone ? "p-3" : "p-4")} style={bounds?.wrapper}>
              <Dialog.Content
                asChild
                forceMount
                onCloseAutoFocus={onCloseAutoFocus}
                onInteractOutside={(event) => {
                  if (!dismissOnBackdrop) event.preventDefault()
                }}
                onOpenAutoFocus={(event) => {
                  // A pop-up that holds options or a text field puts focus there, not on its close button.
                  const first = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-nav], [data-autofocus], textarea")
                  if (first) {
                    event.preventDefault()
                    first.focus()
                  }
                }}
                {...(description ? {} : { "aria-describedby": undefined })}
              >
                <motion.div
                  className={cn("glass-pop pointer-events-auto flex max-h-[min(86svh,48rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl outline-none", className)}
                  style={{ ...style, ...(bounds?.content ?? {}) }}
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.98, y: reduceMotion ? 0 : 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.98, transition: { duration: 0.15, ease: "easeIn" } }}
                  transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                >
                  <Dialog.Title className="sr-only">{label}</Dialog.Title>
                  {description ? <Dialog.Description className="sr-only">{description}</Dialog.Description> : null}
                  {children}
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
