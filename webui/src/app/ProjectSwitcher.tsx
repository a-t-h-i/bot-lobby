/**
 * Which project this page is looking at: the name and branch in the top bar,
 * and a list of the running, authorised projects behind them (`P` opens it).
 * Choosing one reloads the page into that project, which drops the stores,
 * the streams and any unsent draft on purpose.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Popover } from "radix-ui"
import { Check, ChevronsUpDown, GitBranch, RefreshCw, TriangleAlert } from "lucide-react"
import type { ProjectInfo } from "@protocol"
import { call } from "@/lib/api"
import { useHotkey } from "@/lib/hotkeys"
import { selectedProject, switchProject } from "@/lib/project"
import { Keys } from "@/components/ui/kbd"
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
  if (!data.projects.length) return "No authorized running projects found. Start a project in Pi, then refresh."
  return undefined
}

function useProjects() {
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
  return { data, error, busy, refresh }
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

export function ProjectSwitcher({ tab, name, branch }: { tab: string; name: string; branch?: string | undefined }) {
  const { data, error, busy, refresh } = useProjects()
  const [open, setOpen] = useState(false)
  const selected = selection()
  const message = selected.error ?? error ?? projectError(data, selected.id)
  const active = selected.error ? "invalid" : selected.id ?? data?.currentId ?? ""
  useHotkey("p", () => setOpen(true))
  useHotkey("r", () => void refresh(), { enabled: open, inDialog: true })

  function choose(id: string) {
    setOpen(false)
    if (id !== active) switchProject(id, tab)
  }

  return (
    <div aria-busy={busy} className="flex min-w-0 items-center gap-1.5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          type="button"
          aria-label={`Project: ${name}`}
          aria-keyshortcuts="P"
          className="group flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-accent"
        >
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-primary" />
          <span className="truncate">{name}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
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
            className="glass-pop z-50 flex w-[min(26rem,calc(100vw-1.5rem))] origin-(--radix-popover-content-transform-origin) flex-col overflow-hidden rounded-xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Running projects</span>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy}
                aria-label="Refresh projects"
                aria-keyshortcuts="R"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60"
              >
                {busy ? <Spinner aria-hidden="true" role="presentation" className="size-3" /> : <RefreshCw aria-hidden="true" className="size-3" />}
                Refresh
                <Keys chord="R" className="kbd-hint" />
              </button>
            </div>
            <div role="listbox" aria-label="Projects" className="flex max-h-72 flex-col overflow-y-auto p-1">
              {data?.projects.length ? (
                data.projects.map((project) => {
                  const on = project.id === active
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => choose(project.id)}
                      className={cn(
                        "flex min-h-9 w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
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
                })
              ) : (
                <p className="px-3 py-3 text-sm text-muted-foreground">{busy ? "Loading projects…" : "No running projects found."}</p>
              )}
            </div>
            {message ? (
              <p role="alert" className="flex items-start gap-2 border-t border-border px-3 py-2 text-xs break-words text-destructive">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {message}
              </p>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {branch ? (
        <span className="hidden min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
          <GitBranch aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      ) : null}
      {message && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={message}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-destructive/10 px-2 text-xs font-medium text-destructive outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <TriangleAlert aria-hidden="true" className="size-3" />
          Project
          <span className="sr-only">: {message}</span>
        </button>
      ) : null}
    </div>
  )
}
