/** The small pieces the settings groups share: a row, a card of rows, a searchable drop-down. */
import type { ReactNode } from "react"
import { Combobox } from "@/components/ui/combobox"
import { Frame, FramePanel } from "@/components/reui/frame"

export interface ChoiceItem {
  value: string
  label: string
  help?: string
}

/** A setting as a row: its name and help on the left, the control on the right (or below, `stacked`). */
export function Field({ label, help, children, stacked }: { label: string; help?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? "grid gap-1.5" : "grid gap-1.5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:items-center md:gap-6"}>
      <div className="min-w-0 break-words">
        <div className="break-words text-[0.8125rem] font-medium">{label}</div>
        {help ? <p className="break-words text-xs text-muted-foreground">{help}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}


/** Several settings in one card, hairlines between them. */
export function Rows({ children }: { children: ReactNode }) {
  return <Frame dense><FramePanel className="flex flex-col divide-y divide-border py-0 [&>*]:py-3">{children}</FramePanel></Frame>
}

/** Every drop-down on the page is a searchable one. */
export function Choice({ value, items, label, onChange }: { value: string; items: ChoiceItem[]; label: string; onChange: (value: string) => void }) {
  return <Combobox value={value} options={items.map((item) => ({ value: item.value, label: item.label, ...(item.help ? { hint: item.help } : {}) }))} label={label} onChange={onChange} className="max-md:h-auto max-md:min-h-11 max-md:items-start max-md:py-2 max-md:[&>span:first-child]:overflow-visible max-md:[&>span:first-child]:text-clip max-md:[&>span:first-child]:whitespace-normal max-md:[&>span:first-child]:break-words" />
}

