/**
 * `Alt+H`: the key map in a pop-up in the middle of the window. Esc closes
 * it, or any other key. The lines for the whole page and the tabs come from
 * the server's key table; the message box and pop-up keys are the page's own.
 */
import { useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd, Keys } from "@/components/ui/kbd"
import { Popup } from "@/components/ui/popup"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import type { KeyInfo, TabInfo } from "@protocol"

/** One line of the table: the caps, then what they do. */
interface Line {
  id: string
  /** A chord such as `Alt+H`, printed as its caps... */
  label?: string
  /** ...or caps that are alternatives, printed side by side. */
  caps?: string[]
  help: string
}

/** Keys the page handles itself, beside the server's table. */
const MESSAGE_BOX: Line[] = [
  { id: "send", label: "Enter", help: "send the message" },
  { id: "newline", label: "Shift+Enter", help: "a new line" },
  { id: "sendAlt", label: "Ctrl+Enter", help: "send from anywhere in the box" },
]

const POPUPS: Line[] = [
  { id: "esc", label: "Esc", help: "close this, or put a question away for later" },
  { id: "digits", caps: ["1", "2", "…"], help: "choose that option in a question" },
  { id: "arrows", caps: ["←", "→"], help: "move between tabs while the tab bar has focus" },
]

function KeyRow({ line }: { line: Line }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="flex w-28 shrink-0 items-center">
        {line.caps ? (
          <span className="inline-flex items-center gap-1">
            {line.caps.map((cap) => (
              <Kbd key={cap}>{cap}</Kbd>
            ))}
          </span>
        ) : (
          <Keys chord={line.label ?? ""} />
        )}
      </span>
      <span className="text-sm text-muted-foreground">{line.help}</span>
    </div>
  )
}

function Section({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {lines.map((line) => (
        <KeyRow key={line.id} line={line} />
      ))}
    </section>
  )
}

function fromKeys(keys: KeyInfo[]): Line[] {
  return keys.map((info) => ({ id: info.action, label: info.label, help: info.help }))
}

function tabKeys(tabs: TabInfo[]): Line[] {
  return tabs.map((tab) => ({ id: `tab.${tab.id}`, label: tab.key, help: `jump to the ${tab.label} tab` }))
}

export function AltH({
  open,
  onOpenChange,
  keys,
  tabs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  keys: KeyInfo[]
  tabs: TabInfo[]
}) {
  const shown = useOverlaySlot(open, PRIORITY.help)

  useEffect(() => {
    if (!open) return
    const close = () => onOpenChange(false)
    window.addEventListener("keydown", close, true)
    return () => window.removeEventListener("keydown", close, true)
  }, [open, onOpenChange])

  return (
    <Popup open={open && shown} onOpenChange={onOpenChange} label="Keys" className="max-w-4xl">
      <header className="flex items-center justify-between gap-3 px-6 pt-5 pb-2">
        <h2 aria-hidden="true" className="text-base font-medium">
          Keyboard shortcuts
        </h2>
        <span className="flex items-center gap-2">
          <Keys chord="Esc" />
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X aria-hidden="true" />
          </Button>
        </span>
      </header>
      <div className="grid min-h-0 flex-1 gap-x-10 gap-y-6 overflow-y-auto px-6 pt-2 pb-6 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Section title="Everywhere" lines={fromKeys(keys)} />
          <Section title="Message box" lines={MESSAGE_BOX} />
        </div>
        <div className="flex flex-col gap-6">
          <Section title="Jump to a tab" lines={tabKeys(tabs)} />
          <Section title="Pop-ups and tabs" lines={POPUPS} />
        </div>
      </div>
    </Popup>
  )
}
