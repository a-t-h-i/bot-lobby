/**
 * One terminal on the page: xterm.js drawing what the server's shell prints
 * (`GET /api/terminal.stream`) and sending what you type (`terminal.input`,
 * in order, one request at a time). It fits its box and tells the shell its
 * size, follows light and dark, and leaves the page's own shortcuts to the
 * shell except the terminal key. Loaded only when the drawer first opens.
 */
import { useEffect, useRef } from "react"
import { Terminal, type ITheme } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import type { TerminalStreamEvent } from "@protocol"
import { call } from "@/lib/api"
import { projectUrl } from "@/lib/project"
import { matchKey } from "./useLobbyKeys"

const LIGHT: ITheme = {
  black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00", blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
  brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
}
const DARK: ITheme = {
  black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922", blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
  brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#ffffff",
}

/** The page's colours as xterm wants them: the drawer's background, the text, the caret in the accent. */
function theme(host: HTMLElement): ITheme {
  const style = getComputedStyle(host)
  const dark = document.documentElement.classList.contains("dark")
  const css = (name: string) => style.getPropertyValue(name).trim()
  const background = css("--terminal-background") || css("--background")
  return {
    ...(dark ? DARK : LIGHT),
    background,
    foreground: css("--foreground"),
    cursor: css("--foreground"),
    cursorAccent: background,
    selectionBackground: dark ? "rgba(88, 166, 255, 0.3)" : "rgba(9, 105, 218, 0.2)",
  }
}

/** Typed keys go out in order: what piles up while one request is out goes in the next. */
function inputQueue(id: string): (data: string) => void {
  let pending = ""
  let sending = false
  const flush = async () => {
    if (sending || !pending) return
    sending = true
    const data = pending.slice(0, 60_000)
    pending = pending.slice(data.length)
    try {
      await call("terminal.input", { id, data })
    } catch {
      // The terminal ended or the server went away: the stream says which.
    } finally {
      sending = false
      void flush()
    }
  }
  return (data) => {
    pending += data
    void flush()
  }
}

export default function TerminalView({ id, active, toggleKey, onExit }: { id: string; active: boolean; toggleKey: string; onExit: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const exit = useRef(onExit)
  exit.current = onExit

  useEffect(() => {
    const host = box.current!
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      fontFamily: getComputedStyle(host).getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5_000,
      theme: theme(host),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    term.current = terminal
    // The terminal key toggles the drawer; every other key, the page's shortcuts too, belongs to the shell.
    // The terminal key and the terminal switch keys (Ctrl+PageUp/PageDown) belong to the page, not the shell.
    terminal.attachCustomKeyEventHandler((event) => !matchKey(event, toggleKey) && !(event.ctrlKey && (event.key === "PageUp" || event.key === "PageDown")))
    const send = inputQueue(id)
    const typed = terminal.onData(send)
    const binary = terminal.onBinary(send)

    let size = { cols: 0, rows: 0 }
    let timer: ReturnType<typeof setTimeout> | undefined
    const refit = () => {
      if (!host.offsetWidth || !host.offsetHeight) return
      try {
        fit.fit()
      } catch {
        return
      }
      if (terminal.cols === size.cols && terminal.rows === size.rows) return
      size = { cols: terminal.cols, rows: terminal.rows }
      clearTimeout(timer)
      timer = setTimeout(() => void call("terminal.resize", { id, ...size }).catch(() => {}), 80)
    }
    const observer = new ResizeObserver(refit)
    observer.observe(host)
    refit()

    const source = new EventSource(projectUrl(`/api/terminal.stream?id=${encodeURIComponent(id)}`))
    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as TerminalStreamEvent
      if (event.type === "reset") {
        terminal.reset()
        terminal.write(event.data)
        if (!event.alive) {
          source.close()
          terminal.write(ended(event.code))
        }
      } else if (event.type === "data") terminal.write(event.data)
      else {
        source.close()
        terminal.write(ended(event.code))
        exit.current()
      }
    }

    const themes = new MutationObserver(() => {
      terminal.options.theme = theme(host)
    })
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] })

    return () => {
      clearTimeout(timer)
      themes.disconnect()
      observer.disconnect()
      source.close()
      typed.dispose()
      binary.dispose()
      terminal.dispose()
      term.current = null
    }
  }, [id, toggleKey])

  useEffect(() => {
    if (active) term.current?.focus()
  }, [active])

  return <div ref={box} data-terminal={id} className="terminal-view absolute inset-0 py-1 pl-2" hidden={!active} />
}

function ended(code: number | undefined): string {
  return `\r\n\x1b[2m[process exited${code === undefined ? "" : ` with code ${code}`}]\x1b[0m\r\n`
}
