/**
 * The one text box for everything: a single card with roomy text at the top
 * and, inside it at the bottom, the tools, who it goes to, the key hints and
 * the send button. It floats pinned at the bottom of the window (the shell
 * gives it its overlay container), grows with what you type up to a cap
 * (and opens up to a tall editor), takes images, PDFs and other files (pick,
 * paste or drop them) and sends Markdown to whoever the tab talks to: the
 * oracle everywhere, the planning panel on Plan, a quick fix on Quick fix, a
 * comment on the open task on Tasks. While a pop-up is open it steps aside, so
 * only one thing asks for you at a time.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react"
import { animate, AnimatePresence, motion } from "motion/react"
import { ArrowUp, Eye, FileText, Maximize2, Minimize2, Paperclip, Square, X } from "lucide-react"
import { Keys, KeyHint } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { call } from "@/lib/api"
import { act } from "@/lib/act"
import { useComposerContext, type ComposerSession } from "@/lib/composerContext"
import { useAnyOverlay } from "@/lib/overlay"
import { focusTab } from "@/prompts/nav"
import { toast } from "@/lib/toast"
import { MAX_ATTACHMENTS, sizeLabel, uploadFile } from "@/lib/uploads"
import { Markdown } from "@/ui/Markdown"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { continueList, link, wrap, type Edit } from "./markdownEdit"
import { cn } from "@/lib/utils"
import { projectUrl } from "@/lib/project"
import type { LobbySnapshot, StatusInfo, UploadInfo } from "@protocol"
import { useTopic } from "./hooks"
import { go, type Route } from "./router"

type TargetId = "oracle" | "panel" | "quickfix" | "comment" | "task" | "session" | "newsession"

interface Target {
  id: TargetId
  /** The segmented control's word. */
  pill: string
  /** The textarea's accessible name. */
  label: string
  placeholder: string
  taskId?: string
  session?: ComposerSession
}

const ORACLE: Target = { id: "oracle", pill: "Oracle", label: "Message the oracle", placeholder: "Message the oracle…" }

function decode(part: string | undefined): string | undefined {
  if (!part) return undefined
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** Who a message can go to from this route: the tab's own target first, the oracle always. */
function targetsFor(route: Route, openTask: string | undefined, session: ComposerSession | undefined): Target[] {
  if (route.kind === "sessions") {
    const fresh: Target = { id: "newsession", pill: "New session", label: "Start a task in a new session", placeholder: "Describe a task for a new session…" }
    return session
      ? [{ id: "session", pill: "Message", label: `Message ${session.name}`, placeholder: `Message ${session.name}…`, session }, fresh, ORACLE]
      : [fresh, ORACLE]
  }
  if (route.kind !== "tab") return [ORACLE]
  if (route.tab === "plan") return [{ id: "panel", pill: "Panel", label: "Message the panel", placeholder: "Describe a task, or answer the panel…" }, ORACLE]
  if (route.tab === "quickfix") return [{ id: "quickfix", pill: "Quick fix", label: "Describe a quick fix", placeholder: "Describe a small change…" }, ORACLE]
  const task = route.tab === "tasks" ? decode(route.rest[0]) ?? openTask : undefined
  if (task) {
    return [
      { id: "comment", pill: "Comment", label: `Comment on ${task}`, placeholder: `Comment on ${task}'s plan…`, taskId: task },
      { id: "task", pill: "Task's oracle", label: `Message ${task}'s oracle`, placeholder: `Leave a message for ${task}'s oracle…`, taskId: task },
      ORACLE,
    ]
  }
  return [ORACLE]
}

interface Pending {
  key: string
  name: string
  size: number
  image?: string
  state: "uploading" | "ready"
  info?: UploadInfo
}

let keySeq = 0

/** The flat icon buttons under the box. */
const TOOL =
  "inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"

function isSend(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing
}

function Chip({ file, onRemove }: { file: Pending; onRemove: () => void }) {
  const remove = (
    <button
      type="button"
      aria-label={`Remove ${file.name}`}
      aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
      onClick={onRemove}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40",
        file.image ? "absolute top-1 right-1 size-5 bg-background/80 text-foreground backdrop-blur-sm" : "size-7"
      )}
    >
      <X aria-hidden="true" className="size-3.5" />
    </button>
  )
  if (file.image) {
    return (
      <motion.li
        layout
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: "spring", stiffness: 520, damping: 32 }}
        title={`${file.name} · ${sizeLabel(file.size)}`}
        className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
      >
        <img src={projectUrl(file.image)} alt={file.name} className="size-full object-cover" />
        {file.state === "uploading" ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Spinner className="size-4" aria-hidden="true" role="presentation" />
          </span>
        ) : null}
        {remove}
      </motion.li>
    )
  }
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 520, damping: 32 }}
      className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-muted pr-1 pl-2.5"
    >
      <span className="relative flex shrink-0 items-center justify-center text-muted-foreground">
        <FileText aria-hidden="true" className="size-4" />
        {file.state === "uploading" ? <Spinner className="absolute -right-1 -bottom-1 size-2.5" aria-hidden="true" role="presentation" /> : null}
      </span>
      <span className="min-w-0 max-w-40">
        <span className="block truncate text-xs font-medium">{file.name}</span>
        <span className="block text-[0.65rem] leading-tight text-muted-foreground">{file.state === "uploading" ? "uploading…" : sizeLabel(file.size)}</span>
      </span>
      {remove}
    </motion.li>
  )
}

