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
import { goKey } from "@/tabs/registry"
import { matchKey } from "./useLobbyKeys"

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
  { id: "focus", caps: ["/"], help: "focus search, or the message box" },
  { id: "send", label: "Enter", help: "send the message" },
  { id: "newline", label: "Shift+Enter", help: "a new line (lists carry on)" },
  { id: "format", label: "Ctrl+B", help: "bold; Ctrl+I italic, Ctrl+E code, Ctrl+K link" },
  { id: "leave", label: "Esc", help: "leave the box for the tab bar" },
]

const NAVIGATION: Line[] = [
  { id: "digits", caps: ["1", "…", "9"], help: "jump to a tab in current order" },
  { id: "help", caps: ["?"], help: "keyboard shortcuts" },
  ...Object.entries(goKey).map(([key, tab]) => ({ id: `go.${tab}`, caps: ["g", key], help: `jump to ${tab}` })),
  { id: "project", caps: ["P"], help: "open the project switcher" },
  { id: "theme", caps: ["D"], help: "switch between light and dark" },
  { id: "edit", label: "Ctrl+Enter", help: "save an edited message; Esc cancels" },
]

/** The keys on each page's buttons: press one with the list or the detail focused, not the message box. */
const PAGES: Array<{ id: string; page: string; keys: Array<[string, string]> }> = [
  { id: "tasks", page: "Tasks", keys: [["E", "archive"], ["R", "restore"], ["A", "auto mode"], ["Delete", "delete"]] },
  { id: "saved", page: "Saved plan", keys: [["S", "start here"], ["N", "new session"], ["Delete", "discard"]] },
  { id: "plan", page: "Plan", keys: [["A", "answer"], ["R", "retry"], ["Ctrl+S", "save"], ["N", "new plan"]] },
  { id: "quickfix", page: "Quick fix", keys: [["R", "run anyway"], ["T", "make a task"], ["C", "cancel"]] },
  { id: "git", page: "Git", keys: [["R", "refresh"], ["V", "review"], ["Q", "Jev's read"], ["X", "stop"]] },
  { id: "issues", page: "Issues", keys: [["R", "refresh"]] },
  { id: "knowledge", page: "Knowledge", keys: [["E", "edit"], ["A", "add"], ["C", "comment"], ["F", "edit file"], ["Delete", "delete"]] },
  { id: "excalidraw", page: "Excalidraw", keys: [["R", "reveal"], ["C", "copy"], ["O", "open"], ["W", "draw"], ["T", "check"], ["Delete", "remove"]] },
  { id: "sessions", page: "Sessions", keys: [["M", "move here"], ["S", "stop"], ["B", "back"]] },
  { id: "confirm", page: "Asked to confirm", keys: [["Y", "yes, do it"], ["Esc", "keep it"]] },
]

const LISTS: Line[] = [
  { id: "enter", caps: ["↓"], help: "from the tab bar, into the page" },
  { id: "rows", caps: ["↑", "↓"], help: "move through a list (j and k work too)" },
  { id: "pane", caps: ["←", "→"], help: "between a list and its detail (h and l)" },
  { id: "ends", caps: ["Home", "End"], help: "first and last row" },
  { id: "open", caps: ["Enter", "Space"], help: "activate the focused button or row (links: Enter; checkboxes: Space)" },
  { id: "back", label: "Esc", help: "back up to the tab bar" },
]

const QUESTIONS: Line[] = [
  { id: "qmove", caps: ["↑", "↓"], help: "move between the options" },
  { id: "qpick", label: "Space", help: "pick an option (several when allowed)" },
  { id: "qchoose", label: "Enter", help: "choose and go on; in your own answer, send it" },
  { id: "qacross", caps: ["←", "→"], help: "previous and next question" },
  { id: "qdigit", caps: ["1", "2", "…"], help: "pick that option" },
  { id: "qesc", label: "Esc", help: "put the question away for later" },
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

function PageKeys() {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Buttons on a page</h3>
      {PAGES.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 py-1">
          <span className="w-28 shrink-0 pt-0.5 text-sm font-medium">{entry.page}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
            {entry.keys.map(([chord, help]) => (
              <span key={chord} className="inline-flex items-center gap-1.5">
                <Keys chord={chord} />
                {help}
              </span>
            ))}
          </span>
        </div>
      ))}
    </section>
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
    if (!open || !shown) return
    // Do not consume activation, typing or focus movement inside the dialog.
    const close = (event: KeyboardEvent) => {
      const helpKey = keys.find((key) => key.action === "help")?.key
      if (event.key === "Escape" || (helpKey && matchKey(event, helpKey))) { event.preventDefault(); onOpenChange(false) }
    }
    window.addEventListener("keydown", close, true)
    return () => window.removeEventListener("keydown", close, true)
  }, [open, shown, onOpenChange, keys])

  return (
    <Popup open={open && shown} onOpenChange={onOpenChange} label="Keys" className="max-w-4xl">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <h2 aria-hidden="true" className="text-base font-semibold tracking-tight">
          Keyboard shortcuts
        </h2>
        <span className="flex items-center gap-2">
          <Keys chord="Esc" />
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X aria-hidden="true" />
          </Button>
        </span>
      </header>
      <div className="grid min-h-0 flex-1 gap-x-10 gap-y-6 overflow-y-auto px-6 py-5 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Section title="Everywhere" lines={fromKeys(keys)} />
          <Section title="Jump to a tab" lines={tabKeys(tabs)} />
          <Section title="Navigation and editing" lines={NAVIGATION} />
          <Section title="Message box" lines={MESSAGE_BOX} />
        </div>
        <div className="flex flex-col gap-6">
          <Section title="Lists and panes" lines={LISTS} />
          <PageKeys />
          <Section title="Questions" lines={QUESTIONS} />
        </div>
      </div>
    </Popup>
  )
}
