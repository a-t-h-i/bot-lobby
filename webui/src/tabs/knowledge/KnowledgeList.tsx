/**
 * The Knowledge file list: files grouped by agent under
 * `Master (oracle)`, `Designer`, `Backend`, `QA`, each row a 44 px button with
 * its size, `· over` compaction mark and `n notes`.
 */
import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Brain, ChevronRight, Palette, Server, ShieldCheck, type LucideIcon } from "lucide-react"
import type { KnowledgeFileInfo } from "@protocol"
import { cn } from "@/lib/utils"
import { ROW } from "@/ui/rows"
import { AGENT_LABELS, groupFiles, sizeWords, type KnowledgeAgentName } from "./words"

export function fileKey(info: Pick<KnowledgeFileInfo, "agent" | "file">): string {
  return `${info.agent}/${info.file}`
}

function Facts({ info }: { info: KnowledgeFileInfo }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span>{sizeWords(info.chars)}</span>
      {info.over ? <span className="text-foreground">· over</span> : null}
      {info.notes > 0 ? <span className="text-primary">{info.notes} note{info.notes === 1 ? "" : "s"}</span> : null}
    </span>
  )
}

function FileRow({ info, selected, onSelect }: { info: KnowledgeFileInfo; selected: boolean; onSelect: (key: string) => void }) {
  return (
    <li>
      <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
        type="button"
        data-row
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(fileKey(info))}
        className={cn(ROW, "min-h-9 flex-row items-center justify-between gap-3 py-1.5")}
      >
        <span className={cn("min-w-0 truncate text-sm text-foreground", selected && "font-medium")}>{info.label}</span>
        <Facts info={info} />
      </button>
    </li>
  )
}

const AGENT_ICONS: Record<KnowledgeAgentName, LucideIcon> = {
  master: Brain,
  designer: Palette,
  backend: Server,
  qa: ShieldCheck,
}

const FOLDED_KEY = "bot-lobby.knowledge.folded"

function readFolded(): KnowledgeAgentName[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FOLDED_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((name): name is KnowledgeAgentName => typeof name === "string") : []
  } catch {
    return []
  }
}

/** Each agent's files, folded away or opened with its header (a button: Enter or Space, or left and right). */
export function KnowledgeList({ files, selectedKey, onSelect }: { files: KnowledgeFileInfo[]; selectedKey?: string; onSelect: (key: string) => void }) {
  const [folded, setFolded] = useState<KnowledgeAgentName[]>(readFolded)

  function setOpen(agent: KnowledgeAgentName, open: boolean) {
    setFolded((now) => {
      const next = open ? now.filter((name) => name !== agent) : [...new Set([...now, agent])]
      try {
        window.localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
      } catch {
        /* the folds just do not stick */
      }
      return next
    })
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 pb-2">
      {groupFiles(files).map((group) => {
        const open = !folded.includes(group.agent)
        const Icon = AGENT_ICONS[group.agent]
        const panel = `knowledge-${group.agent}`
        return (
          <section key={group.agent}>
            <h3>
              <button aria-keyshortcuts="Enter Space ArrowLeft ArrowRight" aria-describedby="focused-action-help"
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => setOpen(group.agent, !open)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "h") {
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(group.agent, false)
                  } else if (event.key === "ArrowRight" || event.key === "l") {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!open) setOpen(group.agent, true)
                  }
                }}
                className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform duration-200 ease-snap", open && "rotate-90")} />
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{AGENT_LABELS[group.agent]}</span>
                {group.notes > 0 ? (
                  <span className="shrink-0 font-normal text-primary tabular-nums">
                    {group.notes} note{group.notes === 1 ? "" : "s"}
                  </span>
                ) : null}
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {open ? (
                <motion.ul
                  id={panel}
                  key="files"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 520, damping: 42 }}
                  className="flex flex-col gap-0.5 overflow-hidden pl-3"
                >
                  {group.files.map((info) => (
                    <FileRow key={fileKey(info)} info={info} selected={fileKey(info) === selectedKey} onSelect={onSelect} />
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>
          </section>
        )
      })}
    </div>
  )
}
