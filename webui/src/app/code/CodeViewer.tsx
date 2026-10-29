// Adapted from T3 Code (MIT), apps/web/src/components/DiffPanel.tsx and DiffPanelShell.tsx (the toolbar: diff layout and wrap toggles),
// apps/web/src/components/diffs/DiffFileTree.tsx (the changed files list) and apps/web/src/components/files/FilePreviewPanel.tsx (the file header)
/**
 * The code viewer: a pop-up over the page, as the terminal pops out. Down its
 * left side the files changed in the project since the last commit, each with
 * its change and line counts, and a box to open any file by path; on the
 * right the chosen file as editable, highlighted code, or, with Diff, its
 * change against the last commit (unified or side by side). Ctrl+S (Cmd+S)
 * or Save writes it. A file an agent changed on disk since it was opened is
 * not overwritten without asking. Leaving a file with unsaved edits asks
 * first. File names in the Lobby chat and the activity log open it.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Columns2, FileCode2, FilePlus2, FileX2, PenLine, RefreshCw, Rows3, Save, Search, TextWrap, X } from "lucide-react"
import type { CodeChange, CodeFile } from "@protocol"
import { Button } from "@/components/ui/button"
import { Keys } from "@/components/ui/kbd"
import { Popup } from "@/components/ui/popup"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ApiError, call } from "@/lib/api"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Segmented } from "@/ui/Segmented"
import { useApiRead } from "../useApiRead"
import { matchKey } from "../useLobbyKeys"
import { closeCode, openCode, setCodeWrap, setDiffLayout, useCodeViewer, useCodeWrap, useDiffLayout, type CodeMode } from "./codeStore"

const CodeSurface = lazy(() => import("./CodeSurface"))

const TOOL =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-foreground"

function Tip({ label, hint, children }: { label: string; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        {label} {hint ? <Keys chord={hint} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** The bar's button that opens the viewer. */
export function CodeToggle({ hint, className }: { hint?: string | undefined; className: string }) {
  const { open } = useCodeViewer()
  return (
    <Tip label="Code and changes" hint={hint}>
      <button type="button" aria-label="Code" aria-pressed={open} aria-keyshortcuts={hint} onClick={() => (open ? closeCode() : openCode())} className={className}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>
      </button>
    </Tip>
  )
}

const STATUS: Record<CodeChange["status"], { letter: string; word: string; tone: string }> = {
  modified: { letter: "M", word: "Modified", tone: "text-warning" },
  added: { letter: "A", word: "Added", tone: "text-success" },
  untracked: { letter: "U", word: "New, not committed", tone: "text-success" },
  deleted: { letter: "D", word: "Deleted", tone: "text-destructive" },
  renamed: { letter: "R", word: "Renamed", tone: "text-primary" },
}

function splitPath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/")
  return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) }
}

function Counts({ change, className }: { change: Pick<CodeChange, "additions" | "deletions">; className?: string }) {
  if (change.additions === undefined && change.deletions === undefined) return null
  return (
    <span className={cn("shrink-0 font-mono text-[0.6875rem] tabular-nums", className)}>
      <span className="text-success">+{change.additions ?? 0}</span> <span className="text-destructive">−{change.deletions ?? 0}</span>
    </span>
  )
}

function useDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")))
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** The changed files, and a box to open any file by its path. */
function ChangesRail({ changes, loading, error, current, onPick, onRefresh }: {
  changes: { git: boolean; files: CodeChange[]; truncated: boolean } | undefined
  loading: boolean
  error: string | undefined
  current: string | undefined
  onPick: (path: string) => void
  onRefresh: () => void
}) {
  const [draft, setDraft] = useState("")
  const files = changes?.files ?? []
  const totals = files.reduce((sum, file) => ({ additions: sum.additions + (file.additions ?? 0), deletions: sum.deletions + (file.deletions ?? 0) }), { additions: 0, deletions: 0 })
  function submit(event: FormEvent) {
    event.preventDefault()
    const path = draft.trim()
    if (!path) return
    onPick(path)
    setDraft("")
  }
  return (
    <nav aria-label="Changed files" className="code-rail flex w-64 shrink-0 flex-col border-r border-border max-md:w-52">
      <form onSubmit={submit} className="border-b border-border p-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
          <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Open a file by path" placeholder="Open a file by path…" spellCheck={false} autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground" />
        </label>
      </form>
      <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-xs">
        <span className="font-medium text-foreground">Changes</span>
        <span className="text-muted-foreground tabular-nums">{files.length}{changes?.truncated ? "+" : ""}</span>
        <Counts change={totals} className="ml-auto" />
        <Tip label="Read the changes again">
          <button type="button" aria-label="Refresh changes" onClick={onRefresh} disabled={loading} className={cn(TOOL, "-mr-1.5 size-6", files.length ? "" : "ml-auto")}>
            <RefreshCw aria-hidden="true" className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")} />
          </button>
        </Tip>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
        {files.map((file) => {
          const { dir, name } = splitPath(file.path)
          const status = STATUS[file.status]
          return (
            <li key={file.path}>
              <button type="button" onClick={() => onPick(file.path)} aria-current={file.path === current ? "true" : undefined} title={file.from ? `${file.from} → ${file.path}` : file.path}
                className="group/row flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-[0.8125rem] outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-accent">
                <span aria-label={status.word} className={cn("w-3 shrink-0 text-center font-mono text-[0.6875rem] font-semibold", status.tone)}>{status.letter}</span>
                <span className={cn("min-w-0 flex-1 truncate", file.status === "deleted" && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                  {name}
                  {dir ? <span className="ml-1.5 text-xs text-muted-foreground">{dir}</span> : null}
                </span>
                <Counts change={file} />
              </button>
            </li>
          )
        })}
        {changes && !changes.git ? <li className="px-2 py-6 text-center text-xs text-muted-foreground">This folder is not a git repository, so there are no changes to show. Open a file by its path above.</li> : null}
        {changes?.git && files.length === 0 ? <li className="px-2 py-6 text-center text-xs text-muted-foreground">No changes since the last commit.</li> : null}
        {error ? <li role="alert" className="px-2 py-3 text-xs text-destructive">{error}</li> : null}
      </ul>
    </nav>
  )
}

interface Loaded {
  file: CodeFile
  /** Bumped on every read from disk; the editor starts over then. */
  version: number
}

type Pending = { kind: "open"; path: string } | { kind: "close" }

function useCodeFile(path: string | undefined) {
  const [loaded, setLoaded] = useState<Loaded>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const load = useCallback(async (target: string) => {
    const mine = ++seq.current
    setLoading(true)
    setError(undefined)
    try {
      const file = await call("code.read", { path: target })
      if (mine === seq.current) setLoaded((now) => ({ file, version: (now?.version ?? 0) + 1 }))
    } catch (failure) {
      if (mine === seq.current) {
        setLoaded(undefined)
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (path) void load(path)
    else {
      seq.current++
      setLoaded(undefined)
      setError(undefined)
    }
  }, [path, load])
  return { loaded, setLoaded, error, loading, reload: () => path && load(path) }
}

function Workspace({ requested, requestedMode, request, codeKey, onClose, onDirtyChange, closeAsked }: {
  requested: string | undefined
  requestedMode: CodeMode | undefined
  request: number
  codeKey: string | undefined
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  closeAsked: number
}) {
  const changes = useApiRead("code.changes", {}, ["lobby", "tasks"])
  const [path, setPath] = useState(requested)
  const [mode, setMode] = useState<CodeMode>(requestedMode ?? "code")
  const { loaded, setLoaded, error, loading, reload } = useCodeFile(path)
  const [draft, setDraft] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [pending, setPending] = useState<Pending>()
  const wrap = useCodeWrap()
  const layout = useDiffLayout()
  const dark = useDark()
  const file = loaded?.file
  const dirty = draft !== undefined && draft !== file?.contents

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  // A new file from outside (a name clicked in the chat): leave this one first if it has edits.
  useEffect(() => {
    if (!requested || requested === path) {
      if (requestedMode) setMode(requestedMode)
      return
    }
    go({ kind: "open", path: requested })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  // With nothing asked for, start on the first changed file.
  useEffect(() => {
    if (!path && changes.data?.files[0]) {
      const first = changes.data.files.find((change) => change.status !== "deleted") ?? changes.data.files[0]
      setPath(first.path)
      if (!requestedMode) setMode("diff")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes.data])

  // The path a bare name resolved to is the one shown and listed.
  useEffect(() => {
    if (file && file.path !== path) setPath(file.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path])

  useEffect(() => {
    if (closeAsked) go({ kind: "close" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeAsked])

  function run(action: Pending) {
    setPending(undefined)
    setConflict(false)
    if (action.kind === "close") {
      onClose()
      return
    }
    setDraft(undefined)
    setPath(action.path)
  }

  function go(action: Pending) {
    if (action.kind === "open" && action.path === path) return
    if (dirty) setPending(action)
    else run(action)
  }

  async function save(force = false) {
    if (!file || draft === undefined || saving) return
    setSaving(true)
    try {
      const saved = await call("code.save", { path: file.path, contents: draft, mtimeMs: file.mtimeMs, ...(force ? { force: true } : {}) })
      // The editor keeps its document and history: the saved text becomes the file's, without a fresh read.
      setLoaded((now) => (now ? { ...now, file: { ...now.file, contents: draft, mtimeMs: saved.mtimeMs, size: draft.length } } : now))
      setDraft(undefined)
      setConflict(false)
      changes.reload()
      if (pending) run(pending)
      return true
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "conflict") setConflict(true)
      else toast.error(failure instanceof Error ? failure.message : "The file could not be saved.")
      return false
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault()
      event.stopPropagation()
      void save()
    } else if (codeKey && matchKey(event.nativeEvent, codeKey)) {
      event.preventDefault()
      go({ kind: "close" })
    }
  }

  const change = file?.change
  const diffable = Boolean(change) || file?.original !== undefined
  const shownMode: CodeMode = diffable ? mode : "code"
  const { dir, name } = splitPath(file?.path ?? path ?? "")
  const editable = Boolean(file?.exists && file.contents !== undefined)
  const status = change ? STATUS[change.status] : undefined

  return (
    <div className="flex min-h-0 flex-1" onKeyDown={onKeyDown}>
      <ChangesRail changes={changes.data} loading={changes.loading} error={changes.error} current={file?.path ?? path} onPick={(next) => go({ kind: "open", path: next })} onRefresh={() => { changes.reload(); if (!dirty) void reload() }} />
      <section aria-label="File" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
          {path ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {status ? <span title={status.word} className={cn("font-mono text-xs font-semibold", status.tone)}>{status.letter}</span> : <FileCode2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
              <h2 className="min-w-0 truncate text-[0.8125rem]" title={file?.path ?? path}>
                {dir ? <span className="text-muted-foreground">{dir}/</span> : null}
                <span className="font-medium text-foreground">{name}</span>
                {dirty ? <span aria-label="unsaved" title="Unsaved edits" className="ml-1.5 inline-block size-1.5 -translate-y-0.5 rounded-full bg-foreground/70" /> : null}
              </h2>
              {change ? <Counts change={change} /> : null}
            </div>
          ) : (
            <h2 className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted-foreground">Code</h2>
          )}
          {diffable ? (
            <Segmented label="View" value={shownMode} onChange={setMode} items={[{ id: "code", label: "Code" }, { id: "diff", label: "Diff" }]} />
          ) : null}
          {shownMode === "diff" ? (
            <Tip label={layout === "split" ? "Unified diff" : "Side by side"}>
              <button type="button" aria-label="Side by side" aria-pressed={layout === "split"} onClick={() => setDiffLayout(layout === "split" ? "unified" : "split")} className={TOOL}>
                {layout === "split" ? <Rows3 aria-hidden="true" className="size-4" /> : <Columns2 aria-hidden="true" className="size-4" />}
              </button>
            </Tip>
          ) : null}
          <Tip label={wrap ? "Do not wrap lines" : "Wrap long lines"}>
            <button type="button" aria-label="Wrap lines" aria-pressed={wrap} onClick={() => setCodeWrap(!wrap)} className={TOOL}>
              <TextWrap aria-hidden="true" className="size-4" />
            </button>
          </Tip>
          <Tip label="Save" hint="Ctrl+S">
            <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || saving} onClick={() => void save()} aria-keyshortcuts="Control+S Meta+S">
              <Save aria-hidden="true" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </Tip>
          <Tip label="Close" hint={codeKey}>
            <button type="button" aria-label="Close code viewer" onClick={() => go({ kind: "close" })} className={TOOL}>
              <X aria-hidden="true" className="size-4" />
            </button>
          </Tip>
        </header>
        {pending ? (
          <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
            <PenLine aria-hidden="true" className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1">{name} has unsaved edits.</span>
            <Button size="xs" variant="ghost" onClick={() => setPending(undefined)}>Keep editing</Button>
            <Button size="xs" variant="outline" onClick={() => run(pending)}>Discard</Button>
            <Button size="xs" onClick={() => void save()} disabled={saving}>Save</Button>
          </div>
        ) : null}
        {conflict ? (
          <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1">{name} changed on disk since you opened it, maybe by an agent.</span>
            <Button size="xs" variant="outline" onClick={() => { setDraft(undefined); setConflict(false); void reload() }}>Load theirs</Button>
            <Button size="xs" onClick={() => void save(true)} disabled={saving}>Overwrite with mine</Button>
          </div>
        ) : null}
        <div className="code-pane relative flex min-h-0 flex-1 flex-col">
          {error ? (
            <p role="alert" className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground">{error}</p>
          ) : !path ? (
            <Empty loading={changes.loading} />
          ) : !file ? (
            <p role="status" className="m-auto text-xs text-muted-foreground">{loading ? "Opening…" : ""}</p>
          ) : file.binary || file.tooLarge ? (
            <p className="m-auto max-w-sm px-6 text-center text-sm text-muted-foreground">{file.binary ? "This is a binary file, so it is not shown." : "This file is too large to show here."}</p>
          ) : !file.exists && shownMode === "code" ? (
            <p className="m-auto flex max-w-sm flex-col items-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <FileX2 aria-hidden="true" className="size-5" />
              This file was deleted. Switch to Diff to see what it held.
            </p>
          ) : (
            <Suspense fallback={<p role="status" className="m-auto text-xs text-muted-foreground">Loading code…</p>}>
              <CodeSurface
                path={file.path}
                version={`${loaded!.version}`}
                contents={file.contents ?? ""}
                draft={draft}
                original={file.original}
                mode={shownMode}
                layout={layout}
                wrap={wrap}
                dark={dark}
                readOnly={!editable}
                onDraft={setDraft}
              />
            </Suspense>
          )}
        </div>
      </section>
    </div>
  )
}

function Empty({ loading }: { loading: boolean }) {
  return (
    <div className="m-auto flex max-w-xs flex-col items-center gap-2 px-6 text-center">
      <FilePlus2 aria-hidden="true" className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{loading ? "Reading the changes…" : "Pick a changed file, open one by its path, or click a file name in the Lobby chat."}</p>
    </div>
  )
}

/** The pop-up itself; mounted once in the shell. */
export function CodeViewer({ codeKey }: { codeKey?: string | undefined }) {
  const { open, path, mode, request } = useCodeViewer()
  const shown = useOverlaySlot(open, PRIORITY.help)
  const [dirty, setDirty] = useState(false)
  const [closeAsked, setCloseAsked] = useState(0)
  const askClose = () => setCloseAsked((count) => count + 1)
  return (
    <Popup
      open={shown}
      onOpenChange={(next) => {
        if (next) return
        if (dirty) askClose()
        else closeCode()
      }}
      label="Code viewer"
      className="code-pop h-[min(86svh,52rem)] max-h-none max-w-6xl"
      onEscapeKeyDown={(event) => {
        if (dirty) {
          event.preventDefault()
          askClose()
        }
      }}
    >
      {open ? (
        <Workspace
          requested={path}
          requestedMode={mode}
          request={request}
          codeKey={codeKey}
          onClose={closeCode}
          onDirtyChange={setDirty}
          closeAsked={closeAsked}
        />
      ) : null}
    </Popup>
  )
}
