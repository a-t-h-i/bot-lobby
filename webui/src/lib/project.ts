/** Project context comes only from the entry URL, never from persisted drafts. */
const PROJECT_ID = /^[a-f0-9]{32}$/

interface ProjectLocation { search: string; pathname: string; origin: string; assign(url: string): void }

function pageLocation(): ProjectLocation | undefined {
  return (globalThis as { location?: ProjectLocation }).location
}

export function selectedProject(): string | undefined {
  const search = pageLocation()?.search ?? ""
  const values = new URLSearchParams(search).getAll("project")
  if (!values.length) return undefined
  if (values.length !== 1 || !PROJECT_ID.test(values[0]!)) throw new Error("Invalid project ID. Choose a running project below.")
  return values[0]
}

/** Scope only API and preview paths; static, blob and external URLs stay root. */
export function projectUrl(path: string): string {
  if (!path.startsWith("/api/") && !path.startsWith("/files/preview/")) return path
  const id = selectedProject()
  return id ? `/projects/${id}${path}` : path
}

/** Full navigation deliberately discards stores, streams and unsent drafts. */
export function switchProject(id: string, tab: string): void {
  if (!PROJECT_ID.test(id)) throw new Error("Invalid project ID.")
  const location = pageLocation()
  if (!location) throw new Error("Project switching requires a browser.")
  const url = new URL(location.origin)
  url.pathname = location.pathname
  url.searchParams.set("project", id)
  url.hash = `/${tab}`
  location.assign(url.href)
}
