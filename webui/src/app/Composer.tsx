// Adapted from T3 Code (MIT), apps/web/src/components/chat/ComposerSurface.tsx, ChatComposer.tsx, ComposerPrimaryActions.tsx, ComposerControl.tsx
/**
 * The one text box for everything, built from the coding harness's own
 * composer (ComposerSurface, ComposerControl, ComposerPrimaryActions, copied
 * into ./composer): a glass box with the attachments and the text on top and a
 * footer row under them: the Knowledge pane toggle on its left (on Knowledge),
 * attach, stop and a round send button on its right. The context
 * strip tucked under the box carries the project (its explorer opens from
 * there) and the key hints. It grows with what you type up to a cap, takes images, PDFs and
 * other files (pick, paste or drop them) and sends Markdown to whoever the page
 * talks to, with no picker: the team's chat on Lobby and Tasks, the docs on
 * Knowledge, the planning panel on Plan, a comment on the open task's plan on
 * Tasks. In the chat, a message that starts with `@` names the agent who
 * answers and one that starts with `/` is a command (`/plan`, `/task`); a
 * drawer of suggestions rises out of the box while you type either (see
 * ./composer/ComposerCommandMenu). While a pop-up is open it steps aside, so
 * only one thing asks for you at a time.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react"
import { AnimatePresence, motion } from "motion/react"
import { FileText, Paperclip, X } from "lucide-react"
import { KeyHint } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { call } from "@/lib/api"
import { act } from "@/lib/act"
import { useComposerContext } from "@/lib/composerContext"
import { useAnyOverlay } from "@/lib/overlay"
import { focusTab } from "@/prompts/nav"
import { toast } from "@/lib/toast"
import { MAX_ATTACHMENTS, sizeLabel, uploadFile } from "@/lib/uploads"
import { continueList, link, wrap, type Edit } from "./markdownEdit"
import { cn } from "@/lib/utils"
import { projectUrl } from "@/lib/project"
import type { LobbySnapshot, StatusInfo, UploadInfo } from "@protocol"
import { useTopic } from "./hooks"
import { go, parseHash, tabHash, type Route } from "./router"
import { knowledgeHash } from "./knowledgeView"
import { KnowledgePaneToggle } from "./KnowledgePaneToggle"
import { ProjectSwitcher, type Projects } from "./ProjectSwitcher"
import { taskRoute } from "./taskRoute"
import { ComposerSurface } from "./composer/ComposerSurface"
import { ComposerSendButton, ComposerStopButton } from "./composer/ComposerPrimaryActions"
import { ComposerCommandMenu, composerItems, composerSuggestionOptionId, composerTrigger, type ComposerCommandItem } from "./composer/ComposerCommandMenu"

type TargetId = "oracle" | "knowledge" | "panel" | "comment"

interface Target {
  id: TargetId
  /** The textarea's accessible name. */
  label: string
  placeholder: string
  taskId?: string
}

const ORACLE: Target = { id: "oracle", label: "Message the team", placeholder: "Message the team… @ picks who answers, / for /plan and /task" }

/** The tabs that carry the composer; everywhere else it stays mounted (drafts and uploads survive) but hidden and inert. */
const COMPOSER_TABS: ReadonlySet<string> = new Set(["lobby", "tasks", "plan", "knowledge"])

export function composerVisible(route: Route): boolean {
  return route.kind === "tab" && COMPOSER_TABS.has(route.tab)
}

