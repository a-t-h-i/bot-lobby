/**
 * The folder browser, inside the composer's bubble: "Open folder…" in the projects bubble morphs into it. A recessed
 * path bar (Up, then the last folders of the path as crumbs), the subfolders (the list slides in from the side you
 * went), and a footer with the count, Cancel and "Open this folder". The folders are on the machine running
 * bot-lobby; the project opens in a session of its own and this one keeps running.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { ArrowUp, ChevronRight, Folder } from "lucide-react"
import { call } from "@/lib/api"
import { rememberProjects, switchProject } from "@/lib/project"
import { cn } from "@/lib/utils"
import { useApiRead } from "./useApiRead"

/** The folder browser's bubble size. */
export const FOLDER_SIZE = { w: 540, h: 324 } as const

function useOpenProject(tab: string) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string>()
  async function open(path: string) {
    if (opening) return
    setOpening(true)
    setError(undefined)
    try {
      const { project } = await call("projects.open", { path })
      rememberProjects([project])
      switchProject(project.id, tab)
    } catch (failure) { setError((failure as Error).message) }
    finally { setOpening(false) }
  }
  return { opening, error, open }
}

/** The path as crumbs: each folder with the path it stands for, on either kind of separator. */
function crumbsOf(path: string): Array<{ name: string; path: string }> {
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/"
  const parts = path.split(sep)
  const crumbs: Array<{ name: string; path: string }> = []
  parts.forEach((name, index) => {
    if (!name) return
    const joined = parts.slice(0, index + 1).join(sep)
    crumbs.push({ name, path: joined || sep })
  })
  return crumbs.length ? crumbs : [{ name: sep, path: sep }]
}

/** Arrow keys walk the rows, Home and End jump to the ends, Backspace goes up a folder. */
function onListKey(event: KeyboardEvent<HTMLDivElement>, parent: string | undefined, browse: (path: string) => void) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-folder]:not(:disabled)")]
  const at = rows.indexOf(document.activeElement as HTMLButtonElement)
  const next = { ArrowDown: Math.min(rows.length - 1, at + 1), ArrowUp: Math.max(0, at - 1), Home: 0, End: rows.length - 1 }[event.key]
  if (next !== undefined && rows.length > 0) {
    event.preventDefault()
    rows[next]?.focus()
  } else if (event.key === "Backspace" && parent) {
    event.preventDefault()
    browse(parent)
  }
}

export function FolderPane({ tab, onClose }: { tab: string; onClose: () => void }) {
  const [path, setPath] = useState<string>()
  const [nav, setNav] = useState({ step: 0, dir: "fwd" as "fwd" | "back" })
  const read = useApiRead("projects.browse", path === undefined ? {} : { path }, [])
  const project = useOpenProject(tab)
  const list = useRef<HTMLDivElement>(null)
  const busy = read.loading || project.opening
  const here = read.data?.path ?? path ?? ""
  const go = (to: string, dir: "fwd" | "back") => {
    if (to === here) return
    setNav((now) => ({ step: now.step + 1, dir }))
    setPath(to)
  }
  // The first folder takes focus once the listing is in, so the arrow keys walk it straight away.
  useEffect(() => {
    if (!read.data) return
    const first = list.current?.querySelector<HTMLElement>("button[data-folder]")
    if (first && !list.current?.contains(document.activeElement)) first.focus({ preventScroll: true })
  }, [read.data])

  const crumbs = crumbsOf(here)
  const shown = crumbs.slice(-4)
  const count = read.data?.folders.length ?? 0
  const countText = read.error || project.error
    ? (read.error ?? project.error)
    : read.loading && !read.data ? "Loading…"
      : count === 0 ? "No subfolders"
        : `${count.toLocaleString()} ${count === 1 ? "folder" : "folders"}${read.data?.truncated ? " (first 2,000)" : ""}`
  return (
    <div role="group" aria-label="Open project folder" className="bubble-pane flex flex-col gap-1.5 p-2" style={{ height: FOLDER_SIZE.h }}>
      <div className="bubble-wellbar flex h-10 shrink-0 items-center gap-0.5 rounded-2xl px-1">
        <button type="button" aria-label="Parent folder" title="Parent folder (Backspace)" disabled={busy || !read.data?.parent} onClick={() => read.data?.parent && go(read.data.parent, "back")}
          className="bubble-iconbtn size-8 rounded-xl">
          <ArrowUp aria-hidden="true" className="size-4" strokeWidth={1.8} />
        </button>
        <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap" title={here}>
          {crumbs.length > shown.length ? <span className="shrink-0 px-1.5 text-[13px] text-(--bubble-muted)">…</span> : null}
          {shown.map((crumb, index) => (
            <span key={crumb.path} className="flex min-w-0 items-center">
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-(--bubble-faint)" strokeWidth={2} /> : null}
              <button type="button" className="bubble-crumb" data-last={index === shown.length - 1 || undefined}
                aria-current={index === shown.length - 1 ? "location" : undefined} disabled={busy} onClick={() => go(crumb.path, "back")}>
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      </div>
      <div
        ref={list}
        key={nav.step}
        role="group"
        aria-label="Folders"
        aria-busy={read.loading}
        data-dir={nav.step ? nav.dir : undefined}
        onKeyDown={(event) => onListKey(event, read.data?.parent, (to) => go(to, "back"))}
        className="bubble-flist bubble-scroll"
      >
        {read.data?.folders.map((folder) => {
          const hidden = folder.name.startsWith(".")
          return (
            <button key={folder.path} type="button" data-folder disabled={project.opening} onClick={() => go(folder.path, "fwd")} title={folder.path}
              className={cn("bubble-frow", hidden && "text-(--bubble-muted)")}>
              <span className="bubble-ftile"><Folder aria-hidden="true" className="size-3.5 text-(--bubble-muted)" strokeWidth={1.8} /></span>
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <ChevronRight aria-hidden="true" className="bubble-go size-3.5 shrink-0" strokeWidth={2} />
            </button>
          )
        })}
        {read.data && count === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-(--bubble-muted)">
            <Folder aria-hidden="true" className="size-6" strokeWidth={1.5} />
            <span>No subfolders here. You can open this folder.</span>
          </div>
        ) : null}
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 ps-2.5">
        <span role={read.error || project.error ? "alert" : "status"} className={cn("min-w-0 truncate text-xs", read.error || project.error ? "text-destructive" : "text-(--bubble-muted)")}>{countText}</span>
        <span className="flex shrink-0 items-center gap-1">
          {read.error ? <button type="button" className="bubble-btn bubble-ghostbtn" onClick={read.reload} disabled={read.loading}>Retry</button> : null}
          <button type="button" className="bubble-btn bubble-ghostbtn" onClick={onClose} disabled={project.opening}>Cancel</button>
          <button type="button" className="bubble-btn bubble-key" disabled={!read.data || read.loading || Boolean(read.error) || project.opening}
            onClick={() => void project.open(read.data!.path)}>{project.opening ? "Opening project…" : "Open this folder"}</button>
        </span>
      </div>
    </div>
  )
}
