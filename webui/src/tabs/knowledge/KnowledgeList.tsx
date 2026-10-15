/**
 * The Knowledge files as a file tree, the way an editor's explorer draws one:
 * the project's knowledge at the root, a folder for each agent that keeps it
 * (a chevron, a folder that opens with it, the agent's name and the model it
 * runs on), and that agent's files indented under it on a guide line, each
 * with its file-type icon, its file name, its size, `· over` compaction mark
 * and `n notes`. A folder folds away or opens with its row (a button: Enter or
 * Space, or left and right); the folds are remembered in this browser.
 */
import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Library } from "lucide-react"
import type { KnowledgeFileInfo } from "@protocol"
import { cn } from "@/lib/utils"
import { AGENT_LABELS, groupFiles, sizeWords, type KnowledgeAgentName } from "./words"

export function fileKey(info: Pick<KnowledgeFileInfo, "agent" | "file">): string {
  return `${info.agent}/${info.file}`
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

/** A file's icon by its extension, tinted the way editors tint them. */
function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "md" || ext === "mdx" || ext === "txt") return <FileText aria-hidden="true" className="ktree-icon" data-ext="md" />
  if (ext === "json" || ext === "yaml" || ext === "yml" || ext === "toml") return <FileCode aria-hidden="true" className="ktree-icon" data-ext="data" />
  return <File aria-hidden="true" className="ktree-icon" />
}

function Leaf({ info, selected, onSelect }: { info: KnowledgeFileInfo; selected: boolean; onSelect: (key: string) => void }) {
  return (
    <li className="ktree-leaf">
      <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
        type="button"
        data-row
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(fileKey(info))}
        title={info.label}
        className="ktree-row ktree-file"
      >
        <FileIcon name={info.file} />
        <span className="min-w-0 flex-1 truncate">
          <span className="sr-only">{info.label}, </span>
          <span aria-hidden="true">{info.file}</span>
        </span>
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
    <div className="ktree px-2 pt-2 pb-3">
      <p className="ktree-row ktree-root">
        <Library aria-hidden="true" className="ktree-icon" />
        <span className="min-w-0 flex-1 truncate font-medium">Project knowledge</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {plural(files.length, "file")} · {plural(groups.length, "agent")}{notes > 0 ? ` · ${plural(notes, "note")}` : ""}
        </span>
      </p>
      <ul className="ktree-branches" aria-label="Agents and their knowledge">
        {groups.map((group) => {
          const open = !folded.includes(group.agent)
          const panel = `knowledge-${group.agent}`
          const model = models[group.agent]
          return (
            <li key={group.agent} className="ktree-branch">
              <h3 className="font-normal">
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
                  className="ktree-row ktree-node"
                >
                  <ChevronRight aria-hidden="true" className={cn("ktree-chevron", open && "rotate-90")} />
                  {open ? <FolderOpen aria-hidden="true" className="ktree-icon ktree-folder" /> : <Folder aria-hidden="true" className="ktree-icon ktree-folder" />}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-foreground">{AGENT_LABELS[group.agent]}</span>
                    {model ? (
                      <span className="ms-2 text-xs text-muted-foreground">
                        <span className="sr-only">runs on </span>
                        {model}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {group.notes > 0 ? <span className="text-primary">{plural(group.notes, "note")} · </span> : null}
                    {plural(group.files.length, "file")}
                  </span>
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
