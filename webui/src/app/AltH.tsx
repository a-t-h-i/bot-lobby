/**
 * `Alt+H`: the key map in a pop-up in the middle of the window. Esc closes
 * it, or any other key; the lines come from the server's key table.
 */
import { useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Popup } from "@/components/ui/popup"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import type { KeyInfo, TabInfo } from "@protocol"

function KeyRow({ info }: { info: KeyInfo }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <Kbd className="min-w-16 justify-center">{info.label}</Kbd>
      <span className="text-sm text-muted-foreground">{info.help}</span>
    </div>
  )
}

function Section({ title, keys }: { title: string; keys: KeyInfo[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {keys.map((info) => (
        <KeyRow key={info.action} info={info} />
      ))}
    </section>
  )
}

function tabKeys(tabs: TabInfo[]): KeyInfo[] {
  return tabs.map((tab) => ({
    action: `tab.${tab.id}`,
    key: tab.key,
    label: tab.key,
    help: `jump to the ${tab.label} tab`,
  }))
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
    <Popup open={open && shown} onOpenChange={onOpenChange} label="Keys" className="max-w-3xl">
      <header className="flex items-center justify-between px-6 pt-5 pb-2">
        <h2 className="text-base font-semibold">Keys</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 gap-8 overflow-y-auto px-6 pt-2 pb-6 md:grid-cols-2">
        <Section title="Everywhere" keys={keys} />
        <Section title="Tabs" keys={tabKeys(tabs)} />
      </div>
    </Popup>
  )
}
