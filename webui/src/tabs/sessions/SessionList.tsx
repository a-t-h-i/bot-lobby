/**
 * The session list: sections This window, Background and Other terminals,
 * each headed with its count; a row per session with where it runs, its name,
 * its status and a badge for the questions it waits on you for.
 */
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Rule } from "@/ui/Frame"
import { WhereIcon } from "./WhereIcon"
import { SECTION_OF, SECTION_ORDER, type Entry, type Where } from "./words"

function Row({ entry, selected, onSelect }: { entry: Entry; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry.id)}
        className="flex min-h-9 w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=true]:bg-accent"
      >
        <WhereIcon where={entry.where} className="mt-0.5" />
        <span className={cn("min-w-0 flex-1 break-words text-foreground", selected && "font-medium")}>{entry.name}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {entry.status === "working" || entry.status === "starting" ? <Spinner className="size-3" aria-hidden="true" /> : null}
          {entry.status.replace(/_/g, " ")}
          {entry.waiting > 0 ? <span className="rounded-lg bg-warning/15 px-2 py-0.5 font-medium text-warning tabular-nums">{entry.waiting}</span> : null}
        </span>
      </button>
    </li>
  )
}

function Group({ where, entries, selectedId, onSelect }: { where: Where; entries: Entry[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <section aria-label={SECTION_OF[where]} className="flex flex-col gap-1">
      <h3 className="px-4 pt-2 text-xs">
        <Rule title={SECTION_OF[where]} right={String(entries.length)} className="[&>span:first-child]:font-medium [&>span:first-child]:text-muted-foreground" />
      </h3>
      <ul className="flex flex-col gap-0.5 px-2">
        {entries.map((entry) => (
          <Row key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  )
}

export function SessionList({ entries, selectedId, onSelect }: { entries: Entry[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2 pb-2">
      {SECTION_ORDER.map((where) => {
        const group = entries.filter((entry) => entry.where === where)
        return group.length > 0 ? <Group key={where} where={where} entries={group} selectedId={selectedId} onSelect={onSelect} /> : null
      })}
    </div>
  )
}