/** The one recipient this route's messages go to: the page decides, the user does not pick. */
function targetFor(route: Route, openTask: string | undefined): Target {
  if (route.kind !== "tab") return ORACLE
  if (route.tab === "knowledge") return { id: "knowledge", label: "Ask the oracle about this project", placeholder: "Ask about this project — the oracle searches the code and learns what is missing…" }
  if (route.tab === "plan") return { id: "panel", label: "Message the panel", placeholder: "Describe a task, or answer the panel…" }
  const task = route.tab === "tasks" ? taskRoute(route.rest).id ?? openTask : undefined
  return task ? { id: "comment", label: `Comment on ${task}`, placeholder: `Comment on ${task}'s plan…`, taskId: task } : ORACLE
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

const EASE = { duration: 0.16, ease: "easeOut" } as const

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
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={EASE}
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
      transition={EASE}
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

export function Composer({ route, projects }: { route: Route; projects: Projects }) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Pending[]>([])
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const status = useTopic<StatusInfo>("status")
  const lobby = useTopic<LobbySnapshot>("lobby")
  const blocked = useAnyOverlay()
  const busy = (status.data?.busy ?? false) || Boolean(lobby.data?.reply?.trim())

  const visible = composerVisible(route)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const { taskId: openTask } = useComposerContext()
  const target = useMemo(() => targetFor(route, openTask), [route, openTask])

  const card = useRef<HTMLDivElement>(null)
  const { shrunk, expand } = useShrinkOnScroll(card, visible && !blocked, route)
  const field = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const filesRef = useRef(files)
  filesRef.current = files
  const selection = useRef<{ start: number; end: number } | undefined>(undefined)
  // The `/command` or `@agent` drawer: where the caret is, which row is lit, and the text Esc closed it for.
  const [caret, setCaret] = useState(0)
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [dismissedFor, setDismissedFor] = useState<string | undefined>(undefined)
  const trigger = target.id === "oracle" ? composerTrigger(text, caret) : undefined
  const menuItems = useMemo(() => (trigger ? composerItems(trigger) : []), [trigger?.kind, trigger?.query])
  const menuOpen = Boolean(trigger) && menuItems.length > 0 && dismissedFor !== text && visible && !blocked
  const lit = menuOpen ? (menuItems.find((item) => item.id === activeItem) ?? menuItems[0]!) : undefined
  const listId = "composer-suggestions"
  const pick = useCallback((item: ComposerCommandItem) => {
    const rest = text.replace(/^\s*[/@][a-z]*\s*/i, "")
    const value = `${item.insert} ${rest}`
    const end = item.insert.length + 1
    selection.current = { start: end, end }
    setCaret(end)
    setText(value)
    setActiveItem(null)
    field.current?.focus()
  }, [text])

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
    setCaret(change.end)
    setText(change.value)
  }, [])

  // The toasts sit just above the composer and centred on it, wherever its height and the sidebar have put it.
  useEffect(() => {
    const el = card.current
    if (!el) return
    const root = document.documentElement
    const set = () => {
      const box = el.getBoundingClientRect()
      root.style.setProperty("--composer-h", blocked || !visible ? "0px" : `${Math.ceil(box.height)}px`)
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
  }, [blocked, visible])

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
        if (result.open === "plan") go(tabHash("plan"))
      } else if (target.id === "knowledge") {
        done = (await act("knowledge.ask", body)) !== undefined
        const now = parseHash(window.location.hash)
        if (done && now?.kind === "tab" && now.tab === "knowledge") go(knowledgeHash(now.rest, true))
      } else if (target.id === "panel") done = (await act("planner.send", body)) !== undefined
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
    if (menuOpen && lit && !event.nativeEvent.isComposing) {
      const at = menuItems.indexOf(lit)
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const next = (at + (event.key === "ArrowDown" ? 1 : -1) + menuItems.length) % menuItems.length
        setActiveItem(menuItems[next]!.id)
        return
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault()
        pick(lit)
        return
      }
      if (event.key === "Escape") {
        // Esc closes the drawer first; the next one leaves the box.
        event.preventDefault()
        setDismissedFor(text)
        return
      }
    }
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
  const project = status.data?.workspace.name ?? "bot-lobby"
  const branch = status.data?.branch ?? status.data?.workspace.branch
  const strip = (
    <div className="min-h-0">
      <div className="relative z-0">
        <ComposerSurface.ContextStrip role="group" aria-label="Message context" className="composer-strip gap-1 text-xs font-normal text-muted-foreground/70">
          <ProjectSwitcher projects={projects} tab={route.kind === "tab" ? route.tab : route.kind} name={project} branch={branch} />
          <div className="@container ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden pe-1">
            <KeyHint chord="Shift+Enter" className="hidden @[14rem]:inline-flex">
              new line
            </KeyHint>
          </div>
        </ComposerSurface.ContextStrip>
      </div>
    </div>
  )

  return (
    <div
      id="app-dock"
      ref={card}
      data-shrunk={shrunk || undefined}
      onFocus={expand}
      className={cn(
        "dock pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-200 ease-snap",
        blocked && "opacity-0"
      )}
      hidden={!visible}
      aria-hidden={visible ? undefined : true}
      inert={blocked || !visible}
    >
      <ComposerSurface.Shell contextStrip className="composer-shell pointer-events-auto">
        <AnimatePresence initial={false}>
          {menuOpen && trigger && lit ? (
            <motion.div
              key="commands"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={EASE}
              data-composer-drawer-layer="true"
              className="absolute inset-x-(--chat-composer-drawer-inset) bottom-full z-0 -mb-[calc(1rem+1px)] flex flex-col"
            >
              <ComposerCommandMenu listId={listId} items={menuItems} triggerKind={trigger.kind} activeItemId={lit.id} onHighlightedItemChange={setActiveItem} onSelect={pick} />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <ComposerSurface.Host onPointerDown={expand}>
          <div className="relative z-10">
            <ComposerSurface.Main
              className="group/composer composer-box"
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div
                data-chat-composer-surface="true"
                className={cn(
                  "rounded-3xl transition-[background-color] duration-200",
                  dragging && "bg-accent/45 ring-1 ring-inset ring-primary/70"
                )}
              >
                <div
                  data-chat-composer-body="true"
                  className={cn(
                    "composer-text relative px-3 pb-2 sm:px-4",
                    "pt-3.5 sm:pt-4"
                  )}
                >
                  <AnimatePresence initial={false}>
                    {files.length > 0 ? (
                      <motion.ul
                        key="files"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        aria-label="Attachments"
                        className="composer-files mb-3 flex max-w-full flex-wrap gap-2 overflow-hidden"
                      >
                        {files.map((file) => (
                          <Chip key={file.key} file={file} onRemove={() => forget(file.key)} />
                        ))}
                      </motion.ul>
                    ) : null}
                  </AnimatePresence>

                  <div className="relative flow-root font-sans text-sm max-sm:pointer-coarse:text-base">
                    <textarea
                      ref={field}
                      id="composer-text"
                      aria-label={target.label}
                      {...(target.id === "oracle" ? { role: "combobox", "aria-autocomplete": "list" as const, "aria-expanded": menuOpen, "aria-controls": menuOpen ? listId : undefined } : {})}
                      {...(lit ? { "aria-activedescendant": composerSuggestionOptionId(listId, lit.id) } : {})}
                      value={text}
                      onChange={(event) => {
                        setText(event.target.value)
                        setCaret(event.target.selectionStart)
                      }}
                      onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
                      onKeyDown={onKeyDown}
                      onPaste={onPaste}
                      placeholder={busy && target.id === "oracle" ? "The oracle is working. Enter steers it…" : target.placeholder}
                      rows={1}
                      className={cn(
                        "-m-1 block field-sizing-content max-h-52 min-h-19.5 w-[calc(100%+0.5rem)] resize-none overflow-y-auto bg-transparent p-1 leading-relaxed whitespace-pre-wrap text-foreground caret-primary outline-none placeholder:text-placeholder/75"
                      )}
                    />
                  </div>
                </div>

                <div
                  data-chat-composer-footer="true"
                  className={cn(
                    "composer-tools flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-3 pb-3 sm:gap-0 sm:px-4 sm:pb-4"
                  )}
                >
                  <div
                    data-chat-composer-controls="left"
                    className="composer-controls relative -m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 ps-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {knowledge ? <KnowledgePaneToggle rest={route.kind === "tab" ? route.rest : []} /> : null}
                  </div>

                  <div data-chat-composer-actions="right" className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Attach images, PDFs or files"
                          data-compact
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => picker.current?.click()}
                          className="pointer-coarse:after:absolute pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11"
                        >
                          <Paperclip aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Attach files</TooltipContent>
                    </Tooltip>
                    {busy && target.id === "oracle" ? <ComposerStopButton onStop={() => void stop()} /> : null}
                    <ComposerSendButton sending={sending} disabled={!canSend} steering={busy && target.id === "oracle"} onSend={() => void send()} />
                  </div>
                </div>
              </div>

              {dragging ? (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] text-sm font-medium text-primary">
                  Drop to attach
                </div>
              ) : null}
            </ComposerSurface.Main>
          </div>
        </ComposerSurface.Host>
        {strip}
      </ComposerSurface.Shell>
    </div>
  )
}
