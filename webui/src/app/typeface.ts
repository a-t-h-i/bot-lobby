/**
 * The page's typefaces: a short list of bundled ones (each only its Latin, variable weights) or the system's
 * own, for the text and for code. Kept in this browser like the sounds; `html[data-font]` and
 * `html[data-mono]` pick the face in fonts.css, and "theme" leaves it to the colour theme's own fonts.
 */
import { useSyncExternalStore } from "react"

export interface Typeface {
  id: string
  label: string
  /** What it suits, said under its name. */
  help: string
}

export const TEXT_FACES: readonly Typeface[] = [
  { id: "theme", label: "System", help: "The system's own (or the colour theme's)" },
  { id: "inter", label: "Inter", help: "Neutral and very legible" },
  { id: "geist", label: "Geist", help: "Crisp and modern" },
  { id: "plex", label: "IBM Plex Sans", help: "Technical, with character" },
  { id: "manrope", label: "Manrope", help: "Round and friendly" },
  { id: "dm-sans", label: "DM Sans", help: "Geometric, low contrast" },
  { id: "jakarta", label: "Plus Jakarta Sans", help: "Polished product sans" },
  { id: "figtree", label: "Figtree", help: "Clean and approachable" },
  { id: "outfit", label: "Outfit", help: "Geometric display feel" },
  { id: "nunito", label: "Nunito", help: "Soft rounded terminals" },
  { id: "space-grotesk", label: "Space Grotesk", help: "Quirky, technical" },
  { id: "source-sans", label: "Source Sans 3", help: "Classic UI workhorse" },
]

export const CODE_FACES: readonly Typeface[] = [
  { id: "theme", label: "System mono", help: "The system's own (or the colour theme's)" },
  { id: "jetbrains", label: "JetBrains Mono", help: "Tall, made for code" },
  { id: "geist-mono", label: "Geist Mono", help: "Pairs with Geist" },
  { id: "fira-code", label: "Fira Code", help: "Ligatures for operators" },
  { id: "roboto-mono", label: "Roboto Mono", help: "Even and compact" },
  { id: "source-code", label: "Source Code Pro", help: "Open and readable" },
]

type Kind = "font" | "mono"
const KEYS: Record<Kind, string> = { font: "bot-lobby.typeface", mono: "bot-lobby.typeface-code" }
const LISTS: Record<Kind, readonly Typeface[]> = { font: TEXT_FACES, mono: CODE_FACES }
const memory: Record<Kind, string> = { font: "theme", mono: "theme" }
const listeners = new Set<() => void>()

export function typeface(kind: Kind): string {
  let value: string | null = null
  try { value = localStorage.getItem(KEYS[kind]) } catch { value = memory[kind] }
  return LISTS[kind].some((face) => face.id === value) ? value! : "theme"
}

function apply(kind: Kind, id: string): void {
  const root = document.documentElement
  if (id === "theme") delete root.dataset[kind]
  else root.dataset[kind] = id
}

export function setTypeface(kind: Kind, id: string): void {
  memory[kind] = id
  try { localStorage.setItem(KEYS[kind], id) } catch { /* Browser-local memory still works. */ }
  apply(kind, id)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTypeface(kind: Kind): string {
  return useSyncExternalStore(subscribe, () => typeface(kind), () => "theme")
}

// Before the first paint, so the page never flashes the other face.
if (typeof document !== "undefined") {
  apply("font", typeface("font"))
  apply("mono", typeface("mono"))
}

/** Each face's stack, for drawing a sample of it. */
export const FACE_STACKS: Record<string, string> = {
  inter: '"Inter Variable", system-ui, sans-serif',
  geist: '"Geist Variable", system-ui, sans-serif',
  plex: '"IBM Plex Sans Variable", system-ui, sans-serif',
  manrope: '"Manrope Variable", system-ui, sans-serif',
  jetbrains: '"JetBrains Mono Variable", ui-monospace, monospace',
  "geist-mono": '"Geist Mono Variable", ui-monospace, monospace',
  "dm-sans": '"DM Sans Variable", system-ui, sans-serif',
  jakarta: '"Plus Jakarta Sans Variable", system-ui, sans-serif',
  figtree: '"Figtree Variable", system-ui, sans-serif',
  outfit: '"Outfit Variable", system-ui, sans-serif',
  nunito: '"Nunito Variable", system-ui, sans-serif',
  "space-grotesk": '"Space Grotesk Variable", system-ui, sans-serif',
  "source-sans": '"Source Sans 3 Variable", system-ui, sans-serif',
  "fira-code": '"Fira Code Variable", ui-monospace, monospace',
  "roboto-mono": '"Roboto Mono Variable", ui-monospace, monospace',
  "source-code": '"Source Code Pro Variable", ui-monospace, monospace',
}
