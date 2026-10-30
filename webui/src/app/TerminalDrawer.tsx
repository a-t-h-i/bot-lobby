// Adapted from T3 Code (MIT), apps/web/src/components/ThreadTerminalDrawer.tsx
/**
 * The terminal drawer under the composer, as in the coding harness it takes
 * after: a shell in the project's folder, more than one if you like. A small
 * toolbar floats at its top right (a new terminal, end this one, hide the
 * drawer), and with two or more a list down its right side switches between
 * them. Its top edge drags to make it taller, and both its height and whether
 * it is open are remembered. The terminal key (Ctrl+` unless rebound) or the
 * bar's Terminal button opens and hides it; the shells keep running while it
 * is hidden. The pop-out toggle beside New and End moves the terminals into a
 * pop-up over the page, as the Thinking orb opens its pane, and back; that
 * choice is remembered too. In the pop-up Esc stays the shell's while the
 * terminal has focus.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, PictureInPicture2, Plus, SquareTerminal, Trash2, X } from "lucide-react"
import type { TerminalInfo } from "@protocol"
import { Keys } from "@/components/ui/kbd"
import { Popup } from "@/components/ui/popup"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { call } from "@/lib/api"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { setTerminalHeight, setTerminalOpen, setTerminalPopup, TERMINAL_HEIGHT, toggleTerminal, useTerminalHeight, useTerminalOpen, useTerminalPopup } from "./terminalStore"

const TerminalView = lazy(() => import("./TerminalView"))

const TOOL =
  "inline-flex size-6 items-center justify-center text-foreground/80 outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-foreground"

function Tip({ label, hint, children }: { label: string; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">
        {label} {hint ? <Keys chord={hint} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** The bar's button that opens and hides the drawer. */
export function TerminalToggle({ hint, className }: { hint?: string | undefined; className: string }) {
  const open = useTerminalOpen()
  return (
    <Tip label={open ? "Hide terminal" : "Terminal"} hint={hint}>
      <button type="button" aria-label="Terminal" aria-pressed={open} aria-controls={open ? "terminal-drawer" : undefined} aria-keyshortcuts={hint} onClick={toggleTerminal} className={className}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 17l6-6-6-6M12 19h8" /></svg>
      </button>
    </Tip>
  )
}

/** The terminals the server runs, read when the drawer opens and after each change. */
function useTerminals(open: boolean) {
  const [list, setList] = useState<{ available: boolean; reason?: string; terminals: TerminalInfo[] }>()
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    try {
      setList(await call("terminal.list", {}))
      setError("")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The terminals could not be read.")
    }
  }, [])
  useEffect(() => {
    if (open) void reload()
  }, [open, reload])
  return { list, error, reload }
}

/** Drag the drawer's top edge: up makes it taller. Double-click puts the height back. */
function TopEdge({ height, max }: { height: number; max: number }) {
  const start = useRef<{ y: number; height: number } | null>(null)
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize terminal"
      aria-orientation="horizontal"
      aria-valuenow={height}
      aria-valuemin={TERMINAL_HEIGHT.min}
      aria-valuemax={max}
      className="terminal-edge"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        start.current = { y: event.clientY, height }
        document.documentElement.dataset.resizing = "row"
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        setTerminalHeight(Math.min(max, start.current.height + start.current.y - event.clientY))
      }}
      onPointerUp={() => {
        start.current = null
        delete document.documentElement.dataset.resizing
      }}
      onPointerCancel={() => {
        start.current = null
        delete document.documentElement.dataset.resizing
      }}
      onDoubleClick={() => setTerminalHeight(TERMINAL_HEIGHT.start)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        event.preventDefault()
        setTerminalHeight(Math.min(max, height + (event.key === "ArrowUp" ? 24 : -24)))
      }}
    />
  )
}

