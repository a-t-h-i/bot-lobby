/**
 * Colour themes, as plain data and pure functions (no DOM, so they can be
 * unit-tested). A theme is two maps of shadcn variables, one for light and one
 * for dark: exactly what tweakcn exports. A few themes come with the page; the
 * user can paste or upload another from tweakcn (its `:root { … } .dark { … }`
 * CSS, or its registry JSON).
 *
 * An imported file is never injected as it is. Only variables from an allow
 * list are kept, and a value is kept only when it is made of colour, length
 * and font-name characters (no `url()`, no `;`, no braces), so a theme can
 * recolour the page but cannot load anything or break out of its rule.
 */

export type Vars = Record<string, string>

export interface Palette {
  id: string
  name: string
  /** Overrides for the light page; absent means the page's own colours. */
  light?: Vars
  /** Overrides for the dark page. */
  dark?: Vars
}

/** The variables a theme may set, as tweakcn names them. Radius and shadows are ignored: the page keeps one calm 8px corner. */
const COLOUR_VARS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const

const FONT_VARS = ["font-sans", "font-mono"] as const

const ALLOWED = new Set<string>([...COLOUR_VARS, ...FONT_VARS])

/** What a colour or length may be made of. */
const SAFE_VALUE = /^[\w\s#%.,()/+*'"-]{1,300}$/
const BAD_VALUE = /url\s*\(|expression|import|javascript|\\|<|>/i

export const MAX_THEME_BYTES = 200_000

/** `oklch(0.6 0.2 250)`, `#fff`, `hsl(…)`, `var(--x)`, a font stack: kept; anything else: dropped. */
export function safeValue(raw: string): string | undefined {
  const value = raw.replace(/!important/gi, "").trim()
  if (!value || !SAFE_VALUE.test(value) || BAD_VALUE.test(value)) return undefined
  return value
}

function keep(name: string, raw: string, into: Vars): void {
  const key = name.replace(/^--/, "").toLowerCase()
  if (!ALLOWED.has(key)) return
  const value = safeValue(raw)
  if (value) into[key] = value
}

function declarations(block: string): Vars {
  const found: Vars = {}
  for (const match of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/gi)) keep(match[1]!, match[2]!, found)
  return found
}

/** A stored theme read back with the same filter as an import (the store is the user's to edit). */
export function cleanVars(map: unknown): Vars | undefined {
  if (!map || typeof map !== "object") return undefined
  const out: Vars = {}
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) if (typeof value === "string") keep(key, value, out)
  return Object.keys(out).length > 0 ? out : undefined
}

export interface Parsed {
  light?: Vars
  dark?: Vars
  name?: string
}

/** A theme from tweakcn's CSS (`:root {…} .dark {…}`) or its registry JSON (`{ "cssVars": { "light": {…}, "dark": {…} } }`). */
export function parseTheme(source: string): Parsed | { error: string } {
  const text = source.trim()
  if (!text) return { error: "Paste a theme first." }
  if (text.length > MAX_THEME_BYTES) return { error: "That file is too large to be a theme." }
  let light: Vars = {}
  let dark: Vars = {}
  let name: string | undefined
  if (text.startsWith("{")) {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { error: "That is not valid JSON or CSS." }
    }
    const record = json as { name?: unknown; title?: unknown; cssVars?: { theme?: Record<string, unknown>; light?: Record<string, unknown>; dark?: Record<string, unknown> } }
    const vars = record.cssVars
    if (!vars || typeof vars !== "object") return { error: "That JSON has no cssVars. Copy the theme's CSS from tweakcn instead." }
    const read = (map: Record<string, unknown> | undefined): Vars => {
      const out: Vars = {}
      for (const [key, value] of Object.entries(map ?? {})) if (typeof value === "string") keep(key, value, out)
      return out
    }
    light = { ...read(vars.theme), ...read(vars.light) }
    dark = { ...read(vars.theme), ...read(vars.dark) }
    name = typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : undefined
  } else {
    // Only the plain `:root` and `.dark` rules; `@theme inline` and the rest are the page's own business.
    for (const match of text.matchAll(/(?<=^|[}\s])((?::root|html|\.dark|:root\.dark|html\.dark)(?:\s*,\s*[^{]+)?)\s*\{([^}]*)\}/g)) {
      const selector = match[1]!.trim()
      const vars = declarations(match[2]!)
      if (/\.dark/.test(selector)) dark = { ...dark, ...vars }
      else light = { ...light, ...vars }
    }
  }
  const count = (vars: Vars) => Object.keys(vars).filter((key) => (COLOUR_VARS as readonly string[]).includes(key)).length
  if (count(light) < 5 && count(dark) < 5) return { error: "No theme colours found. Copy the code from tweakcn's Code panel (the :root and .dark blocks)." }
  return {
    ...(count(light) >= 5 ? { light } : {}),
    ...(count(dark) >= 5 ? { dark } : {}),
    ...(name ? { name } : {}),
  }
}

