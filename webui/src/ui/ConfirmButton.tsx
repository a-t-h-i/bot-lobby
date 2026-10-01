/**
 * A button that asks before it acts, for the actions that cannot be taken
 * back (delete, discard, cancel, archive of a task under way). The dialog's
 * focus starts on Cancel, so Enter never confirms by accident.
 */
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

interface ConfirmButtonProps {
  label: string
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  icon?: ReactNode
  disabled?: boolean
  /** The trigger's look; the confirm button turns destructive for `destructive`. */
  variant?: "outline" | "destructive"
}

export function ConfirmButton({ label, title, description, confirmLabel, onConfirm, icon, disabled, variant = "outline" }: ConfirmButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} className="h-10" disabled={disabled}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
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
