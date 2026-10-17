// Adapted from T3 Code (MIT), apps/web/src/components/chat/ComposerPrimaryActions.tsx
/**
 * The composer's actions at the right of its footer, as the coding harness
 * draws them: a round send button with the arrow, a spinner while it sends,
 * and a round, muted red stop button while the oracle works. Stop still asks first
 * (the reply in progress is lost), on the page's own confirm dialog.
 */
import { useState } from "react"
import { Keys } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-stop-action text-white shadow-xs shadow-stop-action/24 inset-shadow-control-highlight transition-colors duration-150 outline-none hover:bg-stop-action-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:inset-shadow-control-pressed active:shadow-none pointer-coarse:after:absolute pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&_svg]:pointer-events-none"
            onPointerDown={preventPointerFocus}
            onClick={() => setAsking(true)}
            aria-label="Stop"
            aria-haspopup="dialog"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" rx="1.5" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Interrupt</TooltipContent>
      </Tooltip>
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
  const label = steering ? "Steer message" : "Send"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            className={cn(
              "relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-xs outline-none transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-control-highlight hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none disabled:hover:scale-100 motion-reduce:hover:scale-100 sm:h-8 sm:w-8 [&_svg]:pointer-events-none",
              "bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover",
            )}
            onPointerDown={preventPointerFocus}
            onClick={onSend}
            disabled={disabled}
            aria-label="Send"
            aria-keyshortcuts="Enter"
          >
            {sending ? (
              <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label} <Keys chord="Enter" />
      </TooltipContent>
    </Tooltip>
  )
}