/** Page variables a theme does not name are worked out from the ones it does, so a theme from tweakcn is whole. */
const DERIVED: Vars = {
  "glass-border": "var(--border)",
  typing: "var(--ring)",
  "tab-active": "color-mix(in oklab, var(--primary) 14%, var(--background))",
  you: "color-mix(in oklab, var(--primary) 9%, var(--card))",
  heading: "var(--foreground)",
  link: "var(--primary)",
  bullet: "var(--primary)",
}

const SANS_FALLBACK = `"Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
const MONO_FALLBACK = `ui-monospace, "JetBrains Mono", "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`

function rule(selector: string, vars: Vars): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(vars)) {
    if (key === "font-sans") lines.push(`--app-font-sans:${value},${SANS_FALLBACK};`)
    else if (key === "font-mono") lines.push(`--app-font-mono:${value},${MONO_FALLBACK};`)
    else lines.push(`--${key}:${value};`)
  }
  for (const [key, value] of Object.entries(DERIVED)) if (!(key in vars)) lines.push(`--${key}:${value};`)
  return `${selector}{${lines.join("")}}`
}

/** The style sheet for a theme, or `""` for the page's own colours. */
export function paletteCss(palette: Palette): string {
  const parts: string[] = []
  if (palette.light) parts.push(rule(":root", palette.light))
  if (palette.dark) parts.push(rule(".dark", palette.dark))
  return parts.join("\n")
}

