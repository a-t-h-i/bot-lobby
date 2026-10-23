/**
 * Whether the code viewer is open and which file it shows. A file name in the
 * Lobby chat or the activity log opens it at that file; the bar's Code button
 * and the code key (Alt+E unless rebound) open it on the changed files. Each
 * open carries a fresh `request`, so asking for the file already shown again
 * still brings it to the front. Wrap and the diff layout are remembered in
 * this browser; every store access is guarded.
 */
import { useSyncExternalStore } from "react"

export type CodeMode = "code" | "diff"
export type DiffLayout = "unified" | "split"

interface CodeState {
  open: boolean
  path?: string
  mode?: CodeMode
  request: number
}

const WRAP_KEY = "bot-lobby.code.wrap"
const LAYOUT_KEY = "bot-lobby.code.layout"

const listeners = new Set<() => void>()
let state: CodeState = { open: false, request: 0 }

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Open the viewer, at `path` when given (a project path or a bare file name), in `mode` when given. */
export function openCode(path?: string, mode?: CodeMode): void {
  state = { open: true, ...(path ? { path } : state.path ? { path: state.path } : {}), ...(mode ? { mode } : {}), request: state.request + 1 }
  emit()
}

export function closeCode(): void {
  if (!state.open) return
  state = { ...state, open: false }
  emit()
}

export function toggleCode(): void {
  if (state.open) closeCode()
  else openCode()
}

export function useCodeViewer(): CodeState {
  return useSyncExternalStore(subscribe, () => state)
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice then lasts until the page reloads.
  }
}

let wrap = read(WRAP_KEY) === "1"
let layout: DiffLayout = read(LAYOUT_KEY) === "split" ? "split" : "unified"

export function setCodeWrap(next: boolean): void {
  wrap = next
  write(WRAP_KEY, next ? "1" : "0")
  emit()
}

export function setDiffLayout(next: DiffLayout): void {
  layout = next
  write(LAYOUT_KEY, next)
  emit()
}

export function useCodeWrap(): boolean {
  return useSyncExternalStore(subscribe, () => wrap)
}

export function useDiffLayout(): DiffLayout {
  return useSyncExternalStore(subscribe, () => layout)
}

const BARE_EXTENSIONS = new Set(
  "ts tsx mts cts js jsx mjs cjs json jsonc json5 jsonl md mdx css scss sass less html htm vue svelte astro py rb go rs java kt kts swift c h cc cpp hpp cs php lua sh bash zsh fish ps1 sql graphql gql yml yaml toml ini cfg conf env xml svg txt lock prisma proto dockerfile mk gradle".split(" ")
)

/**
 * Whether `text` reads as a file path an agent named: `src/pi/zen.ts`,
 * `./README.md`, `zen.ts`, optionally with `:12` after it. Plain words, URLs,
 * commands with spaces and version numbers are not.
 */
export function filePathOf(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 300 || /\s/.test(trimmed) || /^[a-z][\w+.-]*:\/\//i.test(trimmed)) return undefined
  const path = trimmed.replace(/:\d+(?::\d+)?$/, "").replace(/^\.\//, "")
  if (!/^[\w@~./-]+$/.test(path) || path.endsWith("/") || path.includes("..")) return undefined
  const name = path.split("/").at(-1) ?? ""
  // A dotted name with a short letter extension (`zen.ts`, `.env.local`, `Dockerfile` with a folder); never `1.2.3`.
  const dotted = /^[\w@.-]*[A-Za-z_][\w@-]*\.[A-Za-z][\w]{0,9}$/.test(name) || /^\.[A-Za-z][\w.-]*$/.test(name)
  const known = /^(Dockerfile|Makefile|LICENSE|Procfile|Gemfile|Rakefile)$/.test(name) && path.includes("/")
  if (!dotted && !known) return undefined
  if (/^v?\d+(\.\d+)+$/.test(name)) return undefined
  // A bare name needs an extension files carry, so `feed.replyDelta` or `Node.js` in prose is not taken for one.
  if (!path.includes("/") && !name.startsWith(".") && !BARE_EXTENSIONS.has(name.slice(name.lastIndexOf(".") + 1).toLowerCase())) return undefined
  return path
}
