/**
 * The one text box for everything, after the user's design (docs/web-ui/composer-design): one fluid bubble (see
 * ./composer/ComposerSurface) with the attachments and the text on top and a tools row under them: attach, the
 * project chip and the Knowledge pane toggle (on Knowledge) on the left, the key hints, stop and a round send key on
 * the right. The `/` suggestions, the `@` agents, the attach menu, the running projects and the folder browser grow
 * out of its top edge as smaller bubbles that merge with it. It grows with what you type up to a cap, takes images,
 * PDFs and other files (pick, paste or drop them) and sends Markdown to whoever the page talks to, with no picker:
 * the team's chat on Lobby and Tasks, the docs on Knowledge, the planning panel on Plan, a comment on the open
 * task's plan on Tasks. In the chat, a message that starts with `@` names the agent who answers and one that starts
 * with `/` is a command (`/plan`, `/task`). While a pop-up is open it steps aside, so only one thing asks for you at
 * a time.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type RefObject } from "react"
import { AnimatePresence, motion } from "motion/react"
import { FileText, Image, Paperclip, X } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { useHotkey } from "@/lib/hotkeys"
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
import { go, tabHash, type Route } from "./router"
import { OPEN_PROJECTS, ProjectChip, ProjectsPane, projectsSize, type Projects } from "./ProjectSwitcher"
import { FOLDER_SIZE, FolderPane } from "./ProjectFolderDialog"
import { taskRoute } from "./taskRoute"
import { ComposerBubble } from "./composer/ComposerSurface"
import { MarkdownMirror } from "./composer/MarkdownMirror"
import { ComposerSendButton, ComposerStopButton } from "./composer/ComposerPrimaryActions"
import { ComposerCommandMenu, composerItems, composerSuggestionOptionId, composerTrigger, suggestionHeight, suggestionWidth, type ComposerCommandItem } from "./composer/ComposerCommandMenu"
import { DrawerPane, MockupLightbox, type Drawer } from "@/prompts/Drawer"
import { setPutAway } from "@/prompts/putAway"
import { hasMockup } from "@/prompts/MockupViewer"
import { KNOWLEDGE_ASKED, useViewPlan } from "@/lib/composerBubbles"

type TargetId = "oracle" | "knowledge" | "panel" | "comment"

interface Target {
  id: TargetId
  /** The textarea's accessible name. */
  label: string
  placeholder: string
  taskId?: string
}

const ORACLE: Target = { id: "oracle", label: "Message the team", placeholder: "Write a message, run a command, or ask an agent" }

/** The tabs that carry the composer (Settings too); everywhere else it stays mounted (drafts and uploads survive) but hidden and inert. */
const COMPOSER_TABS: ReadonlySet<string> = new Set(["lobby", "tasks", "plan", "knowledge"])

export function composerVisible(route: Route): boolean {
  return route.kind === "settings" || (route.kind === "tab" && COMPOSER_TABS.has(route.tab))
}

const ASK_KNOWLEDGE: Target = { id: "knowledge", label: "Ask what the agents know", placeholder: "Ask what the agents know…" }

/** The one recipient this route's messages go to: the page decides, the user does not pick (on Knowledge, "Ask the knowledge" turns asking on). */
function targetFor(route: Route, openTask: string | undefined, asking: boolean): Target {
  if (route.kind !== "tab") return ORACLE
  if (route.tab === "knowledge") return asking ? ASK_KNOWLEDGE : ORACLE
  if (route.tab === "plan") return { id: "panel", label: "Message the panel", placeholder: "Describe a task, or answer the panel…" }
  const task = route.tab === "tasks" ? taskRoute(route.rest).id ?? openTask : undefined
  return task ? { id: "comment", label: `Comment on ${task}`, placeholder: `Comment on ${task}'s plan…`, taskId: task } : ORACLE
}

/**
 * A bubble that grows out of the composer's top: the suggestions, one of the panels a button opens, the question
 * drawer, or the bar of bubbles (Answer questions, View plan, Ask the knowledge) that waits there otherwise.
 */
type Pane = "suggest" | "attach" | "projects" | "browse" | "ask" | "bar"
type Panel = Exclude<Pane, "suggest" | "ask" | "bar">

