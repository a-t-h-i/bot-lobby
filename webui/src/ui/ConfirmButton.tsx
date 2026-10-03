/**
 * A button that asks before it acts, for the actions that cannot be taken
 * back (delete, discard, cancel, archive of a task under way). The dialog's
 * focus starts on Cancel, so Enter never confirms by accident.
 */
import { useState } from "react"
import type { LucideIcon } from "lucide-react"
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
  /** What the icon button does: its tooltip and accessible name. */
  label: string
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  icon: LucideIcon
  disabled?: boolean
  /** The trigger's tone; the confirm button turns destructive for `destructive`. */
  variant?: "outline" | "destructive"
}

export function ConfirmButton({ label, title, description, confirmLabel, onConfirm, icon, disabled, variant = "outline" }: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false)
  const shown = useOverlaySlot(asking, PRIORITY.confirm)
  return (
    <AlertDialog open={asking && shown} onOpenChange={setAsking}>
      <ActionButton label={label} icon={icon} tone={variant === "destructive" ? "danger" : "neutral"} disabled={disabled} onClick={() => setAsking(true)} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant={variant === "destructive" ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
