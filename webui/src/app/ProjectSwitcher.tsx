/**
 * Which project this page is looking at: the name and branch in the top bar,
 * and a list of the running, authorised projects behind them (`P` opens it).
 * Choosing one reloads the page into that project, which drops the stores,
 * the streams and any unsent draft on purpose.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/reui/popover"
import { Check, ChevronsUpDown, FolderOpen, GitBranch, RefreshCw, TriangleAlert } from "lucide-react"
import type { ProjectInfo } from "@protocol"
import { call } from "@/lib/api"
import { useHotkey } from "@/lib/hotkeys"
import { rememberProjects, selectedProject, switchProject } from "@/lib/project"
import { Keys } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ProjectFolderDialog } from "./ProjectFolderDialog"

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
function problem({ data, error }: Projects): string | undefined {
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
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='option']")]
  if (options.length === 0) return
  event.preventDefault()
  const at = options.indexOf(document.activeElement as HTMLElement)
  const next = edge === "first" ? 0 : edge === "last" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, (at < 0 ? (step > 0 ? -1 : options.length) : at) + step))
  options[next]?.focus()
}

export function ProjectSwitcher({ projects, tab, name, branch }: { projects: Projects; tab: string; name: string; branch?: string | undefined }) {
  const { data, busy, slow, refresh } = projects
  const [open, setOpen] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const selected = selection()
  const message = problem(projects)
  const active = selected.error ? "invalid" : selected.id ?? data?.currentId ?? ""
  useHotkey("p", () => setOpen(true))
  useHotkey("r", () => void refresh(), { enabled: open, inDialog: true })

  function choose(id: string) {
    setOpen(false)
    if (id !== active) switchProject(id, tab)
  }

  return (
    <div aria-busy={busy} className="flex min-w-0 items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          role="combobox"
          aria-label="Project"
          aria-description={`${name}${branch ? `, branch ${branch}` : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-keyshortcuts="P ArrowDown"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" || event.altKey || event.metaKey || event.ctrlKey) return
            event.preventDefault()
            setOpen(true)
          }}
          className="btn-ghost group flex h-8 min-w-0 items-center gap-2 rounded-lg border border-transparent px-2.5 text-sm font-medium outline-none transition-[box-shadow,background-color] duration-150 focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none"
        >
          <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", message ? "bg-destructive" : "bg-primary")} />
          <span className="truncate">{name}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          aria-label="Projects"
          onKeyDown={walk}
          onOpenAutoFocus={(event) => {
            const chosen = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[role='option'][aria-selected='true']") ?? (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[role='option']")
            if (chosen) {
              event.preventDefault()
              chosen.focus()
            }
          }}
          className="p-0 flex w-[min(26rem,calc(100vw-1.5rem))] origin-(--radix-popover-content-transform-origin) flex-col overflow-hidden rounded-xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Running projects</span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              aria-label="Refresh list"
              aria-keyshortcuts="R"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60"
            >
              {busy ? <Spinner aria-hidden="true" role="presentation" className="size-3" /> : <RefreshCw aria-hidden="true" className="size-3" />}
              Refresh
              <Keys chord="R" className="kbd-hint" />
            </button>
          </div>
          <div role="listbox" aria-label="Projects" className="flex max-h-72 flex-col overflow-y-auto p-1">
            {data?.projects.map((project) => {
              const on = project.id === active
              return (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(project.id)}
                  className={cn(
                    "flex min-h-10 w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
                    on && "bg-accent"
                  )}
                >
                  <span className="flex h-5 w-4 shrink-0 items-center justify-center">{on ? <Check aria-hidden="true" className="size-3.5 text-primary" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {project.cwd} · :{project.port}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <button type="button" className="flex items-center gap-2 border-t border-border px-3 py-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
            onClick={() => { setOpen(false); setBrowsing(true) }}><FolderOpen aria-hidden="true" className="size-4" />Open folder…</button>
        </PopoverContent>
        </Popover>
      <ProjectFolderDialog open={browsing} onClose={() => setBrowsing(false)} tab={tab} />
      {branch ? (
        <span className="hidden min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
          <GitBranch aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      ) : null}
      {slow || message ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Refresh projects"
              disabled={busy}
              onClick={() => void refresh()}
              className="btn-ghost inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground outline-none transition-[box-shadow,color,translate] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px disabled:opacity-60"
            >
              {busy ? <Spinner aria-hidden="true" role="presentation" className="size-4" /> : <RefreshCw aria-hidden="true" className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh projects</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
