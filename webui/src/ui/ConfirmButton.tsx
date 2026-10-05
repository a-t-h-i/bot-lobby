/**
 * A button that asks before it acts, for the actions that cannot be taken
 * back (delete, discard, cancel, archive of a task under way). The dialog's
 * focus starts on Keep it, so Enter never confirms by accident; `Y` confirms
 * and Esc keeps, and both keys are printed on their buttons.
 */
import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Keys } from "@/components/ui/kbd"
import { useHotkey } from "@/lib/hotkeys"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { ActionButton } from "./Actions"
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

interface ConfirmButtonProps {
  /** What the button does: its accessible name. */
  label: string
  /** The word printed on it, when shorter than `label`. */
  text?: string
  /** The key that opens the question: `Delete`, `E`. */
  shortcut?: string
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  icon: LucideIcon
  disabled?: boolean
  /** The trigger's tone; the confirm button turns destructive for `destructive`. */
  variant?: "outline" | "destructive"
  iconOnly?: boolean
}

export function ConfirmButton({ label, text, shortcut, title, description, confirmLabel, onConfirm, icon, disabled, variant = "outline", iconOnly }: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false)
  const shown = useOverlaySlot(asking, PRIORITY.confirm)
  const destructive = variant === "destructive"
  const confirm = () => {
    setAsking(false)
    onConfirm()
  }
  useHotkey("y", confirm, { enabled: asking && shown, inDialog: true })
  return (
    <AlertDialog open={asking && shown} onOpenChange={setAsking}>
      <ActionButton
        label={label}
        icon={icon}
        tone={destructive ? "danger" : "neutral"}
        disabled={disabled}
        shortcut={shortcut}
        iconOnly={iconOnly}
        {...(text ? { text } : {})}
        onClick={() => setAsking(true)}
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            Keep it
            <Keys chord="Esc" className="kbd-hint ml-1" />
          </AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
            <Keys chord="Y" className="kbd-hint ml-1" />
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
