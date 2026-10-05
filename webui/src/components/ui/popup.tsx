import type { ReactNode } from "react"
import { Dialog } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

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
export function Popup({ open, onOpenChange, label, description, dismissOnBackdrop = true, className, onCloseAutoFocus, children }: PopupProps) {
  const reduceMotion = useReducedMotion()
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
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
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
                  className={cn("glass-pop pointer-events-auto flex max-h-[min(86svh,48rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl outline-none", className)}
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.92, y: reduceMotion ? 0 : 18 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.96, y: reduceMotion ? 0 : 8, transition: { duration: 0.12, ease: "easeIn" } }}
                  transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.9 }}
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
