import { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/reui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type DateRange = { from?: string; to?: string }
const PERIODS = [{ value: "all", label: "All time" }, { value: "today", label: "Today" }, { value: "week", label: "Past 7 days" }, { value: "range", label: "Date range" }]

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function DateFilter({ onChange }: { onChange: (range: DateRange) => void }) {
  const [period, setPeriod] = useState("all")
  const today = localDate(new Date())
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [error, setError] = useState("")

  function choose(value: string) {
    setPeriod(value)
    setError("")
    if (value === "all") onChange({})
    else if (value === "range") { if (from && to && from <= to) onChange({ from, to }) }
    else {
      const start = new Date()
      if (value === "week") start.setDate(start.getDate() - 6)
      onChange({ from: localDate(start), to: today })
    }
  }

  return <div className="flex min-w-0 flex-wrap items-end gap-3">
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Period</span>
      <Select value={period} onValueChange={choose}>
        <SelectTrigger aria-label="Metrics period"><SelectValue /></SelectTrigger>
        <SelectContent>{PERIODS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {period === "range" ? <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault()
      if (!from || !to || from > to) { setError("Choose an end date on or after the start date."); return }
      setError("")
      onChange({ from, to })
    }}>
      <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">Start date
        <Input type="date" required value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 w-36 max-w-full text-xs" />
      </label>
      <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">End date
        <Input type="date" required value={to} onChange={(event) => setTo(event.target.value)} className="h-9 w-36 max-w-full text-xs" />
      </label>
      <Button type="submit" size="sm" className="h-9">Apply</Button>
      {error ? <p role="alert" className="w-full text-xs text-destructive">{error}</p> : null}
    </form> : null}
  </div>
}
