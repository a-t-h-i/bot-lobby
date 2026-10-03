/**
 * The one text box for everything, floating at the bottom of the window: a
 * pane of glass that grows with what you type (and opens up to a tall editor
 * with the expand key), takes images, PDFs and other files (pick, paste or
 * drop them) and sends Markdown to whoever the tab talks to: the oracle
 * everywhere, the planning panel on Plan, a quick fix on Quick fix, a comment
 * on the open task on Tasks. While a pop-up is open it steps aside, so only
 * one thing asks for you at a time.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react"
import { animate, AnimatePresence, motion } from "motion/react"
import { ArrowUp, FileText, Maximize2, Minimize2, Paperclip, Square, X } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { call } from "@/lib/api"
import { act } from "@/lib/act"
import { useComposerContext, type ComposerSession } from "@/lib/composerContext"
import { useAnyOverlay } from "@/lib/overlay"
import { toast } from "@/lib/toast"
import { MAX_ATTACHMENTS, sizeLabel, uploadFile } from "@/lib/uploads"
import { cn } from "@/lib/utils"
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

function isSend(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing
}

function Chip({ file, onRemove }: { file: Pending; onRemove: () => void }) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 520, damping: 32 }}
      className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card/60 py-1 pr-1 pl-1"
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {file.image ? <img src={file.image} alt="" className="size-full object-cover" /> : <FileText aria-hidden="true" className="size-4" />}
        {file.state === "uploading" ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Spinner className="size-4" aria-hidden="true" role="presentation" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 max-w-40">
        <span className="block truncate text-xs font-medium">{file.name}</span>
        <span className="block text-[0.7rem] text-muted-foreground">{file.state === "uploading" ? "uploading…" : sizeLabel(file.size)}</span>
      </span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </motion.li>
  )
}

export function Composer({ route }: { route: Route }) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Pending[]>([])
  const [expanded, setExpanded] = useState(false)
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

  // The toasts and the page's own bottom padding follow the composer's height.
  useEffect(() => {
    const el = card.current
    if (!el) return
    const root = document.documentElement
    const set = () => root.style.setProperty("--composer-h", `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const observer = new ResizeObserver(set)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty("--composer-h")
    }
  }, [])

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
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4 transition-[opacity,transform] duration-200 ease-snap",
        blocked && "translate-y-3 opacity-0"
      )}
      inert={blocked}
    >
      <div
        ref={card}
        className={cn(
          "glass group/composer pointer-events-auto w-full rounded-3xl p-2 transition-[max-width,box-shadow,border-color] duration-300 ease-snap focus-within:border-ring/50",
          expanded ? "max-w-4xl" : "max-w-3xl",
          dragging && "border-primary ring-3 ring-ring/30"
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
              className="flex flex-wrap gap-2 overflow-hidden px-1"
            >
              {files.map((file) => (
                <Chip key={file.key} file={file} onRemove={() => forget(file.key)} />
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>

        <div ref={area} className="flex flex-col">
          <textarea
            ref={field}
            id="composer-text"
            aria-label={target.label}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={busy && target.id === "oracle" ? "The oracle is working — Enter steers it…" : target.placeholder}
            rows={1}
            className={cn(
              "w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-base leading-relaxed caret-primary outline-none placeholder:text-muted-foreground md:text-[0.95rem]",
              "field-sizing-content",
              expanded ? "min-h-[min(46svh,24rem)] max-h-[60svh]" : "max-h-40 min-h-11"
            )}
          />
        </div>

        <div className="flex items-center gap-1 pt-1">
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
              <button
                type="button"
                aria-label="Attach images, PDFs or files"
                onClick={() => picker.current?.click()}
                className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"
              >
                <Paperclip aria-hidden="true" className="size-[1.1rem]" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Attach images, PDFs or files</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={expanded ? "Make the box smaller" : "Open the box wider and taller"}
                aria-pressed={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"
              >
                {expanded ? <Minimize2 aria-hidden="true" className="size-4" /> : <Maximize2 aria-hidden="true" className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{expanded ? "Smaller" : "Bigger"}</TooltipContent>
          </Tooltip>

          {targets.length > 1 ? (
            <div role="radiogroup" aria-label="Send to" className="ml-1 flex items-center gap-1 rounded-full bg-muted p-0.5">
              {targets.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={entry.id === target.id}
                  onClick={() => setChosen(entry.id)}
                  className={cn(
                    "h-10 rounded-full px-3.5 text-xs font-medium transition-[background-color,color] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    entry.id === target.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {entry.pill}
                </button>
              ))}
            </div>
          ) : (
            <span className="ml-1 px-2 text-xs text-muted-foreground">To the {target.pill.toLowerCase()}</span>
          )}

          <span className="mx-2 hidden min-w-0 flex-1 truncate text-right text-[0.7rem] text-muted-foreground group-focus-within/composer:inline sm:inline-block sm:opacity-0 sm:transition-opacity group-focus-within/composer:sm:opacity-100">
            Enter sends · Shift+Enter new line · Markdown works
          </span>
          <span className="flex-1 sm:hidden" />

          {busy && target.id === "oracle" ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => void stop()}
              className="inline-flex size-10 items-center justify-center rounded-full bg-secondary text-foreground transition-[background-color,transform] duration-150 ease-snap outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"
            >
              <Square aria-hidden="true" className="size-3.5 fill-current" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Send"
            onClick={() => void send()}
            disabled={!canSend}
            className="inline-flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[opacity,transform,filter] duration-150 ease-snap outline-none hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-90 disabled:opacity-40 disabled:hover:brightness-100"
          >
            {sending ? <Spinner aria-hidden="true" role="presentation" className="size-4 text-primary-foreground" /> : <ArrowUp aria-hidden="true" className="size-[1.15rem]" />}
          </button>
        </div>
      </div>
    </div>
  )
}
