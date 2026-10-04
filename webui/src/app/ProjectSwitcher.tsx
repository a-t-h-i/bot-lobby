import { useEffect, useRef, useState } from "react"
import type { ProjectInfo } from "@protocol"
import { call } from "@/lib/api"
import { selectedProject, switchProject } from "@/lib/project"
import { Button } from "@/components/ui/button"

interface ProjectList { projects: ProjectInfo[]; currentId: string }

function selection(): { id?: string; error?: string } {
  try { return { id: selectedProject() } }
  catch (error) { return { error: (error as Error).message } }
}

function projectError(data: ProjectList | undefined, id: string | undefined): string | undefined {
  if (!data) return undefined
  if (id && !data.projects.some((project) => project.id === id)) return "Selected project is unknown or offline. Refresh or choose a running project."
  if (!data.projects.length) return "No authorized running projects found. Start a project in Pi, then refresh."
  return undefined
}

function ProjectSelect({ data, id, busy, tab }: { data?: ProjectList; id?: string; busy: boolean; tab: string }) {
  const active = id ?? data?.currentId ?? ""
  const known = data?.projects.some((project) => project.id === active)
  return <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
    <span>Project</span>
    <select value={active} disabled={!data?.projects.length} onChange={(event) => switchProject(event.target.value, tab)}
      className="h-10 min-w-0 max-w-64 flex-1 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50">
      {!known ? <option value={active}>{busy ? "Loading projects…" : active ? "Selected project unavailable" : "Choose a project"}</option> : null}
      {data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name} — {project.cwd} :{project.port}</option>)}
    </select>
  </label>
}

function useProjects() {
  const [data, setData] = useState<ProjectList>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  async function refresh() {
    const version = ++request.current
    setBusy(true); setError(undefined)
    try { const result = await call<ProjectList>("projects.list", {}); if (version === request.current) setData(result) }
    catch (failure) { if (version === request.current) setError((failure as Error).message) }
    finally { if (version === request.current) setBusy(false) }
  }
  useEffect(() => { void refresh(); return () => { request.current++ } }, [])
  return { data, error, busy, refresh }
}

export function ProjectSwitcher({ tab }: { tab: string }) {
  const { data, error, busy, refresh } = useProjects()
  const selected = selection()
  const message = selected.error ?? error ?? projectError(data, selected.id)
  return <div aria-busy={busy} className="flex min-w-0 max-w-lg flex-col gap-1 [grid-area:project]">
    <div className="flex min-w-0 items-center gap-1">
      <ProjectSelect data={data} id={selected.error ? "invalid" : selected.id} busy={busy} tab={tab} />
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()} className="min-h-10" aria-label="Refresh projects">{busy ? "Loading…" : "Refresh"}</Button>
    </div>
    {message ? <p role="alert" className="break-words text-xs text-destructive">{message}</p> : null}
  </div>
}
