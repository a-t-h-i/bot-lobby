/**
 * Colour themes, as plain data and pure functions (no DOM, so they can be
 * unit-tested). A theme is two maps of shadcn variables, one for light and one
 * for dark: exactly what tweakcn exports. The page comes with its own; the
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

export const DEFAULT_ID = "mist"

/**
 * The theme that comes with the page: its own colours, Claude's warm ivory and charcoal surfaces, which it sets
 * itself (index.css), so this sets nothing. Other themes are the user's own, imported from tweakcn.
 */
export const PRESETS: readonly Palette[] = [{ id: DEFAULT_ID, name: "Default" }]

/** Colours for a preview swatch, per mode: the default's own values by hand, the rest from the theme. */
const MIST_SWATCH = {
  light: { background: "#faf9f5", card: "#ffffff", primary: "#c96442", accent: "#f0eee6" },
  dark: { background: "#262624", card: "#30302e", primary: "#d97757", accent: "#1f1e1d" },
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
