import { useEffect, useState, type KeyboardEvent } from "react"
import { ArrowUp, ChevronRight, Folder } from "lucide-react"
import { Popup } from "@/components/ui/popup"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { call } from "@/lib/api"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { rememberProjects, switchProject } from "@/lib/project"
import { useApiRead } from "./useApiRead"
import type { FolderListing } from "@protocol"

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

/** The path bar: Up to the parent, the path in monospace to edit, Go (or Enter) to browse it. */
function FolderPath({ path, parent, busy, browse }: { path: string; parent?: string; busy: boolean; browse: (path: string) => void }) {
  const [draft, setDraft] = useState(path)
  useEffect(() => setDraft(path), [path])
  return <form className="flex h-9 min-w-0 items-center rounded-md border border-input bg-background shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 max-md:h-11" onSubmit={(event) => { event.preventDefault(); browse(draft) }}>
    <button type="button" aria-label="Parent folder" title="Parent folder (Backspace)" disabled={busy || !parent} onClick={() => parent && browse(parent)}
      className="grid h-full w-9 shrink-0 place-items-center border-r border-input text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40">
      <ArrowUp aria-hidden="true" className="size-4" />
    </button>
    <input aria-label="Folder path" value={draft} disabled={busy} spellCheck={false} autoComplete="off" onChange={(event) => setDraft(event.target.value)}
      className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[0.8125rem] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60" />
    <button type="submit" disabled={busy || !draft.trim()}
      className="h-full shrink-0 border-l border-input px-3 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40">Go</button>
  </form>
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

function FolderList({ data, loading, busy, browse }: { data?: FolderListing; loading: boolean; busy: boolean; browse: (path: string) => void }) {
  const count = data?.folders.length ?? 0
  return <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
    <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-muted/50 px-3 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
      <span>Name</span>
      <span className="normal-case tracking-normal">{loading ? "Loading…" : `${count.toLocaleString()} ${count === 1 ? "folder" : "folders"}${data?.truncated ? " (first 2,000)" : ""}`}</span>
    </div>
    <div aria-label="Folders" role="group" onKeyDown={(event) => onListKey(event, data?.parent, browse)}
      className="h-64 overflow-y-auto overscroll-contain py-1 max-md:h-[min(40vh,16rem)]">
      {data?.folders.map((folder) => {
        const hidden = folder.name.startsWith(".")
        return <button key={folder.path} type="button" data-folder disabled={busy} onClick={() => browse(folder.path)} title={folder.path}
          className="group/row flex h-8 w-full min-w-0 items-center gap-2.5 px-3 text-left text-[0.8125rem] transition-colors outline-none hover:bg-muted focus-visible:bg-accent focus-visible:text-accent-foreground disabled:opacity-60 max-md:h-11">
          <Folder aria-hidden="true" className={cn("size-4 shrink-0", hidden ? "text-muted-foreground/60" : "text-muted-foreground")} />
          <span className={cn("min-w-0 flex-1 truncate", hidden && "text-muted-foreground")}>{folder.name}</span>
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover/row:text-muted-foreground group-focus-visible/row:text-muted-foreground" />
        </button>
      })}
      {data && !count ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">No subfolders. You can open this folder.</p> : null}
      {data?.truncated ? <p className="px-3 py-2 text-xs text-muted-foreground">Only the first 2,000 entries are listed. Enter a path to go further.</p> : null}
    </div>
  </div>
}

function FolderBrowser({ tab, close, busyChanged }: { tab: string; close: () => void; busyChanged: (busy: boolean) => void }) {
  const [path, setPath] = useState<string>()
  const read = useApiRead("projects.browse", path === undefined ? {} : { path }, [])
  const project = useOpenProject(tab)
  useEffect(() => busyChanged(project.opening), [project.opening, busyChanged])
  return <div className="flex min-h-0 max-h-full w-[min(40rem,calc(100vw-2rem))] flex-col overflow-y-auto max-md:max-h-[calc(100svh-2rem)]">
    <div className="flex flex-col gap-1 border-b border-border px-5 pt-4 pb-3 max-md:px-4">
      <h2 className="text-[0.9375rem] font-semibold">Open project folder</h2>
      <p className="break-words text-xs text-muted-foreground">Folders on the machine running bot-lobby. The project opens in a session of its own; this one keeps running, and its project-local extensions stay off until you enable them.</p>
    </div>
    <div className="flex min-h-0 flex-col gap-3 px-5 py-4 max-md:px-4">
      <FolderPath path={read.data?.path ?? path ?? ""} parent={read.data?.parent} busy={project.opening} browse={setPath} />
      <FolderList data={read.data} loading={read.loading} busy={read.loading || project.opening} browse={setPath} />
      {read.loading ? <p role="status" className="sr-only">Loading folders…</p> : null}
      {read.error || project.error ? <p role="alert" className="break-words text-xs text-destructive">{read.error ?? project.error}</p> : null}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3 max-md:px-4">
      {read.error ? <Button variant="outline" onClick={read.reload} disabled={read.loading} className="max-md:min-h-11">Retry</Button> : null}
      <Button variant="outline" onClick={close} disabled={project.opening} className="max-md:min-h-11">Cancel</Button>
      <Button disabled={!read.data || read.loading || Boolean(read.error) || project.opening} onClick={() => void project.open(read.data!.path)} className="max-md:min-h-11">{project.opening ? "Opening project…" : "Open this folder"}</Button>
    </div>
  </div>
}

export function ProjectFolderDialog({ open, onClose, tab }: { open: boolean; onClose: () => void; tab: string }) {
  const shown = useOverlaySlot(open, PRIORITY.help)
  const [busy, setBusy] = useState(false)
  return <Popup open={shown} label="Open project folder" className="max-md:max-h-[calc(100svh-2rem)] max-md:max-w-[calc(100vw-2rem)]" onOpenChange={(next) => { if (!next && !busy) onClose() }} dismissOnBackdrop={!busy}
    onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLElement>('[role="combobox"][aria-label="Project"]')?.focus() }}>
    {open ? <FolderBrowser tab={tab} close={onClose} busyChanged={setBusy} /> : null}
  </Popup>
}
