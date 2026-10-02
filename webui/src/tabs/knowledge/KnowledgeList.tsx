/**
 * The Knowledge file list (batch-2 §l): files grouped by agent under
 * `Master (oracle)`, `Designer`, `Backend`, `QA`, each row a 44 px button with
 * its size, `· over` compaction mark and `✎ n` notes.
 */
import type { KnowledgeFileInfo } from "@protocol"
import { cn } from "@/lib/utils"
import { AGENT_LABELS, groupFiles, sizeWords } from "./words"
import { Rule } from "@/ui/Frame"

export function fileKey(info: Pick<KnowledgeFileInfo, "agent" | "file">): string {
  return `${info.agent}/${info.file}`
}

function Facts({ info }: { info: KnowledgeFileInfo }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span>{sizeWords(info.chars)}</span>
      {info.over ? <span className="text-foreground">· over</span> : null}
      {info.notes > 0 ? <span className="text-primary">✎ {info.notes}</span> : null}
    </span>
  )
}

function FileRow({ info, selected, onSelect }: { info: KnowledgeFileInfo; selected: boolean; onSelect: (key: string) => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(fileKey(info))}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-[1ch] py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
          selected && "bg-accent",
        )}
      >
        <span className={cn("min-w-0 truncate text-sm text-foreground", selected && "font-medium")}>{info.label}</span>
        <Facts info={info} />
      </button>
    </li>
  )
}

export function KnowledgeList({ files, selectedKey, onSelect }: { files: KnowledgeFileInfo[]; selectedKey?: string; onSelect: (key: string) => void }) {
  return (
    <div className="flex flex-col pb-2">
      {groupFiles(files).map((group) => (
        <div key={group.agent}>
          <h3 className="px-[1ch] pt-3 pb-1 text-sm">
            <Rule title={AGENT_LABELS[group.agent]} right={group.notes > 0 ? `✎ ${group.notes}` : undefined} />
          </h3>
          <ul className="flex flex-col gap-0.5 px-1 pt-1">
            {group.files.map((info) => (
              <FileRow key={fileKey(info)} info={info} selected={fileKey(info) === selectedKey} onSelect={onSelect} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
