/**
 * Which project this page is looking at: a chip in the composer's tools row, and the running, authorised projects
 * behind it in a bubble that grows out of the composer (`P` opens it). "Open folder…" turns that bubble into the
 * folder browser (./ProjectFolderDialog). Choosing one reloads the page into that project, which drops the stores,
 * the streams and any unsent draft on purpose.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { Check, ChevronDown, Folder, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react"
import type { ProjectInfo } from "@protocol"
import { call } from "@/lib/api"
import { useHotkey } from "@/lib/hotkeys"
import { rememberProjects, selectedProject, switchProject } from "@/lib/project"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

interface ProjectList {
  projects: ProjectInfo[]
  currentId: string
}

function selection(): { id?: string; error?: string } {
  try {
    return { id: selectedProject() }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

function projectError(data: ProjectList | undefined, id: string | undefined): string | undefined {
  if (!data) return undefined
  if (id && !data.projects.some((project) => project.id === id)) return "Selected project is unknown or offline. Refresh or choose a running project."
  if (!data.projects.length) return "No authorized running projects found. Open a folder from the Project menu, or refresh."
  return undefined
}

export function useProjects() {
  const [data, setData] = useState<ProjectList>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  async function refresh() {
    const version = ++request.current
    setBusy(true)
    setError(undefined)
    try {
      const result = await call<ProjectList>("projects.list", {})
      rememberProjects(result.projects)
      if (version === request.current) setData(result)
    } catch (failure) {
      if (version === request.current) setError((failure as Error).message)
    } finally {
      if (version === request.current) setBusy(false)
    }
  }
  useEffect(() => {
    void refresh()
    return () => {
      request.current++
    }
  }, [])
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    // A lookup that is quick never flashes a spinner in the bar.
    if (!busy) return setSlow(false)
    const timer = setTimeout(() => setSlow(true), 300)
    return () => clearTimeout(timer)
  }, [busy])
  return { data, error, busy, slow, refresh }
}

export type Projects = ReturnType<typeof useProjects>

/** What is wrong with the project this page is looking at, in words; nothing when all is well. */
export function problem({ data, error }: Projects): string | undefined {
  const selected = selection()
  return selected.error ?? error ?? projectError(data, selected.id)
}

/** The one line under the bar that says why no project can be chosen, with the way to try again. */
export function ProjectNotice({ projects }: { projects: Projects }) {
  const message = problem(projects)
  if (!message) return null
  return (
    <p role="alert" className="notice flex min-w-0 items-start gap-2 pt-1 pb-0.5 text-xs break-words text-destructive">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  )
}

/** Up and Down walk the options, Home and End jump, like a native list box. */
function walk(event: KeyboardEvent<HTMLElement>) {
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
  const edge = event.key === "Home" ? "first" : event.key === "End" ? "last" : undefined
  if (!step && !edge) return
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='option'], [data-walk]")]
  if (options.length === 0) return
  event.preventDefault()
  const at = options.indexOf(document.activeElement as HTMLElement)
  const next = edge === "first" ? 0 : edge === "last" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, (at < 0 ? (step > 0 ? -1 : options.length) : at) + step))
  options[next]?.focus()
}

/** Asks the project list to open from elsewhere. */
export const OPEN_PROJECTS = "bot-lobby:open-projects"

/** At most this many projects show at once; more scroll. */
const PROJECT_ROWS = 4

/** The projects bubble's size: a 36px heading, a 52px row a project, the 40px "Open folder…" row, and a line for a problem. */
export function projectsSize(projects: Projects): { w: number; h: number } {
  const rows = Math.max(1, Math.min(projects.data?.projects.length ?? 1, PROJECT_ROWS))
  return { w: 400, h: 12 + 36 + 1 + rows * 52 + 1 + 40 + (problem(projects) ? 36 : 0) }
}

