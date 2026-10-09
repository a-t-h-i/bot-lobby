/**
 * The session list: sections This window, Background and Other terminals,
 * each headed with its count; a row per session with where it runs, its name,
 * its status and a badge for the questions it waits on you for.
 */
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"
import { Rule } from "@/ui/Frame"
import { GROUP, ROW } from "@/ui/rows"
import { WhereIcon } from "./WhereIcon"
import { SECTION_OF, SECTION_ORDER, type Entry, type Where } from "./words"

function Row({ entry, selected, onSelect }: { entry: Entry; selected: boolean; onSelect: (id: string) => void }) {
  const reduce = useReducedMotion()
  return (
    // Adapted from ObsidianUI Active Sessions; session actions still use the lobby API.
    // https://github.com/Atharvsinh-codez/ObsidianUI/blob/main/src/components/block/active-sessions.tsx
    <motion.li layout={reduce ? false : "position"} initial={false} data-slot="active-session" className="border-t border-border first:border-t-0">
      <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
        type="button"
        data-row
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry.id)}
        className={cn(ROW, "flex-row items-start gap-3 rounded-none px-4 py-3 text-sm focus-visible:ring-inset")}
      >
        <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground/4 text-foreground/75 shadow-[inset_0_0_0_1px_var(--border)]">
          <WhereIcon where={entry.where} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("flex flex-wrap items-center gap-2 break-words text-foreground", selected && "font-medium")}>
            {entry.name}
            {entry.where === "this window" ? <Badge variant="secondary" radius="full" size="sm">This window</Badge> : null}
          </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {entry.status === "working" || entry.status === "starting" ? <Spinner className="size-3" aria-hidden="true" /> : null}
          {entry.status.replace(/_/g, " ")}
          {entry.waiting > 0 ? <Badge variant="warning-light" radius="full" className="text-warning tabular-nums">{entry.waiting} waiting</Badge> : null}
        </span>
        </span>
      </button>
    </motion.li>
  )
}

function Group({ where, entries, selectedId, onSelect }: { where: Where; entries: Entry[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <section aria-label={SECTION_OF[where]} className="flex flex-col">
      <h3 className={GROUP}>
        <Rule title={SECTION_OF[where]} right={String(entries.length)} className="[&>span:first-child]:font-medium [&>span:first-child]:text-muted-foreground" />
      </h3>
      <ul className="workspace-section mx-3 mb-2 flex flex-col overflow-hidden rounded-xl border shadow-xs">
        {entries.map((entry) => (
          <Row key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  )
}

export function SessionList({ entries, selectedId, onSelect }: { entries: Entry[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col pb-2">
      {SECTION_ORDER.map((where) => {
        const group = entries.filter((entry) => entry.where === where)
        return group.length > 0 ? <Group key={where} where={where} entries={group} selectedId={selectedId} onSelect={onSelect} /> : null
      })}
    </div>
  )
}
