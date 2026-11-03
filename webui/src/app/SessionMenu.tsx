/**
 * A session row's "…" menu, after the Claude app's sidebar menu: Rename, then Archive and Delete under a rule,
 * each with its letter at the end (the letter picks it while the menu is open). Delete asks first, in a
 * confirmation anchored to the "…" button. While the menu or the question is open the sidebar stays open.
 */
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { DropdownMenu } from "radix-ui"
import { Ellipsis } from "lucide-react"
import { Keys } from "@/components/ui/kbd"
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
import { useHotkey } from "@/lib/hotkeys"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"

/** Holds the sidebar open while a row's menu or question is up (the menu sits outside the sidebar). */
export const HoldBay = createContext<(held: boolean) => void>(() => {})

interface Item {
  key: string
  label: string
  run: () => void
  danger?: boolean
  /** A rule above this item. */
  rule?: boolean
}

export function SessionMenu({ name, onRename, onArchive, onDelete, onOpenChange }: {
  name: string
  onRename?: () => void
  onArchive?: () => void
  onDelete?: () => void
  onOpenChange?: (open: boolean) => void
}) {
  const hold = useContext(HoldBay)
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const shown = useOverlaySlot(asking, PRIORITY.confirm)
  // Rename moves focus into its field, so the menu must not hand focus back to the "…" button as it closes.
  const keepFocus = useRef(false)
  const busy = open || asking
  useEffect(() => {
    hold(busy)
    onOpenChange?.(busy)
  }, [busy, hold, onOpenChange])
  useEffect(() => () => hold(false), [hold])
  const remove = () => {
    setAsking(false)
    onDelete?.()
  }
  useHotkey("y", remove, { enabled: asking && shown, inDialog: true })

  const items: Item[] = []
  if (onRename) items.push({ key: "R", label: "Rename", run: () => { keepFocus.current = true; onRename() } })
  if (onArchive) items.push({ key: "A", label: "Archive", run: onArchive, rule: items.length > 0 })
  if (onDelete) items.push({ key: "D", label: "Delete", run: () => setAsking(true), danger: true, rule: items.length > 0 && !onArchive })

  const pick = (item: Item) => {
    setOpen(false)
    // Let the menu close before the action opens its own field or question.
    window.setTimeout(item.run, 0)
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const item = items.find((one) => one.key.toLowerCase() === event.key.toLowerCase())
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    pick(item)
  }

  return (
    <AlertDialog open={asking && shown} onOpenChange={setAsking}>
      <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label={`More for ${name}`} className="cs-sact cs-smore">
            <Ellipsis aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            side="bottom"
            sideOffset={6}
            collisionPadding={12}
            loop
            onKeyDown={onKey}
            onCloseAutoFocus={(event) => {
              if (keepFocus.current) event.preventDefault()
              keepFocus.current = false
            }}
            className="reui-menu cs-smenu"
          >
            {items.map((item) => (
              <div key={item.key} className="contents">
                {item.rule ? <DropdownMenu.Separator className="cs-smenu-rule" /> : null}
                <DropdownMenu.Item
                  className="cs-smenu-item"
                  data-danger={item.danger || undefined}
                  aria-keyshortcuts={item.key}
                  onSelect={(event) => {
                    event.preventDefault()
                    pick(item)
                  }}
                >
                  <span>{item.label}</span>
                  <kbd className="cs-smenu-key">{item.key}</kbd>
                </DropdownMenu.Item>
              </div>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>Its conversation file is removed for good. Archive it instead to keep it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            Cancel
            <Keys chord="Esc" className="kbd-hint ml-1" />
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove}>
            Delete
            <Keys chord="Y" className="kbd-hint ml-1" />
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
