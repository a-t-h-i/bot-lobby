// Adapted from T3 Code (MIT), apps/web/src/components/chat/ComposerSurface.tsx, ChatComposer.tsx, ComposerPrimaryActions.tsx, ComposerControl.tsx
/**
 * The one text box for everything, laid out like the coding harness it takes
 * after: a round card with the attachments and the text on top and a footer
 * row under them, the box's own controls on its left (who the message goes
 * to, the Markdown preview, the Knowledge pane's switch) and its actions on
 * its right (attach, stop, a round send button). A strip tucked under the
 * bottom of the card carries the project (its list opens from there) and the
 * key hints. On a phone the strip stays out (the bar has the project), and on
 * a narrow box the target becomes a menu. It sits under the page (the shell
 * gives it its row), grows with what you type up to a cap, takes images, PDFs
 * and other files (pick, paste or drop them) and sends Markdown to whoever
 * the tab talks to: the oracle everywhere, the planning panel on Plan, a
 * quick fix on Quick fix, a comment on the open task on Tasks. While a pop-up
 * is open it steps aside, so only one thing asks for you at a time.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Eye, FileText, MessageSquare, Paperclip, Square, X } from "lucide-react"
import { Keys, KeyHint } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/reui/select"
import { call } from "@/lib/api"
import { act } from "@/lib/act"
import { useComposerContext } from "@/lib/composerContext"
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
import { useCompactLandscape, useMediaQuery, useTopic } from "./hooks"
import { usePhoneViewport } from "./usePhoneViewport"
import { go, type Route } from "./router"
import { knowledgeHash } from "./knowledgeView"
import { KnowledgePaneToggle } from "./KnowledgePaneToggle"
import { ProjectSwitcher, type Projects } from "./ProjectSwitcher"
import { taskRoute } from "./taskRoute"

type TargetId = "oracle" | "knowledge" | "panel" | "quickfix" | "comment" | "task"

interface Target {
  id: TargetId
  /** The segmented control's word. */
  pill: string
  /** The textarea's accessible name. */
  label: string
  placeholder: string
  taskId?: string
}

const ORACLE: Target = { id: "oracle", pill: "Oracle", label: "Message the oracle", placeholder: "Message the oracle…" }

/** The tabs that carry the composer; everywhere else it stays mounted (drafts and uploads survive) but hidden and inert. */
const COMPOSER_TABS: ReadonlySet<string> = new Set(["lobby", "tasks", "plan", "quickfix", "knowledge"])

export function composerVisible(route: Route): boolean {
  return route.kind === "tab" && COMPOSER_TABS.has(route.tab)
}

/** Who a message can go to from this route: the tab's own target first, the oracle always. */
function targetsFor(route: Route, openTask: string | undefined): Target[] {
  if (route.kind !== "tab") return [ORACLE]
  if (route.tab === "knowledge") return [{ id: "knowledge", pill: "Oracle", label: "Ask the oracle about this project", placeholder: "Ask about this project — the oracle searches the code and learns what is missing…" }]
  if (route.tab === "plan") return [{ id: "panel", pill: "Panel", label: "Message the panel", placeholder: "Describe a task, or answer the panel…" }, ORACLE]
  if (route.tab === "quickfix") return [{ id: "quickfix", pill: "Quick fix", label: "Describe a quick fix", placeholder: "Describe a small change…" }, ORACLE]
  const task = route.tab === "tasks" ? taskRoute(route.rest).id ?? openTask : undefined
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

/** A control in the footer's left group: quiet text until pointed at or on. */
const CONTROL =
  "relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-2.5 text-sm font-medium text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-snap hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-checked:bg-accent aria-checked:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground active:scale-[0.97] motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0"

/** An icon button in the footer's right group. */
const TOOL =
  "toolbar-button composer-tool relative inline-flex size-8 items-center justify-center rounded-full border text-foreground transition-[background-color,border-color,scale] duration-150 ease-snap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.97] motion-reduce:active:scale-100"

/** A chip in the strip under the box. */
const CHIP =
  "composer-chip inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

function isSend(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing
}

const SPRING = { type: "spring", stiffness: 520, damping: 32 } as const

/** An attachment: an image as a 64px thumbnail with its remove button in the corner, any other file as a row. */
function Chip({ file, onRemove }: { file: Pending; onRemove: () => void }) {
  const remove = (
    <button
      type="button"
      aria-label={`Remove ${file.name}`}
      aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
      onClick={onRemove}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        file.image ? "absolute top-1 right-1 size-[1.625rem] rounded-full bg-background/85 text-foreground shadow-xs hover:bg-background" : "size-7"
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
        transition={SPRING}
        title={`${file.name} · ${sizeLabel(file.size)}`}
        className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border/80 bg-background"
      >
        <img src={projectUrl(file.image)} alt={file.name} className="size-full object-cover" />
        {file.state === "uploading" ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/85 px-1 text-[0.625rem] text-foreground">
            <Spinner className="size-2.5" aria-hidden="true" role="presentation" />
            uploading
          </span>
        ) : null}
        {remove}
      </motion.li>
    )
  }
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={SPRING}
      className="flex min-w-0 basis-full items-center gap-2 text-sm text-foreground"
    >
      <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {file.state === "uploading" ? <Spinner className="size-2.5" aria-hidden="true" role="presentation" /> : null}
        {file.state === "uploading" ? "uploading…" : sizeLabel(file.size)}
      </span>
      {remove}
    </motion.li>
  )
}