export function TerminalDrawer({ toggleKey }: { toggleKey: string }) {
  const open = useTerminalOpen()
  const popup = useTerminalPopup()
  const height = useTerminalHeight()
  // In the pop-up the terminal holds the page's one overlay slot, so a question or a confirmation takes its turn first.
  const popupShown = useOverlaySlot(open && popup, PRIORITY.sheet)
  const { list, error, reload } = useTerminals(open)
  const [active, setActive] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [max, setMax] = useState(() => Math.round(window.innerHeight * 0.7))
  const terminals = list?.terminals ?? []
  const shown = terminals.find((terminal) => terminal.id === active) ?? terminals.at(-1)

  useEffect(() => {
    const onResize = () => setMax(Math.round(window.innerHeight * 0.7))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const start = useCallback(async () => {
    setBusy(true)
    try {
      const info = await call("terminal.open", { cols: 100, rows: 24 })
      setActive(info.id)
      await reload()
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "The terminal did not start.")
    } finally {
      setBusy(false)
    }
  }, [reload])

  const end = useCallback(async (id: string) => {
    try {
      await call("terminal.close", { id })
    } catch {
      // Already gone: the list read says so.
    }
    await reload()
  }, [reload])

  // Ctrl+PageDown and Ctrl+PageUp step through the terminals, from anywhere while the drawer is open.
  useEffect(() => {
    if (!open || terminals.length < 2) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || (event.key !== "PageDown" && event.key !== "PageUp")) return
      event.preventDefault()
      const at = Math.max(0, terminals.findIndex((terminal) => terminal.id === shown?.id))
      const next = terminals[(at + (event.key === "PageDown" ? 1 : -1) + terminals.length) % terminals.length]!
      setActive(next.id)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, terminals, shown?.id])

  // Opened with no terminal yet, it starts one: opening the drawer is asking for a shell.
  const started = useRef(false)
  useEffect(() => {
    if (!open) {
      started.current = false
      return
    }
    if (!list || !list.available || list.terminals.length > 0 || started.current || busy) return
    started.current = true
    void start()
  }, [open, list, busy, start])

  // The orb and the toasts sit above the composer; with the drawer open, above it too.
  const drawerHeight = open && !popup ? Math.min(height, max) : 0
  useEffect(() => {
    const root = document.documentElement
    if (drawerHeight) root.style.setProperty("--terminal-h", `${drawerHeight}px`)
    else root.style.removeProperty("--terminal-h")
    return () => {
      root.style.removeProperty("--terminal-h")
    }
  }, [drawerHeight])

  if (!open) return null
  const panes = (
    <TerminalPanes
      list={list}
      error={error}
      terminals={terminals}
      shown={shown}
      busy={busy}
      popup={popup}
      toggleKey={toggleKey}
      onPick={setActive}
      onStart={() => void start()}
      onEnd={(id) => void end(id)}
      onReload={() => void reload()}
    />
  )
  if (popup)
    return (
      <Popup
        open={popupShown}
        onOpenChange={(next) => { if (!next) setTerminalOpen(false) }}
        label="Terminal"
        className="terminal-pop h-[min(72svh,40rem)] max-h-none max-w-5xl"
        onEscapeKeyDown={(event) => {
          // Esc inside the terminal is the shell's (vim, less, a prompt); from the toolbar it closes the pop-up.
          if ((event.target as Element | null)?.closest?.(".xterm")) event.preventDefault()
        }}
      >
        <div id="terminal-drawer" className="flex min-h-0 flex-1">{panes}</div>
      </Popup>
    )
  return (
    <section
      id="terminal-drawer"
      aria-label="Terminal"
      className="terminal-drawer relative flex shrink-0 border-t border-border"
      style={{ height: Math.min(height, max) }}
    >
      <TopEdge height={Math.min(height, max)} max={max} />
      {panes}
    </section>
  )
}