const ATTACH_SIZE = { w: 300, h: 125 } as const

interface Pending {
  key: string
  name: string
  size: number
  image?: string
  state: "uploading" | "ready"
  info?: UploadInfo
}

let keySeq = 0
/** Measures the message box's lines, for its width. */
const measure = document.createElement("canvas").getContext("2d")!

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
        className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-(--bubble-edge) bg-background"
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
 * it back up. It never shrinks while it has focus or while one of its bubbles is open.
 */
function useShrinkOnScroll(dock: RefObject<HTMLDivElement | null>, active: boolean, route: Route, hold: boolean) {
  const [shrunk, setShrunk] = useState(false)
  const holdRef = useRef(hold)
  holdRef.current = hold
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
      if (!el || holdRef.current || performance.now() - intent > 400) return
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

/** A key cap in the tools row's hints. */
function Kbd({ children }: { children: string }) {
  return <kbd className="bubble-kbd">{children}</kbd>
}

/** A pane that sizes its bubble from its own content: its width (bar) or its height (drawer), measured after each render. */
/** `wide` is the drawer's width when its question shows mockups (the composer's own); otherwise it is 580px. */
function useMeasured(pane: Pane, ref: RefObject<HTMLDivElement | null>, wide?: number): { w: number; h: number } {
  const [size, setSize] = useState({ w: 250, h: 48 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const next = pane === "bar" ? { w: Math.ceil(el.scrollWidth) + 12, h: 48 } : { w: wide ?? 580, h: Math.ceil(el.scrollHeight) }
      setSize((now) => (now.w === next.w && now.h === next.h ? now : next))
    }
    measure()
    // Content that settles after the first paint (mockups, fonts, a wrapped question) is measured again.
    const observer = new ResizeObserver(measure)
    for (const child of el.children) observer.observe(child)
    return () => observer.disconnect()
  })
  return size
}