/**
 * The composer gets out of the way while you read: a scroll of the page under it (by wheel, touch or the
 * scroll keys, not the page following a reply) shrinks it to a slim pill, and focus, or a press on it, opens
 * it back up. It never shrinks while it has focus.
 */
function useShrinkOnScroll(dock: RefObject<HTMLDivElement | null>, active: boolean, route: Route) {
  const [shrunk, setShrunk] = useState(false)
  const place = route.kind === "tab" ? route.tab : route.kind
  useEffect(() => setShrunk(false), [place])
  useEffect(() => {
    if (!active) return
    let intent = 0
    const mark = (event: Event) => {
      if (!dock.current?.contains(event.target as Node)) intent = performance.now()
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "].includes(event.key) && !dock.current?.contains(event.target as Node)) intent = performance.now()
    }
    const onScroll = (event: Event) => {
      const el = dock.current
      if (!el || performance.now() - intent > 400) return
      if (el.contains(document.activeElement) || el.contains(event.target as Node)) return
      setShrunk(true)
    }
    document.addEventListener("wheel", mark, { capture: true, passive: true })
    document.addEventListener("touchmove", mark, { capture: true, passive: true })
    document.addEventListener("keydown", onKey, { capture: true })
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener("wheel", mark, { capture: true })
      document.removeEventListener("touchmove", mark, { capture: true })
      document.removeEventListener("keydown", onKey, { capture: true })
      document.removeEventListener("scroll", onScroll, { capture: true })
    }
  }, [active, dock])
  const expand = useCallback(() => setShrunk(false), [])
  return { shrunk, expand }
}