/** A palette from one hue, in oklch: a tinted mist and a tinted near-black, the hue as the accent. Chroma 0 is a neutral theme. */
function tinted(id: string, name: string, hue: number, chroma: number, lift = 0): Palette {
  const h = hue
  const c = chroma
  const n = (value: number) => Number(value.toFixed(3))
  const light: Vars = {
    background: `oklch(0.975 ${n(c * 0.1)} ${h})`,
    foreground: `oklch(0.22 ${n(c * 0.25)} ${h})`,
    card: "oklch(1 0 0)",
    "card-foreground": `oklch(0.22 ${n(c * 0.25)} ${h})`,
    popover: "oklch(1 0 0 / 0.92)",
    "popover-foreground": `oklch(0.22 ${n(c * 0.25)} ${h})`,
    primary: `oklch(${n(0.5 + lift)} ${c} ${h})`,
    "primary-foreground": "oklch(0.99 0 0)",
    secondary: `oklch(0.3 ${n(c * 0.3)} ${h} / 0.06)`,
    "secondary-foreground": `oklch(0.22 ${n(c * 0.25)} ${h})`,
    muted: `oklch(0.3 ${n(c * 0.3)} ${h} / 0.05)`,
    "muted-foreground": `oklch(0.5 ${n(c * 0.2)} ${h})`,
    accent: `oklch(${n(0.5 + lift)} ${c} ${h} / 0.1)`,
    "accent-foreground": `oklch(0.22 ${n(c * 0.25)} ${h})`,
    destructive: "oklch(0.52 0.19 28)",
    border: `oklch(0.92 ${n(c * 0.08)} ${h})`,
    input: `oklch(0.87 ${n(c * 0.1)} ${h})`,
    ring: `oklch(${n(0.6 + lift)} ${n(c * 0.9)} ${h})`,
    "chart-1": `oklch(${n(0.5 + lift)} ${c} ${h})`,
    "chart-2": "oklch(0.52 0.12 160)",
    "chart-3": "oklch(0.55 0.1 200)",
    "chart-4": "oklch(0.55 0.15 340)",
    "chart-5": "oklch(0.6 0.13 75)",
  }
  const dark: Vars = {
    background: `oklch(0.145 ${n(c * 0.08)} ${h})`,
    foreground: `oklch(0.93 ${n(c * 0.05)} ${h})`,
    card: `oklch(0.18 ${n(c * 0.09)} ${h})`,
    "card-foreground": `oklch(0.93 ${n(c * 0.05)} ${h})`,
    popover: `oklch(0.18 ${n(c * 0.09)} ${h} / 0.94)`,
    "popover-foreground": `oklch(0.93 ${n(c * 0.05)} ${h})`,
    primary: `oklch(${n(0.76 + lift / 2)} ${n(c * 0.85)} ${h})`,
    "primary-foreground": `oklch(0.18 ${n(c * 0.4)} ${h})`,
    secondary: "oklch(1 0 0 / 0.045)",
    "secondary-foreground": `oklch(0.93 ${n(c * 0.05)} ${h})`,
    muted: "oklch(1 0 0 / 0.04)",
    "muted-foreground": `oklch(0.7 ${n(c * 0.15)} ${h})`,
    accent: `oklch(0.76 ${n(c * 0.85)} ${h} / 0.14)`,
    "accent-foreground": `oklch(0.93 ${n(c * 0.05)} ${h})`,
    destructive: "oklch(0.74 0.12 25)",
    border: `oklch(0.25 ${n(c * 0.1)} ${h})`,
    input: `oklch(0.3 ${n(c * 0.1)} ${h})`,
    ring: `oklch(${n(0.76 + lift / 2)} ${n(c * 0.85)} ${h})`,
    "chart-1": `oklch(${n(0.76 + lift / 2)} ${n(c * 0.85)} ${h})`,
    "chart-2": "oklch(0.78 0.11 160)",
    "chart-3": "oklch(0.8 0.1 195)",
    "chart-4": "oklch(0.78 0.11 340)",
    "chart-5": "oklch(0.8 0.12 80)",
  }
  return { id, name, light, dark }
}

export const DEFAULT_ID = "mist"

/** The themes that come with the page; Mist is the page's own colours and sets nothing. */
export const PRESETS: readonly Palette[] = [
  { id: DEFAULT_ID, name: "Mist" },
  tinted("forest", "Forest", 155, 0.12),
  tinted("ocean", "Ocean", 225, 0.12),
  tinted("violet", "Violet", 305, 0.16),
  tinted("rose", "Rose", 5, 0.16),
  tinted("amber", "Amber", 70, 0.14, 0.06),
  tinted("mono", "Mono", 260, 0),
]

/** Colours for a preview swatch, per mode: Mist's own values by hand, the rest from the theme. */
const MIST_SWATCH = {
  light: { background: "#f6f7fa", card: "#ffffff", primary: "#4650d1", accent: "#e4e7fa" },
  dark: { background: "#050608", card: "#0b0d11", primary: "#8f9bff", accent: "#141830" },
} as const

export function swatch(palette: Palette, dark: boolean): { background: string; card: string; primary: string; accent: string } {
  const vars = dark ? palette.dark : palette.light
  const base = MIST_SWATCH[dark ? "dark" : "light"]
  if (!vars) return { ...base }
  return {
    background: vars.background ?? base.background,
    card: vars.card ?? base.card,
    primary: vars.primary ?? base.primary,
    accent: vars.primary ? `color-mix(in oklab, ${vars.primary} 18%, ${vars.background ?? base.background})` : base.accent,
  }
}
