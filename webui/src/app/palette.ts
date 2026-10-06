/**
 * The colour theme, painted as one `<style>` in the head. The saved themes and
 * the chosen one live with pi, in the user-global config folder
 * (`themes.json`), so every pi session and every project's page shows the
 * same list whatever port it runs on. This browser keeps a copy only to paint
 * the last theme before the first render (so the page never flashes the
 * default colours); what pi says wins once it answers.
 *
 * A theme imported before themes were kept with pi (one, in this browser) is
 * handed to pi the first time the page talks to it.
 */
import { useCallback, useSyncExternalStore } from "react"
import type { ThemeStoreInfo } from "@protocol"
import { DEFAULT_ID, PRESETS, cleanVars, paletteCss, type Palette, type Parsed } from "@palette"
import { call } from "@/lib/api"

const KEY = "bot-lobby.palette"
const STYLE_ID = "bot-lobby-palette"
/** The single imported theme of the old browser-only store. */
const LEGACY_ID = "custom"

interface Stored {
  id: string
  saved: Palette[]
  /** A browser-only theme not yet handed to pi. */
  legacy?: Palette
}

const listeners = new Set<() => void>()
let state: Stored = load()

function cleanPalette(value: unknown): Palette | undefined {
  const entry = value as Partial<Palette> | undefined
  if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string") return undefined
  const light = cleanVars(entry.light)
  const dark = cleanVars(entry.dark)
  if (!light && !dark) return undefined
  return { id: entry.id, name: entry.name.slice(0, 40), ...(light ? { light } : {}), ...(dark ? { dark } : {}) }
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { id: DEFAULT_ID, saved: [] }
    const parsed = JSON.parse(raw) as { id?: string; saved?: unknown[]; custom?: unknown; legacy?: unknown }
    const saved = (parsed.saved ?? []).map(cleanPalette).filter((entry): entry is Palette => Boolean(entry))
    const legacy = cleanPalette(parsed.legacy ?? (parsed.custom ? { ...(parsed.custom as object), id: LEGACY_ID } : undefined))
    const ids = new Set([...PRESETS.map((preset) => preset.id), ...saved.map((entry) => entry.id), ...(legacy ? [LEGACY_ID] : [])])
    return { id: parsed.id && ids.has(parsed.id) ? parsed.id : DEFAULT_ID, saved, ...(legacy ? { legacy } : {}) }
  } catch {
    return { id: DEFAULT_ID, saved: [] }
  }
}

function every(current: Stored): Palette[] {
  return [...PRESETS, ...current.saved, ...(current.legacy ? [current.legacy] : [])]
}

function activeOf(current: Stored): Palette {
  return every(current).find((entry) => entry.id === current.id) ?? PRESETS[0]!
}

function paint(): void {
  if (typeof document === "undefined") return
  const css = paletteCss(activeOf(state))
  let style = document.getElementById(STYLE_ID)
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement("style")
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css
}

function commit(next: Stored): void {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // The copy only saves a flash of the default colours on the next load.
  }
  paint()
  for (const listener of [...listeners]) listener()
}

/** Take what pi keeps: its list, and its choice when it has one. */
function adoptStore(store: ThemeStoreInfo): void {
  const saved = store.themes.map((theme) => cleanPalette(theme)).filter((entry): entry is Palette => Boolean(entry))
  const { legacy } = state
  commit({ id: store.active ?? (state.id === LEGACY_ID && legacy ? LEGACY_ID : DEFAULT_ID), saved, ...(legacy ? { legacy } : {}) })
}

let synced: Promise<void> | undefined

/**
 * Read the themes pi keeps (once per page, and again on demand), handing it a
 * theme this browser imported before themes lived with pi.
 */
export function syncThemes(force = false): Promise<void> {
  if (synced && !force) return synced
  synced = (async () => {
    let store = await call("themes.get", {})
    const legacy = state.legacy
    if (legacy) {
      // Saving chooses it; when another theme was chosen, that choice stands.
      const chosen = store.active ?? (state.id !== LEGACY_ID ? state.id : undefined)
      store = await call("themes.save", { name: legacy.name, ...(legacy.light ? { light: legacy.light } : {}), ...(legacy.dark ? { dark: legacy.dark } : {}) })
      if (chosen) store = await call("themes.choose", { id: chosen })
      const { legacy: _gone, ...rest } = state
      state = rest
    }
    adoptStore(store)
  })().catch(() => {
    synced = undefined
  })
  return synced
}

if (typeof window !== "undefined") {
  paint()
  // Another tab of this page changed the theme.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return
    state = load()
    paint()
    for (const listener of [...listeners]) listener()
  })
  // Another pi session may have changed the themes while this page was in the background.
  window.addEventListener("focus", () => void syncThemes(true))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface PaletteState {
  active: Palette
  /** The themes the user saved, oldest first. */
  saved: Palette[]
  /** The themes to pick from: the page's own, then the saved ones. */
  all: Palette[]
  /** Whether a theme is one the user saved (and so can be renamed or removed). */
  isSaved: (id: string) => boolean
  choose: (id: string) => void
  /** Save a parsed theme under a name with pi and switch to it. */
  adopt: (parsed: Parsed, name: string) => Promise<Palette>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function usePalette(): PaletteState {
  const current = useSyncExternalStore(subscribe, () => state, () => state)
  const choose = useCallback((id: string) => {
    commit({ ...state, id })
    if (id !== LEGACY_ID) void call("themes.choose", { id }).then(adoptStore, () => {})
  }, [])
  const adopt = useCallback(async (parsed: Parsed, name: string): Promise<Palette> => {
    const store = await call("themes.save", { name, ...(parsed.light ? { light: parsed.light } : {}), ...(parsed.dark ? { dark: parsed.dark } : {}) })
    adoptStore(store)
    return activeOf(state)
  }, [])
  const rename = useCallback(async (id: string, name: string) => adoptStore(await call("themes.rename", { id, name })), [])
  const remove = useCallback(async (id: string) => adoptStore(await call("themes.remove", { id })), [])
  const saved = current.legacy ? [...current.saved, current.legacy] : current.saved
  return {
    active: activeOf(current),
    saved,
    all: every(current),
    isSaved: (id) => saved.some((entry) => entry.id === id),
    choose,
    adopt,
    rename,
    remove,
  }
}