export function Composer({ route, projects, drawer, drawerOpen }: { route: Route; projects: Projects; drawer: Drawer; drawerOpen: boolean }) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Pending[]>([])
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  const status = useTopic<StatusInfo>("status")
  const lobby = useTopic<LobbySnapshot>("lobby")
  const blocked = useAnyOverlay()
  const busy = (status.data?.busy ?? false) || Boolean(lobby.data?.reply?.trim())

  const visible = composerVisible(route)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const { taskId: openTask } = useComposerContext()
  const tab = route.kind === "tab" ? route.tab : route.kind
  // "Ask the knowledge": on Knowledge, the box asks what the agents know until Esc or the question goes.
  const [asking, setAsking] = useState(false)
  useEffect(() => setAsking(false), [tab])
  const target = useMemo(() => targetFor(route, openTask, asking), [route, openTask, asking])
  const viewPlan = useViewPlan()
  const [mockup, setMockup] = useState(-1)

  const card = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const imagePicker = useRef<HTMLInputElement>(null)
  const filesRef = useRef(files)
  filesRef.current = files
  const selection = useRef<{ start: number; end: number } | undefined>(undefined)
  // The `/command` or `@agent` suggestions: where the caret is, which row is lit, and the text Esc closed them for.
  const [caret, setCaret] = useState(0)
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [dismissedFor, setDismissedFor] = useState<string | undefined>(undefined)
  const ask = drawerOpen && Boolean(drawer.step) && visible && !blocked && panel === null
  const trigger = target.id === "oracle" && !panel && !ask ? composerTrigger(text, caret) : undefined
  const menuItems = useMemo(() => (trigger ? composerItems(trigger, status.data?.commands) : []), [trigger?.kind, trigger?.query, status.data?.commands])
  const menuOpen = Boolean(trigger) && menuItems.length > 0 && dismissedFor !== text && visible && !blocked
  const lit = menuOpen ? (menuItems.find((item) => item.id === activeItem) ?? menuItems[0]!) : undefined
  const listId = "composer-suggestions"
  // The bubbles that wait above the composer while nothing else is open there.
  const bubbles = {
    answer: drawer.left > 0 && !drawerOpen,
    plan: tab === "plan" && Boolean(viewPlan),
    knowledge: tab === "knowledge" && !asking,
  }
  const bar = !menuOpen && panel === null && !ask && visible && !blocked && (bubbles.answer || bubbles.plan || bubbles.knowledge)
  const blur = menuOpen || ask || (panel !== null && visible && !blocked)
  const open = blur || bar
  const { shrunk, expand } = useShrinkOnScroll(card, visible && !blocked, route, open && !bar)

  // Folding to the pill and back eases slowly; the rest of the time the box follows its text quickly.
  const [morphing, setMorphing] = useState(false)
  const firstShrunk = useRef(shrunk)
  useEffect(() => {
    if (firstShrunk.current === shrunk) return
    firstShrunk.current = shrunk
    setMorphing(true)
    const timer = setTimeout(() => setMorphing(false), 420)
    return () => clearTimeout(timer)
  }, [shrunk])

  // A panel closes when the page changes under it or the composer goes away.
  useEffect(() => setPanel(null), [tab])
  useEffect(() => {
    if (!visible || blocked) setPanel(null)
  }, [visible, blocked])

  // A press outside the bubble closes its panel.
  useEffect(() => {
    if (!panel) return
    const away = (event: PointerEvent) => {
      if (!bubble.current?.contains(event.target as Node)) setPanel(null)
    }
    document.addEventListener("pointerdown", away, { capture: true })
    return () => document.removeEventListener("pointerdown", away, { capture: true })
  }, [panel])

  const togglePanel = useCallback((next: Panel) => {
    expand()
    setPanel((now) => (now === next || (next === "projects" && now === "browse") ? null : next))
  }, [expand])

  /** Closes the panel and gives focus back to the button that opened it. */
  const closePanel = useCallback(() => {
    setPanel((now) => {
      const opener = now === "attach" ? "[data-composer-attach]" : now ? '[role="combobox"][aria-label="Project"]' : undefined
      if (opener) requestAnimationFrame(() => bubble.current?.querySelector<HTMLElement>(opener)?.focus({ preventScroll: true }))
      return null
    })
  }, [])

  useHotkey("p", () => togglePanel("projects"), { enabled: visible && !blocked && panel === null })
  useEffect(() => {
    const show = () => {
      expand()
      setPanel("projects")
    }
    window.addEventListener(OPEN_PROJECTS, show)
    return () => window.removeEventListener(OPEN_PROJECTS, show)
  }, [expand])

  // The bubble that shows (or last showed, while it closes) and its size: closing keeps the last pane and width while the height falls.
  const shownPane = useRef<Pane>("suggest")
  const shownSize = useRef({ w: 320, h: 0 })
  const pane: Pane = panel ?? (ask ? "ask" : menuOpen ? "suggest" : bar ? "bar" : shownPane.current)
  const paneRef = useRef<HTMLDivElement>(null)
  // Mockups need room: the drawer then takes the composer's width (up to 960px), so each one reads as a page.
  const mockupAsk = pane === "ask" && Boolean(drawer.step?.options.some(hasMockup))
  const measured = useMeasured(pane, paneRef, mockupAsk ? Math.max(580, Math.min(960, (box.current?.clientWidth ?? 740) - 12)) : undefined)
  if (open) {
    shownPane.current = pane
    const family = field.current ? getComputedStyle(field.current).fontFamily : "system-ui, sans-serif"
    shownSize.current = pane === "suggest" ? { w: suggestionWidth(menuItems, family), h: suggestionHeight(menuItems.length) }
      : pane === "attach" ? ATTACH_SIZE
        : pane === "projects" ? projectsSize(projects)
          : pane === "bar" || pane === "ask" ? measured
            : FOLDER_SIZE
  }
  // The suggestions as they last showed, so the closing bubble keeps its rows.
  const lastMenu = useRef<{ items: ComposerCommandItem[]; kind: NonNullable<typeof trigger>["kind"]; lit?: string }>({ items: [], kind: "slash-command" })
  if (menuOpen && trigger && lit) lastMenu.current = { items: menuItems, kind: trigger.kind, lit: lit.id }

  const pick = useCallback((item: ComposerCommandItem) => {
    const rest = text.replace(/^\s*[/@][a-z0-9:_.-]*\s*/i, "")
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

  // The box's height follows its content (text, attachments, tools): measured here and handed to the bubble, so the
  // ghost shapes behind it and the box itself ease to it together. The pill's height comes from the stylesheet.
  useLayoutEffect(() => {
    const el = inner.current
    const host = bubble.current
    if (!el || !host) return
    const set = () => {
      if (host.hasAttribute("data-shrunk")) return
      host.style.setProperty("--ch-open", `${Math.ceil(el.getBoundingClientRect().height)}px`)
    }
    set()
    const observer = new ResizeObserver(set)
    observer.observe(el)
    return () => observer.disconnect()
  }, [shrunk])

  // A long line widens the box before it wraps: the longest line's width goes to the bubble, which grows from the
  // chat column's width to its ceiling (in the stylesheet) in 48px steps. Folded, or with short lines, it stays put.
  useLayoutEffect(() => {
    const el = field.current
    const host = bubble.current
    if (!el || !host) return
    if (shrunk || !text) return void host.style.removeProperty("--cg")
    const style = getComputedStyle(el)
    measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const longest = Math.max(...text.split("\n").map((line) => measure.measureText(line).width))
    host.style.setProperty("--cg", `${Math.ceil((longest + 44) / 48) * 48}px`)
  }, [text, shrunk])

  // The styled layer behind the text keeps to the box's scroll.
  useLayoutEffect(() => {
    if (mirror.current && field.current) mirror.current.scrollTop = field.current.scrollTop
  })

  // The toasts sit just above the composer box and centred on it, wherever its height and the sidebar have put it.
  useEffect(() => {
    const el = box.current
    const dock = card.current
    if (!el || !dock) return
    const root = document.documentElement
    const set = () => {
      const rect = el.getBoundingClientRect()
      const bottom = dock.getBoundingClientRect().bottom
      root.style.setProperty("--composer-h", blocked || !visible ? "0px" : `${Math.ceil(bottom - rect.top)}px`)
      // A hidden composer measures 0 wide: the toasts then centre on the window instead of shrinking to nothing.
      if (!visible || rect.width === 0) {
        root.style.removeProperty("--composer-x")
        root.style.removeProperty("--composer-w")
        return
      }
      root.style.setProperty("--composer-x", `${Math.round(rect.left)}px`)
      root.style.setProperty("--composer-w", `${Math.round(rect.width)}px`)
    }
    set()
    const observer = new ResizeObserver(set)
    observer.observe(el)
    // The box eases to new sizes; measure again once it settles.
    el.addEventListener("transitionend", set)
    window.addEventListener("resize", set)
    return () => {
      observer.disconnect()
      el.removeEventListener("transitionend", set)
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
        // From Knowledge a message goes to the team, so the page goes where they answer.
        else if (tab === "knowledge") go(tabHash("lobby"))
      } else if (target.id === "knowledge") {
        done = (await act("knowledge.ask", body)) !== undefined
        if (done) {
          window.dispatchEvent(new CustomEvent(KNOWLEDGE_ASKED, { detail: text.trim() }))
          setAsking(false)
        }
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
  }, [canSend, ready, target, text, route, tab])

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
        // Esc closes the suggestions first; the next one leaves the box.
        event.preventDefault()
        setDismissedFor(text)
        return
      }
    }
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault()
      // Esc closes an open panel, the question drawer (the questions wait in their bubble) or asking first;
      // then it leaves the box (what you typed stays) for the tab bar.
      if (panel) setPanel(null)
      else if (ask) setPutAway(true)
      else if (asking) setAsking(false)
      else focusTab()
      return
    }
    if (ask && isSend(event)) {
      // In the drawer, Enter answers the question in view with what you typed.
      event.preventDefault()
      if (drawer.reply(text)) setText("")
      else if (!text.trim() && drawer.step?.multi) drawer.submitPicks()
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

  const project = status.data?.workspace.name ?? "bot-lobby"
  const branch = status.data?.branch ?? status.data?.workspace.branch
  const steering = busy && target.id === "oracle"
  const placeholder = shrunk ? "Write a message…"
    : ask ? (drawer.step?.typed ? drawer.step.placeholder : "Pick an answer above")
      : steering ? "The oracle is working. Enter steers it…" : target.placeholder
  const pickFiles = (input: RefObject<HTMLInputElement | null>) => {
    setPanel(null)
    input.current?.click()
  }

  const answerQuestions = () => {
    setPutAway(false)
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }))
  }
  const askKnowledge = () => {
    setAsking(true)
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }))
  }
  const menu = pane === "ask" ? (
    <div key="ask" ref={paneRef}><DrawerPane drawer={drawer} onExpand={setMockup} /></div>
  ) : pane === "bar" ? (
    <div key="bar" ref={paneRef} className="bubble-pane p-1.5" style={{ width: "max-content" }}>
      <div className="cs-pbar">
        {bubbles.answer ? (
          <button type="button" className="bubble-row cs-pbq cs-acc" onMouseDown={(event) => event.preventDefault()} onClick={answerQuestions}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /><path d="M9.6 9.5a2.5 2.5 0 014.8.9c0 1.6-2.4 2-2.4 3.4M12 16.5h.01" /></svg>
            <span className="text-sm font-medium text-(--bubble-accent)">Answer questions</span>
            <span className="cs-ktag" style={{ "--k": "var(--primary)" } as CSSProperties}>{drawer.left} left</span>
          </button>
        ) : null}
        {bubbles.plan ? (
          <button type="button" className="bubble-row cs-pbq" aria-keyshortcuts="V" onMouseDown={(event) => event.preventDefault()} onClick={() => viewPlan?.()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
            <span className="text-sm font-medium text-(--bubble-ink)">View plan</span>
            <span className="cs-kb">V</span>
          </button>
        ) : null}
        {bubbles.knowledge ? (
          <button type="button" className="bubble-row cs-pbq" onMouseDown={(event) => event.preventDefault()} onClick={askKnowledge}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
            <span className="text-sm font-medium text-(--bubble-ink)">Ask the knowledge</span>
          </button>
        ) : null}
      </div>
    </div>
  ) : pane === "suggest" ? (
    <ComposerCommandMenu
      key="suggest"
      listId={listId}
      items={menuOpen ? menuItems : lastMenu.current.items}
      triggerKind={menuOpen && trigger ? trigger.kind : lastMenu.current.kind}
      activeItemId={lit?.id ?? null}
      onHighlightedItemChange={setActiveItem}
      onSelect={pick}
    />
  ) : pane === "attach" ? (
    <div key="attach" role="menu" aria-label="Attach" className="bubble-pane flex flex-col p-1.5"
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        event.preventDefault()
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']")]
        const at = items.indexOf(document.activeElement as HTMLElement)
        items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus()
      }}>
      <button type="button" role="menuitem" className="bubble-row h-10" style={{ "--delay": "24ms" } as CSSProperties} onClick={() => pickFiles(picker)}>
        <FileText aria-hidden="true" className="size-4 shrink-0 text-(--bubble-muted)" strokeWidth={1.7} />
        <span className="text-sm font-medium text-(--bubble-ink)">Upload a file…</span>
      </button>
      <button type="button" role="menuitem" className="bubble-row h-10" style={{ "--delay": "12ms" } as CSSProperties} onClick={() => pickFiles(imagePicker)}>
        <Image aria-hidden="true" className="size-4 shrink-0 text-(--bubble-muted)" strokeWidth={1.7} />
        <span className="text-sm font-medium text-(--bubble-ink)">Upload an image…</span>
      </button>
      <div className="h-px" />
      <div className="flex h-8 items-center px-2.5 text-xs text-(--bubble-muted)">Or drop files on the composer</div>
    </div>
  ) : pane === "projects" ? (
    <ProjectsPane key="projects" projects={projects} tab={tab} onBrowse={() => setPanel("browse")} onClose={() => setPanel(null)} />
  ) : (
    <FolderPane key="browse" tab={tab} onClose={closePanel} />
  )

  return (
    <>
    <div className="cs-scrim" data-open={blur || undefined} aria-hidden="true" />
    <div
      id="app-dock"
      ref={card}
      data-shrunk={shrunk || undefined}
      onFocus={expand}
      className={cn(
        "dock pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-[max(24px,env(safe-area-inset-bottom))] transition-opacity duration-200 ease-snap",
        blocked && "opacity-0"
      )}
      hidden={!visible}
      aria-hidden={visible ? undefined : true}
      inert={blocked || !visible}
    >
      <ComposerBubble
        ref={bubble}
        open={open}
        size={shownSize.current}
        shrunk={shrunk}
        morphing={morphing}
        menu={menu}
        className="composer-shell pointer-events-auto"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return
          if (panel) {
            event.preventDefault()
            closePanel()
          } else if (ask) {
            event.preventDefault()
            setPutAway(true)
          }
        }}
      >
        <div
          ref={box}
          className="bubble-composer group/composer composer-box"
          data-dragging={dragging || undefined}
          data-chat-composer-main-surface="true"
          onPointerDown={expand}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div ref={inner} data-chat-composer-surface="true">
            <AnimatePresence initial={false}>
              {files.length > 0 ? (
                <motion.ul
                  key="files"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  aria-label="Attachments"
                  className="composer-files flex max-w-full flex-wrap gap-2 overflow-hidden px-3.5 pt-3"
                >
                  {files.map((file) => (
                    <Chip key={file.key} file={file} onRemove={() => forget(file.key)} />
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>

            <div className="bubble-field">
              <MarkdownMirror ref={mirror} text={text} />
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
                  setPanel(null)
                }}
                onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onScroll={(event) => {
                  if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop
                }}
                placeholder={placeholder}
                rows={1}
                className="bubble-text bubble-input"
              />
            </div>

            <div data-chat-composer-footer="true" className="bubble-tools composer-tools">
              <button
                type="button"
                data-composer-attach
                aria-label="Attach images, PDFs or files"
                aria-haspopup="menu"
                aria-expanded={panel === "attach"}
                data-on={panel === "attach" || undefined}
                data-tip="Attach a file"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => togglePanel("attach")}
                className="bubble-iconbtn bubble-tip bubble-tool size-8 rounded-full"
                style={{ "--i": 0 } as CSSProperties}
              >
                <Paperclip aria-hidden="true" className="size-4" strokeWidth={1.7} />
              </button>
              <span className="bubble-tool flex min-w-0" style={{ "--i": 1 } as CSSProperties}>
                <ProjectChip projects={projects} name={project} branch={branch} open={panel === "projects" || panel === "browse"} onToggle={() => togglePanel("projects")} />
              </span>
              <span className="flex-1" />
              <span className="bubble-hints bubble-tool" style={{ "--i": 2 } as CSSProperties} aria-hidden="true">
                {menuOpen ? <><Kbd>↑</Kbd><Kbd>↓</Kbd>choose<Kbd>↵</Kbd>insert</>
                  : panel ? <><Kbd>Esc</Kbd>close</>
                    : <><Kbd>Shift</Kbd><Kbd>↵</Kbd>new line</>}
              </span>
              <span data-chat-composer-actions="right" className="bubble-tool flex shrink-0 items-center gap-2" style={{ "--i": 3 } as CSSProperties}>
                {steering ? <ComposerStopButton onStop={() => void stop()} /> : null}
                <ComposerSendButton sending={sending} disabled={!canSend} steering={steering} onSend={() => void send()} />
              </span>
            </div>
          </div>

          <input ref={picker} type="file" multiple hidden tabIndex={-1} aria-label="Attach files"
            onChange={(event) => {
              attach(event.target.files ?? [])
              event.target.value = ""
            }} />
          <input ref={imagePicker} type="file" accept="image/*" multiple hidden tabIndex={-1} aria-label="Attach images"
            onChange={(event) => {
              attach(event.target.files ?? [])
              event.target.value = ""
            }} />

          {dragging ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] text-sm font-medium text-(--bubble-accent)">
              Drop to attach
            </div>
          ) : null}
        </div>
      </ComposerBubble>
    </div>
    <MockupLightbox drawer={drawer} at={ask ? mockup : -1} onAt={setMockup} />
    </>
  )
}
