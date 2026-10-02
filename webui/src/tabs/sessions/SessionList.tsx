/**
 * The session list (batch-2 §i): sections THIS WINDOW, BACKGROUND and OTHER
 * TERMINALS, each headed by a rule with its count, as the terminal heads them (D-21); a 44 px row per session with the
 * where-mark, name, status and the ● n questions badge.
 */
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Rule } from "@/ui/Frame"
import { SECTION_OF, SECTION_ORDER, WHERE_MARKS, type Entry, type Where } from "./words"

function Row({ entry, selected, onSelect }: { entry: Entry; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry.id)}
        className="flex min-h-11 w-full items-start gap-2 rounded-sm px-[1ch] py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=true]:bg-accent"
      >
        <span className="w-4 shrink-0 text-center text-foreground" aria-hidden="true">
          {WHERE_MARKS[entry.where]}
        </span>
        <span className={cn("min-w-0 flex-1 break-words text-foreground", selected && "font-medium")}>{entry.name}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {entry.status === "working" || entry.status === "starting" ? <Spinner className="size-3" aria-hidden="true" /> : null}
          {entry.status.replace(/_/g, " ")}
          {entry.waiting > 0 ? <span className="font-medium text-foreground">● {entry.waiting}</span> : null}
        </span>
      </button>
    </li>
  )
}

function Group({ where, entries, selectedId, onSelect }: { where: Where; entries: Entry[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <section aria-label={SECTION_OF[where]} className="flex flex-col gap-1">
      <h3 className="px-[1ch] pt-2 text-sm">
        <Rule title={SECTION_OF[where]} right={String(entries.length)} />
      </h3>
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry) => (
          <Row key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  )
}

export function SessionList({ entries, selectedId, onSelect }: { entries: Entry[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2 p-1">
      {SECTION_ORDER.map((where) => {
        const group = entries.filter((entry) => entry.where === where)
        return group.length > 0 ? <Group key={where} where={where} entries={group} selectedId={selectedId} onSelect={onSelect} /> : null
      })}
    </div>
  )
}
