/**
 * The Knowledge files as a tree: the project's knowledge at the root, a
 * branch for each agent that keeps it (its icon in its colour, and the model
 * it runs on), and that agent's files as leaves, each with its size, `· over`
 * compaction mark and `n notes`. Branches are drawn as lines in the agent's
 * colour. An agent folds away or opens with its node (a button: Enter or
 * Space, or left and right); the folds are remembered in this browser.
 */
import { useState, type CSSProperties } from "react"
import { AnimatePresence, motion } from "motion/react"
import { BookOpen, ChevronRight } from "lucide-react"
import type { KnowledgeFileInfo } from "@protocol"
import { cn } from "@/lib/utils"
import { AgentIcon } from "@/ui/AgentIcon"
import { ROW } from "@/ui/rows"
import { sourceTone } from "@/tabs/lobby/types"
import { AGENT_LABELS, groupFiles, sizeWords, type KnowledgeAgentName } from "./words"

export function fileKey(info: Pick<KnowledgeFileInfo, "agent" | "file">): string {
  return `${info.agent}/${info.file}`
}

/** Each agent as the rest of the page draws it (its icon and colour). */
const AGENT_SOURCES: Record<KnowledgeAgentName, string> = {
  master: "ORACLE",
  designer: "DESIGN",
  backend: "DEV",
  qa: "QA",
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function Facts({ info }: { info: KnowledgeFileInfo }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span>{sizeWords(info.chars)}</span>
      {info.over ? <span className="text-foreground">· over</span> : null}
      {info.notes > 0 ? <span className="text-primary">{plural(info.notes, "note")}</span> : null}
    </span>
  )
}

function Leaf({ info, selected, onSelect }: { info: KnowledgeFileInfo; selected: boolean; onSelect: (key: string) => void }) {
  return (
    <li className="ktree-leaf">
      <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
        type="button"
        data-row
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(fileKey(info))}
        className={cn(ROW, "ktree-file min-h-9 flex-row items-center gap-2 py-1.5")}
      >
        <span aria-hidden="true" className="ktree-bud" />
        <span className={cn("min-w-0 flex-1 truncate text-sm text-foreground", selected && "font-medium")}>{info.label}</span>
        <Facts info={info} />
      </button>
    </li>
  )
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

export function KnowledgeList({ files, models = {}, selectedKey, onSelect }: { files: KnowledgeFileInfo[]; models?: Partial<Record<KnowledgeAgentName, string>>; selectedKey?: string; onSelect: (key: string) => void }) {
  const [folded, setFolded] = useState<KnowledgeAgentName[]>(readFolded)
  const groups = groupFiles(files)
  const notes = files.reduce((total, info) => total + info.notes, 0)

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
    <div className="ktree px-3 pt-1 pb-3">
      <p className="ktree-root">
        <span aria-hidden="true" className="card-raised grid size-8 shrink-0 place-items-center rounded-lg border text-primary">
          <BookOpen className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Project knowledge</span>
          <span className="block text-xs text-muted-foreground">
            {plural(files.length, "file")} · {plural(groups.length, "agent")}{notes > 0 ? ` · ${plural(notes, "note")}` : ""}
          </span>
        </span>
      </p>
      <ul className="ktree-branches" aria-label="Agents and their knowledge">
        {groups.map((group) => {
          const open = !folded.includes(group.agent)
          const source = AGENT_SOURCES[group.agent]
          const panel = `knowledge-${group.agent}`
          const model = models[group.agent]
          return (
            <li key={group.agent} className="ktree-branch" style={{ "--orb": sourceTone(source) } as CSSProperties}>
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
                  className="ktree-node"
                >
                  <span aria-hidden="true" className="ktree-tile">
                    <AgentIcon source={source} strokeWidth={2.25} className={source === "ORACLE" ? "size-5" : "size-3.5"} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{AGENT_LABELS[group.agent]}</span>
                    {model ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="sr-only">runs on </span>
                        {model}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {group.notes > 0 ? <span className="text-primary">{plural(group.notes, "note")} · </span> : null}
                    {plural(group.files.length, "file")}
                  </span>
                  <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-snap", open && "rotate-90")} />
                </button>
              </h3>
              <AnimatePresence initial={false}>
                {open ? (
                  <motion.ul
                    id={panel}
                    key="files"
                    aria-label={`${AGENT_LABELS[group.agent]}'s knowledge`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 520, damping: 42 }}
                    className="ktree-leaves"
                  >
                    {group.files.map((info) => (
                      <Leaf key={fileKey(info)} info={info} selected={fileKey(info) === selectedKey} onSelect={onSelect} />
                    ))}
                  </motion.ul>
                ) : null}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