export function Composer({ route, keys, projects, onHelp, dockNav }: { route: Route; keys: Record<string, string>; projects: Projects; onHelp: () => void; dockNav?: ReactNode }) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Pending[]>([])
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [chosen, setChosen] = useState<TargetId>()
  const status = useTopic<StatusInfo>("status")
  const lobby = useTopic<LobbySnapshot>("lobby")
  const blocked = useAnyOverlay()
  const busy = (status.data?.busy ?? false) || Boolean(lobby.data?.reply?.trim())
  const compact = useCompactLandscape()
  const phone = useMediaQuery("(max-width: 767.98px)")
  const { keyboardOpen, keyboardInset } = usePhoneViewport()

  const visible = composerVisible(route)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const { taskId: openTask } = useComposerContext()
  const targets = useMemo(() => targetsFor(route, openTask), [route, openTask])
  const targetKey = targets.map((entry) => `${entry.id}:${entry.taskId ?? ""}`).join("|")
  const target = targets.find((entry) => entry.id === chosen) ?? targets[0]!
  useEffect(() => setChosen(undefined), [targetKey])

  const card = useRef<HTMLDivElement>(null)
  const { shrunk, expand } = useShrinkOnScroll(card, visible && !blocked, route)
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

  // The toasts sit just above the composer and centred on it, wherever its height and the sidebar have put it.
  useEffect(() => {
    const el = card.current
    if (!el) return
    const root = document.documentElement
    const set = () => {
      const box = el.getBoundingClientRect()
      root.style.setProperty("--composer-h", blocked || !visible ? "0px" : `${Math.ceil(box.height + (phone ? keyboardInset : 0))}px`)
      // A hidden composer measures 0 wide: the toasts then centre on the window instead of shrinking to nothing.
      if (!visible || box.width === 0) {
        root.style.removeProperty("--composer-x")
        root.style.removeProperty("--composer-w")
        return
      }
      root.style.setProperty("--composer-x", `${Math.round(box.left)}px`)
      root.style.setProperty("--composer-w", `${Math.round(box.width)}px`)
    }
    set()
    const observer = new ResizeObserver(set)
    observer.observe(el)
    window.addEventListener("resize", set)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", set)
      root.style.setProperty("--composer-h", "0px")
      root.style.removeProperty("--composer-x")
      root.style.removeProperty("--composer-w")
    }
  }, [blocked, keyboardInset, keyboardOpen, phone, visible])

  const attach = useCallback((list: Iterable<File>) => {
    if (!visibleRef.current) return
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
    if (!canSend || !visibleRef.current) return
    setSending(true)
    const attachments = ready.length > 0 ? ready : undefined
    const body = { text, ...(attachments ? { attachments } : {}) }
    try {
      let done = true
      if (target.id === "oracle") {
        const result = await call("lobby.send", body)
        if (result.notice) toast(result.notice)
      } else if (target.id === "knowledge") {
        done = (await act("knowledge.ask", body)) !== undefined
        if (done && route.kind === "tab") go(knowledgeHash(route.rest, true))
      } else if (target.id === "panel") done = (await act("planner.send", body)) !== undefined
      else if (target.id === "quickfix") done = (await act("quickfix.submit", body)) !== undefined
      else if (target.id === "task") done = (await act("tasks.message", { taskId: target.taskId!, ...body })) !== undefined
      else done = (await act("tasks.comment", { taskId: target.taskId!, ...body })) !== undefined
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
  }, [canSend, ready, target, text, route])

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

  const knowledge = route.kind === "tab" && route.tab === "knowledge"
  // The strip under the box is for a wide screen; a phone has the project in its bar.
  const withStrip = !phone && !compact
  // Who it goes to: a row of choices when the box is wide enough, a menu when it is not.
  const targetControl = targets.length > 1 ? (
    <>
      <div role="radiogroup" aria-label="Send to" className="hidden items-center gap-0.5 @[34rem]/composer:flex">
        {targets.map((entry) => (
          <button
            key={entry.id}
            aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
            type="button"
            role="radio"
            data-compact
            aria-checked={entry.id === target.id}
            onClick={() => setChosen(entry.id)}
            className={CONTROL}
          >
            {entry.pill}
          </button>
        ))}
      </div>
      <div className="@[34rem]/composer:hidden">
        <Select value={target.id} onValueChange={(id) => setChosen(id as TargetId)}>
          <SelectTrigger aria-label="Send to" data-compact className={cn(CONTROL, "w-auto min-w-0 bg-transparent shadow-none data-[state=open]:bg-accent")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targets.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>{entry.pill}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  ) : (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-sm font-medium text-muted-foreground">
      <MessageSquare aria-hidden="true" className="size-4 shrink-0" />
      <span className="hidden @[24rem]/composer:inline">To the {target.pill.toLowerCase()}</span>
      <span className="@[24rem]/composer:hidden">{target.pill}</span>
    </span>
  )
  const project = status.data?.workspace.name ?? "bot-lobby"
  const branch = status.data?.branch ?? status.data?.workspace.branch
  const strip = withStrip ? (
    <div className="composer-strip pointer-events-auto" aria-label="Message context" role="group">
      <ProjectSwitcher look="chip" projects={projects} tab={route.kind === "tab" ? route.tab : route.kind} name={project} branch={branch} />
      <div className="@container ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden">
        {route.kind === "tab" && route.tab === "plan" ? (
          <KeyHint chord={keys.savePlan ?? "Ctrl+S"} className="hidden @[24rem]:inline-flex">
            save plan
          </KeyHint>
        ) : null}
        <KeyHint chord="Shift+Enter" className="hidden @[14rem]:inline-flex">
          new line
        </KeyHint>
        <button
          type="button"
          aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
          aria-label="Keyboard shortcuts"
          aria-haspopup="dialog"
          data-compact
          onClick={onHelp}
          className={cn(CHIP, "kbd-hint shrink-0 px-1.5 text-muted-foreground hover:text-foreground")}
        >
          <Keys chord={keys.help ?? "Alt+H"} className="kbd-hint" />
          <span className="hidden @[8rem]:inline">shortcuts</span>
        </button>
      </div>
    </div>
  ) : null

  return (
    <div
      id="app-dock"
      ref={card}
      data-shrunk={shrunk || undefined}
      onFocus={expand}
      style={phone && keyboardOpen ? { bottom: `${keyboardInset}px` } : undefined}
      className={cn(
        "dock pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-200 ease-snap max-md:px-2",
        phone && keyboardOpen ? "max-md:pb-2" : "max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        blocked && "opacity-0"
      )}
      hidden={!visible}
      aria-hidden={visible ? undefined : true}
      inert={blocked || !visible}
    >
      {dockNav ? <div className="pointer-events-auto mx-auto mb-1.5 w-full max-w-[46rem]">{dockNav}</div> : null}
      <div className="composer-shell mx-auto w-full max-w-[46rem]">
      <div className="pointer-events-auto relative z-10 mx-auto w-full max-w-[46rem]" onPointerDown={expand}>
        <div
          className={cn(
            "group/composer @container/composer composer-box relative rounded-[22px] border border-dock-border bg-dock shadow-dock transition-[border-color,box-shadow,background-color] duration-200 ease-snap focus-within:border-[color-mix(in_oklab,var(--ring)_28%,var(--dock-border))] focus-within:shadow-dock-focus",
            compact && "min-[500px]:max-md:grid min-[500px]:max-md:grid-cols-[minmax(0,1fr)_auto] min-[500px]:max-md:min-w-0",
            dragging && "composer-drop"
          )}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div
            className={cn(
              "composer-text relative px-3 pt-3.5 pb-2 sm:px-4 sm:pt-4",
              compact && "min-[500px]:max-md:col-start-1 min-[500px]:max-md:min-w-0 min-[500px]:max-md:max-w-full min-[500px]:max-md:pt-1 min-[500px]:max-md:pb-1"
            )}
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
                  className="composer-files -mx-1 flex flex-wrap items-end gap-2 overflow-hidden px-1 pt-1 pb-3"
                >
                  {files.map((file) => (
                    <Chip key={file.key} file={file} onRemove={() => forget(file.key)} />
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>

            {preview ? (
              <div aria-label="Markdown preview" role="region" className="mb-3 max-h-48 overflow-y-auto rounded-lg bg-muted/60 px-3 py-2">
                {text.trim() ? <Markdown text={text} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
              </div>
            ) : null}

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
                "block field-sizing-content max-h-[min(45vh,20rem)] min-h-[1.75rem] md:min-h-[2.75rem] w-full min-w-0 resize-none bg-transparent text-base leading-relaxed caret-primary outline-none placeholder:text-muted-foreground md:text-[0.9375rem] md:leading-relaxed",
                compact && "min-[500px]:max-md:max-h-[44px] min-[500px]:max-md:overflow-y-auto"
              )}
            />
          </div>

          <div
            className={cn(
              "composer-tools flex min-w-0 flex-nowrap items-center justify-between gap-3 px-3 pb-3 sm:px-4 sm:pb-3.5",
              compact && "min-[500px]:max-md:col-start-2 min-[500px]:max-md:min-w-0 min-[500px]:max-md:pt-1 min-[500px]:max-md:pb-1"
            )}
          >
            <div className="composer-controls relative -m-1 -ms-2.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 ps-2.5">
              {knowledge ? <KnowledgePaneToggle rest={route.kind === "tab" ? route.rest : []} /> : targetControl}
              <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Preview the Markdown" aria-pressed={preview} aria-keyshortcuts="Alt+P" aria-describedby="focused-action-help" data-compact onClick={() => setPreview((value) => !value)} className={cn(TOOL, "w-auto gap-1.5 rounded-lg px-2 text-sm font-medium @max-[26rem]/composer:w-8 @max-[26rem]/composer:px-0")}>
                    <Eye aria-hidden="true" className="size-4" />
                    <span className="@max-[26rem]/composer:hidden">Preview</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Preview <Keys chord="Alt+P" />
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="composer-actions flex shrink-0 flex-nowrap items-center justify-end gap-2">
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
                  <button type="button" aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help" aria-label="Attach images, PDFs or files" data-compact onPointerDown={(event) => event.preventDefault()} onClick={() => picker.current?.click()} className={TOOL}>
                    <Paperclip aria-hidden="true" className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Attach images, PDFs or files</TooltipContent>
              </Tooltip>
              {busy && target.id === "oracle" ? (
                <ConfirmButton label="Stop" icon={Square} iconOnly compact title="Stop the oracle?" description="The current response stops. Work already recorded is kept." confirmLabel="Stop" variant="destructive" onConfirm={() => void stop()} />
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Send"
                    aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
                    data-compact
                    onClick={() => void send()}
                    disabled={!canSend}
                    className="composer-send relative isolate flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs shadow-primary/24 inset-shadow-[0_1px_rgb(255_255_255/16%)] transition-[background-color,box-shadow,scale,opacity] duration-150 ease-snap outline-none hover:scale-105 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:inset-shadow-[0_1px_rgb(0_0_0/8%)] active:shadow-none disabled:opacity-64 disabled:shadow-none disabled:hover:scale-100 sm:size-8 motion-reduce:hover:scale-100 [&_svg]:pointer-events-none"
                  >
                    {sending ? (
                      <Spinner aria-hidden="true" role="presentation" className="size-3.5 text-primary-foreground" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                        <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Send <Keys chord="Enter" />
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {dragging ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] text-sm font-medium text-primary">
              Drop to attach
            </div>
          ) : null}
        </div>
      </div>
      {strip}
      </div>
    </div>
  )
}
