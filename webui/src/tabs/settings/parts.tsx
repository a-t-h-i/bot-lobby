/** The small pieces the settings groups share: a row, a card of rows, a searchable drop-down. */
import type { ReactNode } from "react"
import { Combobox } from "@/components/ui/combobox"
import { Frame, FramePanel } from "@/components/reui/frame"

export interface ChoiceItem {
  value: string
  label: string
  help?: string
  /** Listed and searchable, but cannot be picked. */
  disabled?: boolean
}

/** A setting as a row: its name and help on the left, the control on the right (or below, `stacked`). */
export function Field({ label, help, children, stacked }: { label: string; help?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? "grid gap-1" : "grid grid-cols-[minmax(0,1fr)_minmax(0,332px)] items-center gap-4"}>
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
  return <Frame dense><FramePanel className="flex flex-col divide-y divide-border py-0 [&>*]:py-2">{children}</FramePanel></Frame>
}

/** Every drop-down on the page is a searchable one. */
export function Choice({ value, items, label, disabled, onChange }: { value: string; items: ChoiceItem[]; label: string; disabled?: boolean; onChange: (value: string) => void }) {
  const options = items.map((item) => ({ value: item.value, label: item.label, ...(item.help ? { hint: item.help } : {}), ...(item.disabled ? { disabled: item.disabled } : {}) }))
  return <Combobox value={value} options={options} label={label} disabled={disabled} onChange={onChange} />
}