/** The project chip in the composer's tools row; it looks pressed in while its bubble is open. */
export function ProjectChip({ projects, name, branch, open, onToggle }: { projects: Projects; name: string; branch?: string | undefined; open: boolean; onToggle: () => void }) {
  const message = problem(projects)
  return (
    <button
      type="button"
      role="combobox"
      aria-label="Project"
      aria-description={`${name}${branch ? `, branch ${branch}` : ""}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-keyshortcuts="P ArrowDown"
      aria-busy={projects.busy}
      data-tip="Switch project"
      data-on={open || undefined}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" || event.altKey || event.metaKey || event.ctrlKey || open) return
        event.preventDefault()
        onToggle()
      }}
      title={branch ? `${name} · ${branch}` : name}
      className="bubble-chip bubble-tip bubble-tool min-w-0"
    >
      {projects.slow ? <Spinner aria-hidden="true" role="presentation" className="size-3.5" /> : <Folder aria-hidden="true" className={cn("size-3.5 shrink-0", message && "text-destructive")} />}
      <span className="truncate">{name}</span>
      <ChevronDown aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
    </button>
  )
}

/** The running projects, inside the bubble: the open one first-class with a tick, then "Open folder…". */
export function ProjectsPane({ projects, tab, onBrowse, onClose }: { projects: Projects; tab: string; onBrowse: () => void; onClose: () => void }) {
  const { data, busy, refresh } = projects
  const selected = selection()
  const message = problem(projects)
  const active = selected.error ? "invalid" : selected.id ?? data?.currentId ?? ""
  const list = useRef<HTMLDivElement>(null)
  useHotkey("r", () => void refresh(), { inDialog: true })
  useEffect(() => {
    const chosen = list.current?.querySelector<HTMLElement>("[role='option'][aria-selected='true']") ?? list.current?.querySelector<HTMLElement>("[role='option']")
    chosen?.focus({ preventScroll: true })
  }, [Boolean(data)])

  function choose(id: string) {
    onClose()
    if (id !== active) switchProject(id, tab)
  }

  const rows = Math.max(1, Math.min(data?.projects.length ?? 1, PROJECT_ROWS))
  return (
    <div ref={list} aria-label="Projects" onKeyDown={walk} className="bubble-pane flex flex-col p-1.5">
      <div className="flex h-9 shrink-0 items-center justify-between ps-2.5">
        <span className="text-[13px] font-medium text-(--bubble-muted)">Running projects</span>
        <button type="button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh list" aria-keyshortcuts="R" className="bubble-chip h-7 text-xs">
          {busy ? <Spinner aria-hidden="true" role="presentation" className="size-3" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
          Refresh
          <kbd className="bubble-kbd">R</kbd>
        </button>
      </div>
      <div className="h-px shrink-0" />
      <div role="listbox" aria-label="Projects" className="bubble-scroll flex shrink-0 flex-col overflow-y-auto" style={{ height: rows * 52 }}>
        {data ? data.projects.map((project, index) => {
          const on = project.id === active
          return (
            <button
              key={project.id}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => choose(project.id)}
              className={cn("bubble-row h-[52px] shrink-0", on && "bubble-prow")}
              style={{ "--delay": `${40 + index * 12}ms` } as CSSProperties}
            >
              <span className="flex w-4 shrink-0 justify-center">{on ? <Check aria-hidden="true" className="size-4 text-(--bubble-accent)" strokeWidth={2} /> : null}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-(--bubble-ink)">{project.name}</span>
                <span className="truncate text-xs text-(--bubble-muted)">{project.cwd} · :{project.port}</span>
              </span>
            </button>
          )
        }) : (
          <div className="flex h-[52px] items-center gap-2.5 px-2.5 text-[13px] text-(--bubble-muted)">
            <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
            Loading projects…
          </div>
        )}
      </div>
      {message ? (
        <p role="alert" className="flex h-9 shrink-0 items-center gap-2 px-2.5 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate" title={message}>{message}</span>
        </p>
      ) : null}
      <div className="h-px shrink-0" />
      <button type="button" data-walk onClick={onBrowse} className="bubble-row h-10 shrink-0" style={{ "--delay": "0ms" } as CSSProperties}>
        <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-(--bubble-muted)" strokeWidth={1.7} />
        <span className="text-sm font-medium text-(--bubble-ink)">Open folder…</span>
      </button>
    </div>
  )
}
