/**
 * The chosen colour theme, kept in this browser only (`localStorage`, never
 * sent to the server) and painted as one `<style>` in the head. Importing this
 * module applies the saved theme before the first render, so the page never
 * flashes the default colours. A blocked store only means the choice lasts
 * until the page reloads.
 */
import { useCallback, useSyncExternalStore } from "react"
import { DEFAULT_ID, PRESETS, cleanVars, paletteCss, type Palette, type Parsed } from "./palette-core"

const KEY = "bot-lobby.palette"
const STYLE_ID = "bot-lobby-palette"
export const CUSTOM_ID = "custom"

interface Stored {
  id: string
  custom?: Palette
}

const listeners = new Set<() => void>()
let state: Stored = load()

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { id: DEFAULT_ID }
    const parsed = JSON.parse(raw) as Stored
    const light = cleanVars(parsed.custom?.light)
    const dark = cleanVars(parsed.custom?.dark)
    const custom: Palette | undefined =
      (light || dark) && typeof parsed.custom?.name === "string"
        ? { id: CUSTOM_ID, name: parsed.custom.name.slice(0, 40), ...(light ? { light } : {}), ...(dark ? { dark } : {}) }
        : undefined
    const known = parsed.id === CUSTOM_ID ? Boolean(custom) : PRESETS.some((preset) => preset.id === parsed.id)
    return { id: known ? parsed.id : DEFAULT_ID, ...(custom ? { custom } : {}) }
  } catch {
    return { id: DEFAULT_ID }
  }
}

function activeOf(current: Stored): Palette {
  if (current.id === CUSTOM_ID && current.custom) return current.custom
  return PRESETS.find((preset) => preset.id === current.id) ?? PRESETS[0]!
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
    // The choice then lasts only until the page reloads.
  }
  paint()
  for (const listener of [...listeners]) listener()
}

if (typeof window !== "undefined") {
  paint()
  // Another tab changed the theme.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return
    state = load()
    paint()
    for (const listener of [...listeners]) listener()
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface PaletteState {
  active: Palette
  /** The imported theme, when there is one. */
  custom: Palette | undefined
  /** The themes to pick from: the presets, then the imported one. */
  all: Palette[]
  choose: (id: string) => void
  /** Keep a parsed theme as the custom one and switch to it. */
  adopt: (parsed: Parsed, fallbackName: string) => Palette
  removeCustom: () => void
}

export function usePalette(): PaletteState {
  const current = useSyncExternalStore(subscribe, () => state, () => state)
  const choose = useCallback((id: string) => commit({ ...state, id }), [])
  const adopt = useCallback((parsed: Parsed, fallbackName: string): Palette => {
    const custom: Palette = {
      id: CUSTOM_ID,
      name: (parsed.name ?? fallbackName).slice(0, 40) || "Custom theme",
      ...(parsed.light ? { light: parsed.light } : {}),
      ...(parsed.dark ? { dark: parsed.dark } : {}),
    }
    commit({ id: CUSTOM_ID, custom })
    return custom
  }, [])
  const removeCustom = useCallback(() => commit({ id: state.id === CUSTOM_ID ? DEFAULT_ID : state.id }), [])
  const custom = current.custom
  return {
    active: activeOf(current),
    custom,
    all: custom ? [...PRESETS, custom] : [...PRESETS],
    choose,
    adopt,
    removeCustom,
  }
}
