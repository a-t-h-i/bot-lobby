/**
 * `Alt+H`: the web key map as a modal sheet (batch-1 §e). One column at
 * 768 px, two at 1280 px and up. Any key or Esc closes it, as the terminal
 * does; the section titles and help lines come from the server's key table.
 */
import { useEffect } from "react"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { KeyInfo, TabInfo } from "@protocol"

function KeyRow({ info }: { info: KeyInfo }) {
  return (
    <div className="flex items-baseline gap-3 py-0.5">
      <Kbd className="min-w-16 justify-center">{info.label}</Kbd>
      <span className="text-sm text-muted-foreground">{info.help}</span>
    </div>
  )
}

function Section({ title, keys }: { title: string; keys: KeyInfo[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
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
  useEffect(() => {
    if (!open) return
    const close = () => onOpenChange(false)
    window.addEventListener("keydown", close, true)
    return () => window.removeEventListener("keydown", close, true)
  }, [open, onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[80svh] gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>Keys</SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-6 p-4 xl:grid-cols-2">
            <div className="flex flex-col gap-6">
              <Section title="Everywhere" keys={keys} />
            </div>
            <Section title="Tabs" keys={tabKeys(tabs)} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