export function Composer({ route, keys, onHelp }: { route: Route; keys: Record<string, string>; onHelp: () => void }) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Pending[]>([])
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [chosen, setChosen] = useState<TargetId>()
  const status = useTopic<StatusInfo>("status")
  const lobby = useTopic<LobbySnapshot>("lobby")
  const blocked = useAnyOverlay()
  const busy = (status.data?.busy ?? false) || Boolean(lobby.data?.reply?.trim())

  const { taskId: openTask, session: openSession } = useComposerContext()
  const targets = useMemo(() => targetsFor(route, openTask, openSession), [route, openTask, openSession])
  const targetKey = targets.map((entry) => `${entry.id}:${entry.taskId ?? entry.session?.name ?? ""}`).join("|")
  const target = targets.find((entry) => entry.id === chosen) ?? targets[0]!
  useEffect(() => setChosen(undefined), [targetKey])

  const card = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const filesRef = useRef(files)
  filesRef.current = files
  const selection = useRef<{ start: number; end: number } | undefined>(undefined)

  // After a Markdown edit the selection goes where the edit says (the text is controlled, so it must be set after the render).
  useLayoutEffect(() => {
    const pending = selection.current
    const el = field.current
    if (!pending || !el) return
    selection.current = undefined
    el.setSelectionRange(pending.start, pending.end)
  }, [text])

  const edit = useCallback((change: Edit) => {
    selection.current = { start: change.start, end: change.end }
    setText(change.value)
  }, [])

  // The toasts and the page's own bottom padding follow the composer's height.
  useEffect(() => {
    const el = card.current
    if (!el) return
    const root = document.documentElement
    const set = () => root.style.setProperty("--composer-h", blocked ? "0px" : `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const observer = new ResizeObserver(set)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.setProperty("--composer-h", "0px")
    }
  }, [blocked])

  // Opening or closing the tall editor eases the box between its two heights.
  const lastHeight = useRef(0)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const to = el.offsetHeight
    const from = lastHeight.current
    lastHeight.current = to
    if (!from || from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    el.style.height = `${from}px`
    el.style.overflow = "hidden"
    const control = animate(el, { height: `${to}px` }, { type: "spring", stiffness: 380, damping: 34 })
    void control.finished.then(() => {
      el.style.height = ""
      el.style.overflow = ""
      lastHeight.current = el.offsetHeight
    })
    return () => control.stop()
  }, [expanded])

  const attach = useCallback((list: Iterable<File>) => {
    const incoming = [...list]
    const room = MAX_ATTACHMENTS - filesRef.current.length
    if (incoming.length > room) toast.warning(`At most ${MAX_ATTACHMENTS} files go with one message.`)
    for (const file of incoming.slice(0, Math.max(0, room))) {
      const key = `f${++keySeq}`
      const image = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
      setFiles((now) => [...now, { key, name: file.name || (image ? "image.png" : "file"), size: file.size, ...(image ? { image } : {}), state: "uploading" }])
      uploadFile(file)
        .then((info) => setFiles((now) => now.map((entry) => (entry.key === key ? { ...entry, state: "ready", info } : entry))))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "That file did not upload.")
          setFiles((now) => now.filter((entry) => entry.key !== key))
        })
    }
  }, [])

  const forget = useCallback((key: string) => {
    setFiles((now) => {
      const gone = now.find((entry) => entry.key === key)
      if (gone?.image) URL.revokeObjectURL(gone.image)
      return now.filter((entry) => entry.key !== key)
    })
  }, [])

  const uploading = files.some((entry) => entry.state === "uploading")
  const ready = files.flatMap((entry) => (entry.info ? [entry.info.id] : []))
  const canSend = (text.trim().length > 0 || ready.length > 0) && !uploading && !sending

  const send = useCallback(async () => {
    if (!canSend) return
    setSending(true)
    const attachments = ready.length > 0 ? ready : undefined
    const body = { text, ...(attachments ? { attachments } : {}) }
    try {
      let done = true
      if (target.id === "oracle") {
        const result = await call("lobby.send", body)
        if (result.notice) toast(result.notice)
      } else if (target.id === "panel") done = (await act("planner.send", body)) !== undefined
      else if (target.id === "quickfix") done = (await act("quickfix.submit", body)) !== undefined
      else if (target.id === "task") done = (await act("tasks.message", { taskId: target.taskId!, ...body })) !== undefined
      else if (target.id === "session") done = (await act("sessions.message", { ...target.session!.address, ...body })) !== undefined
      else if (target.id === "newsession") {
        const result = await act("sessions.start", { request: text, ...(attachments ? { attachments } : {}) })
        done = result !== undefined
        if (result?.key) go(`#/sessions/${encodeURIComponent(result.key)}`)
      } else done = (await act("tasks.comment", { taskId: target.taskId!, ...body })) !== undefined
      if (done) {
        setText("")
        for (const entry of filesRef.current) if (entry.image) URL.revokeObjectURL(entry.image)
        setFiles([])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send")
    } finally {
      setSending(false)
    }
  }, [canSend, ready, target, text])

  const stop = useCallback(async () => {
    try {
      await call("lobby.abort", {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop")
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      // Esc leaves the box (what you typed stays) for the tab bar.
      event.preventDefault()
      focusTab()
      return
    }
    const box = event.currentTarget
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ["b", "i", "e", "k"].includes(key)) {
      // Ctrl+B bold, Ctrl+I italic, Ctrl+E code, Ctrl+K link.
      event.preventDefault()
      const { selectionStart: from, selectionEnd: to, value } = box
      edit(key === "k" ? link(value, from, to) : wrap(value, from, to, key === "b" ? "**" : key === "i" ? "_" : "`"))
      return
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && key === "p") {
      event.preventDefault()
      setPreview((value) => !value)
      return
    }
    if (event.key === "Enter" && event.shiftKey && !event.nativeEvent.isComposing && box.selectionStart === box.selectionEnd) {
      // Shift+Enter on a list line carries the list on.
      const next = continueList(box.value, box.selectionStart)
      if (next) {
        event.preventDefault()
        edit(next)
      }
      return
    }
    if (event.key === "Backspace" && box.value === "" && filesRef.current.length > 0) {
      // Backspace in an empty box takes the last attachment off.
      event.preventDefault()
      forget(filesRef.current.at(-1)!.key)
      return
    }
    if (!isSend(event) && !(event.key === "Enter" && (event.metaKey || event.ctrlKey))) return
    event.preventDefault()
    void send()
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files]
    if (pasted.length === 0) return
    event.preventDefault()
    attach(pasted)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length > 0) attach(event.dataTransfer.files)
  }

  return (
    <div
      ref={card}
      className={cn("pointer-events-auto px-4 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-opacity duration-200 ease-snap", blocked && "opacity-0")}
      inert={blocked}
    >
      <div className={cn("mx-auto w-full transition-[max-width] duration-300 ease-snap", expanded ? "max-w-4xl" : "max-w-3xl")}>
        <div
          className={cn(
            "group/composer relative rounded-lg border border-input bg-card shadow-card transition-[border-color,box-shadow] duration-200 ease-snap focus-within:border-ring/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_16%,transparent)]",
            dragging && "border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_30%,transparent)]"
          )}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <AnimatePresence initial={false}>
            {files.length > 0 ? (
              <motion.ul
                key="files"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                aria-label="Attachments"
                className="flex flex-wrap items-end gap-2 overflow-hidden px-3 pt-3"
              >
                {files.map((file) => (
                  <Chip key={file.key} file={file} onRemove={() => forget(file.key)} />
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>

          {preview ? (
            <div aria-label="Markdown preview" role="region" className="max-h-48 overflow-y-auto border-b border-border px-4 py-3">
              {text.trim() ? <Markdown text={text} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
            </div>
          ) : null}

          <div ref={area} className="flex px-4 pt-3 pb-1">
            <textarea
              ref={field}
              id="composer-text"
              aria-label={target.label}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={busy && target.id === "oracle" ? "The oracle is working. Enter steers it…" : target.placeholder}
              rows={1}
              className={cn(
                "w-full min-w-0 flex-1 resize-none bg-transparent text-base leading-relaxed caret-primary outline-none placeholder:text-muted-foreground/80 md:text-[0.9375rem] md:leading-relaxed",
                "field-sizing-content",
                expanded ? "max-h-[40vh] min-h-[min(30vh,24rem)]" : "max-h-[40vh] min-h-[1.75rem]"
              )}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-2 pt-1 pb-2">
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              aria-label="Attach files"
              onChange={(event) => {
                attach(event.target.files ?? [])
                event.target.value = ""
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help" aria-label="Attach images, PDFs or files" onClick={() => picker.current?.click()} className={TOOL}>
                  <Paperclip aria-hidden="true" className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Attach images, PDFs or files</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
                  aria-label={expanded ? "Make the box smaller" : "Open the box wider and taller"}
                  aria-pressed={expanded}
                  onClick={() => setExpanded((value) => !value)}
                  className={cn(TOOL, expanded && "bg-tab text-foreground")}
                >
                  {expanded ? <Minimize2 aria-hidden="true" className="size-4" /> : <Maximize2 aria-hidden="true" className="size-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{expanded ? "Smaller" : "Bigger"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Preview the Markdown" aria-pressed={preview} aria-keyshortcuts="Alt+P Enter Space" aria-describedby="focused-action-help" onClick={() => setPreview((value) => !value)} className={cn(TOOL, preview && "bg-tab text-foreground")}>
                  <Eye aria-hidden="true" className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Preview <Keys chord="Alt+P" />
              </TooltipContent>
            </Tooltip>

            <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-border" />
            {targets.length > 1 ? (
              <div role="radiogroup" aria-label="Send to" className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
                {targets.map((entry) => (
                  <button
                    key={entry.id}
                    aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
                    type="button"
                    role="radio"
                    aria-checked={entry.id === target.id}
                    onClick={() => setChosen(entry.id)}
                    className={cn(
                      "h-6 rounded-[6px] px-2.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                      entry.id === target.id ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {entry.pill}
                  </button>
                ))}
              </div>
            ) : (
              <span className="px-1 text-xs text-muted-foreground">To the {target.pill.toLowerCase()}</span>
            )}

            <div className="@container ml-auto flex min-w-0 flex-1 items-center justify-end overflow-hidden px-2">
              <div className="flex items-center justify-end gap-3.5">
                {route.kind === "tab" && route.tab === "plan" ? (
                  <KeyHint chord={keys.savePlan ?? "Ctrl+S"} className="hidden @[30rem]:inline-flex">
                    save plan
                  </KeyHint>
                ) : null}
                <KeyHint chord="Shift+Enter" className="hidden @[22rem]:inline-flex">
                  new line
                </KeyHint>
                <KeyHint chord="Enter" className="hidden @[11rem]:inline-flex">
                  send
                </KeyHint>
                <button
                  type="button"
                  aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
                  aria-label="Keyboard shortcuts"
                  aria-haspopup="dialog"
                  onClick={onHelp}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <Keys chord={keys.help ?? "Alt+H"} />
                  <span className="hidden @[8rem]:inline">shortcuts</span>
                </button>
              </div>
            </div>

            {busy && target.id === "oracle" ? (
              <ConfirmButton label="Stop" icon={Square} title="Stop the oracle?" description="The current response stops. Work already recorded is kept." confirmLabel="Stop" variant="destructive" onConfirm={() => void stop()} />
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Send"
                  aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
                  onClick={() => void send()}
                  disabled={!canSend}
                  className="inline-flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-[background-color,color,transform,filter] duration-150 ease-snap outline-none hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95 disabled:bg-muted disabled:text-muted-foreground disabled:hover:brightness-100"
                >
                  {sending ? <Spinner aria-hidden="true" role="presentation" className="size-4 text-primary-foreground" /> : <ArrowUp aria-hidden="true" className="size-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Send <Keys chord="Enter" />
              </TooltipContent>
            </Tooltip>
          </div>

          {dragging ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-card/90 text-sm font-medium text-primary backdrop-blur-[2px]">
              Drop to attach
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
