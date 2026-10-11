import { useEffect, useState } from "react"
import { ArrowUp, Folder } from "lucide-react"
import { Popup } from "@/components/ui/popup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

function FolderPath({ path, busy, browse }: { path: string; busy: boolean; browse: (path: string) => void }) {
  const [draft, setDraft] = useState(path)
  useEffect(() => setDraft(path), [path])
  return <form className="flex min-w-0 gap-2" onSubmit={(event) => { event.preventDefault(); browse(draft) }}>
    <Input className="min-w-0 flex-1 max-md:h-11" aria-label="Folder path" value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
    <Button type="submit" disabled={busy || !draft.trim()} className="max-md:min-h-11">Go</Button>
  </form>
}

function FolderList({ data, busy, browse }: { data?: FolderListing; busy: boolean; browse: (path: string) => void }) {
  return <div className="min-h-24 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border max-md:max-h-[min(40vh,16rem)]" aria-label="Folders" role="group">
    {data?.parent ? <Button variant="ghost" className="h-auto min-h-11 w-full justify-start py-3 text-left max-md:min-h-12" disabled={busy} onClick={() => browse(data.parent!)}><ArrowUp /> Parent folder</Button> : null}
    {data?.folders.map((folder) => <Button key={folder.path} variant="ghost" className="h-auto min-h-11 w-full justify-start py-3 text-left max-md:min-h-12" disabled={busy} onClick={() => browse(folder.path)}>
      <Folder className="shrink-0" /><span className="whitespace-normal break-words">{folder.name}</span>
    </Button>)}
    {data && !data.folders.length ? <p className="p-3 text-sm text-muted-foreground">No subfolders. You can open this folder.</p> : null}
    {data?.truncated ? <p className="p-3 text-sm text-muted-foreground">Listing limited to 2,000 entries. Enter a path to browse further.</p> : null}
  </div>
}

function FolderBrowser({ tab, close, busyChanged }: { tab: string; close: () => void; busyChanged: (busy: boolean) => void }) {
  const [path, setPath] = useState<string>()
  const read = useApiRead("projects.browse", path === undefined ? {} : { path }, [])
  const project = useOpenProject(tab)
  useEffect(() => busyChanged(project.opening), [project.opening, busyChanged])
  return <div className="flex min-h-0 max-h-full flex-col gap-4 overflow-y-auto p-5 max-md:max-h-[calc(100svh-2rem)] max-md:p-4">
    <h2 className="text-lg font-semibold">Open project folder</h2>
    <p className="break-words text-sm text-muted-foreground">Browse folders on the machine running bot-lobby. Opening starts a separate session; your current project keeps running. Project-local extensions are not enabled automatically.</p>
    <FolderPath path={read.data?.path ?? path ?? ""} busy={project.opening} browse={setPath} />
    <FolderList data={read.data} busy={read.loading || project.opening} browse={setPath} />
    {read.loading ? <p role="status">Loading folders…</p> : null}
    {read.error || project.error ? <p role="alert" className="break-words text-sm text-destructive">{read.error ?? project.error}</p> : null}
    <div className="flex flex-wrap justify-end gap-2">
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