/** The terminals themselves, their toolbar and, with two or more, the list to switch between them: the same in the drawer and the pop-up. */
function TerminalPanes({
  list,
  error,
  terminals,
  shown,
  busy,
  popup,
  toggleKey,
  onPick,
  onStart,
  onEnd,
  onReload,
}: {
  list: { available: boolean; reason?: string; terminals: TerminalInfo[] } | undefined
  error: string
  terminals: TerminalInfo[]
  shown: TerminalInfo | undefined
  busy: boolean
  popup: boolean
  toggleKey: string
  onPick: (id: string) => void
  onStart: () => void
  onEnd: (id: string) => void
  onReload: () => void
}) {
  const tools = (
    <div className="terminal-tools pointer-events-auto inline-flex items-center overflow-hidden rounded-md border border-border/80 bg-background shadow-xs">
      <Tip label="New terminal">
        <button type="button" aria-label="New terminal" disabled={busy || list?.available === false} onClick={onStart} className={TOOL}>
          <Plus aria-hidden="true" className="size-3.5" />
        </button>
      </Tip>
      <span aria-hidden="true" className="h-4 w-px bg-border/80" />
      <Tip label="End this terminal">
        <button type="button" aria-label="End this terminal" disabled={!shown} onClick={() => shown && onEnd(shown.id)} className={TOOL}>
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      </Tip>
      <span aria-hidden="true" className="h-4 w-px bg-border/80" />
      <Tip label={popup ? "Back to the drawer" : "Open in a pop-up"}>
        <button type="button" aria-label="Pop out terminal" aria-pressed={popup} onClick={() => setTerminalPopup(!popup)} className={TOOL}>
          <PictureInPicture2 aria-hidden="true" className="size-3.5" />
        </button>
      </Tip>
      <span aria-hidden="true" className="h-4 w-px bg-border/80" />
      <Tip label="Hide terminal" hint={toggleKey}>
        <button type="button" aria-label="Hide terminal" onClick={() => setTerminalOpen(false)} className={TOOL}>
          {popup ? <X aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
        </button>
      </Tip>
    </div>
  )
  const screens = (
    <>
      {list && !list.available ? (
        <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{list.reason}</p>
      ) : error ? (
        <p role="alert" className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">{error}</p>
      ) : (
        <Suspense fallback={<p className="p-3 text-xs text-muted-foreground">Loading the terminal…</p>}>
          {list && terminals.length === 0 && !busy ? <p className="p-3 text-xs text-muted-foreground">No terminal is running. Start one with New terminal.</p> : null}
          {terminals.map((terminal) => (
            <TerminalView key={terminal.id} id={terminal.id} active={terminal.id === shown?.id} toggleKey={toggleKey} onExit={onReload} />
          ))}
        </Suspense>
      )}
    </>
  )
  const switcher = terminals.length > 1 ? (
    <nav aria-label="Terminals" className={cn("flex w-36 shrink-0 flex-col gap-0.5 overflow-y-auto border-l border-border px-1 pb-1", popup ? "pt-2" : "pt-10")}>
      {terminals.map((terminal) => (
        <button
          key={terminal.id}
          type="button"
          aria-current={terminal.id === shown?.id ? "true" : undefined}
          onClick={() => onPick(terminal.id)}
          className={cn(
            "flex h-6 min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-xs text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-accent aria-[current=true]:text-foreground",
            !terminal.alive && "opacity-60",
          )}
        >
          <SquareTerminal aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{terminal.title}</span>
          {terminal.alive ? null : <span className="sr-only">, ended</span>}
        </button>
      ))}
    </nav>
    ) : null
  if (popup)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 pr-2 pl-4">
          <SquareTerminal aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">Terminal</span>
          {tools}
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 py-2 pl-2">
            <div className="relative h-full">{screens}</div>
          </div>
          {switcher}
        </div>
      </div>
    )
  return (
    <>
      <div className="relative min-w-0 flex-1">
        {screens}
        <div className="pointer-events-none absolute top-2 right-2 z-20">{tools}</div>
      </div>
      {switcher}
    </>
  )
}
