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

/**
 * Where each project this page has seen lives, by id, so a project whose pi
 * restarted (it comes back under a new id) is found again by its folder. Kept
 * for this tab only; a failing storage keeps it in memory.
 */
const FOLDERS_KEY = "bot-lobby.projectFolders"
const folders = new Map<string, string>()

function storage(): Storage | undefined {
  try { return (globalThis as { sessionStorage?: Storage }).sessionStorage } catch { return undefined }
}

function readFolders(): void {
  try {
    const kept = JSON.parse(storage()?.getItem(FOLDERS_KEY) ?? "{}") as Record<string, unknown>
    for (const [id, cwd] of Object.entries(kept)) if (PROJECT_ID.test(id) && typeof cwd === "string") folders.set(id, cwd)
  } catch { /* A torn entry only means the folders are learned again. */ }
}

/** Remember the folders of the projects a listing named. */
export function rememberProjects(projects: ReadonlyArray<{ id: string; cwd: string }>): void {
  readFolders()
  for (const project of projects) if (PROJECT_ID.test(project.id)) folders.set(project.id, project.cwd)
  try { storage()?.setItem(FOLDERS_KEY, JSON.stringify(Object.fromEntries([...folders].slice(-64)))) } catch { /* Memory is enough. */ }
}

/** The folder of a project this page has seen, by id. */
export function projectFolder(id: string): string | undefined {
  if (!folders.has(id)) readFolders()
  return folders.get(id)
}

interface ProjectHistory { replaceState(data: unknown, title: string, url: string): void }

/**
 * The selected project's pi restarted under a new id: point the page at the
 * project now running in the same folder, in place (no reload, so nothing on
 * the page is lost). True when it moved.
 */
export async function relinkProject(list: () => Promise<{ projects: ReadonlyArray<{ id: string; cwd: string }> }>): Promise<boolean> {
  let id: string | undefined
  try { id = selectedProject() } catch { return false }
  if (!id) return false
  const cwd = projectFolder(id)
  if (!cwd) return false
  const { projects } = await list()
  rememberProjects(projects)
  if (projects.some((project) => project.id === id)) return false
  const next = projects.find((project) => project.cwd === cwd)
  const location = pageLocation()
  const history = (globalThis as { history?: ProjectHistory }).history
  if (!next || !location || !history) return false
  const url = new URL(location.origin)
  url.pathname = location.pathname
  url.search = location.search
  url.searchParams.set("project", next.id)
  url.hash = (globalThis as { location?: { hash?: string } }).location?.hash ?? ""
  history.replaceState(null, "", url.href)
  return true
}
