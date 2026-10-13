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

export const DEFAULT_ID = "mist"

/**
 * The themes that come with the page. The first is the page's own colours and
 * sets nothing; the rest are T3 Code's built-in themes (MIT, Copyright (c) 2026
 * T3 Tools Inc., packages/shared/src/themePalettes.ts), their roles mapped onto
 * the shadcn variables: canvas is the background, surface the card, accent the
 * primary, accent surface the accent, error the destructive colour.
 */
export const PRESETS: readonly Palette[] = [
  { id: DEFAULT_ID, name: "Default" },
  {
    id: "blossom",
    name: "Blossom",
    light: {
      "background": "oklch(0.982446 0.010114 325.653)",
      "foreground": "oklch(0.325698 0.116116 325.037)",
      "card": "oklch(0.971835 0.012884 321.894)",
      "card-foreground": "oklch(0.325698 0.116116 325.037)",
      "popover": "oklch(1 0 0)",
      "popover-foreground": "oklch(0.325698 0.116116 325.037)",
      "primary": "oklch(0.591646 0.217985 0.584)",
      "primary-foreground": "oklch(1 0 0)",
      "secondary": "oklch(0.869588 0.06751 334.899)",
      "secondary-foreground": "oklch(0.444777 0.134061 324.799)",
      "muted": "oklch(0.802407 0.090963 345.892)",
      "muted-foreground": "oklch(0.428932 0.163929 354.332)",
      "accent": "oklch(0.939552 0.024286 321.664)",
      "accent-foreground": "oklch(0.396296 0.025134 285.196)",
      "destructive": "oklch(0.627117 0.248974 7.734)",
      "border": "oklch(0.923531 0.021247 328.096)",
      "input": "oklch(0.851713 0.055822 336.6)",
      "ring": "oklch(0.591646 0.217985 0.584)",
      "chart-1": "oklch(0.591646 0.217985 0.584)",
    },
    dark: {
      "background": "oklch(0.22813 0.020366 307.469)",
      "foreground": "oklch(0.980735 0.004092 301.426)",
      "card": "oklch(0.267101 0.02016 311.799)",
      "card-foreground": "oklch(0.980735 0.004092 301.426)",
      "popover": "oklch(0.154761 0.01316 338.901)",
      "popover-foreground": "oklch(0.980735 0.004092 301.426)",
      "primary": "oklch(0.460685 0.185347 4.099)",
      "primary-foreground": "oklch(0.901233 0.057189 343.694)",
      "secondary": "oklch(0.313674 0.030572 310.061)",
      "secondary-foreground": "oklch(0.848252 0.038248 307.961)",
      "muted": "oklch(0.360924 0.021469 316.83)",
      "muted-foreground": "oklch(0.880303 0.03077 342.696)",
      "accent": "oklch(0.364912 0.050794 308.491)",
      "accent-foreground": "oklch(0.964695 0.009139 341.803)",
      "destructive": "oklch(0.458704 0.169677 3.815)",
      "border": "oklch(0.266943 0.015262 302.425)",
      "input": "oklch(0.266817 0.02897 344.461)",
      "ring": "oklch(0.591646 0.217985 0.584)",
      "chart-1": "oklch(0.460685 0.185347 4.099)",
    },
  },
  {
    id: "grove",
    name: "Grove",
    light: {
      "background": "oklch(0.972369 0.005497 157.15)",
      "foreground": "oklch(0.222003 0.03479 328.979)",
      "card": "oklch(0.972369 0.005497 157.15)",
      "card-foreground": "oklch(0.222003 0.03479 328.979)",
      "popover": "oklch(0.932695 0.003778 160.944)",
      "popover-foreground": "oklch(0.222003 0.03479 328.979)",
      "primary": "oklch(0.523295 0.112292 158.089)",
      "primary-foreground": "oklch(0.990339 0.008411 325.64)",
      "secondary": "oklch(0.936464 0.014601 163.554)",
      "secondary-foreground": "oklch(0.222003 0.03479 328.979)",
      "muted": "oklch(0.945455 0.012308 162.879)",
      "muted-foreground": "oklch(0.527266 0.012309 320.683)",
      "accent": "oklch(0.909438 0.021521 164.612)",
      "accent-foreground": "oklch(0.222003 0.03479 328.979)",
      "destructive": "oklch(0.637823 0.237287 25.436)",
      "border": "oklch(0.864831 0.01312 167.255)",
      "input": "oklch(0.829746 0.016084 168.234)",
      "ring": "oklch(0.523295 0.112292 158.089)",
      "chart-1": "oklch(0.523295 0.112292 158.089)",
    },
    dark: {
      "background": "oklch(0.260865 0.02152 162.75)",
      "foreground": "oklch(0.990339 0.008411 325.64)",
      "card": "oklch(0.260865 0.02152 162.75)",
      "card-foreground": "oklch(0.990339 0.008411 325.64)",
      "popover": "oklch(0.411828 0.014378 166.627)",
      "popover-foreground": "oklch(0.990339 0.008411 325.64)",
      "primary": "oklch(0.796228 0.133058 157.319)",
      "primary-foreground": "oklch(0.222003 0.03479 328.979)",
      "secondary": "oklch(0.380487 0.048313 159.608)",
      "secondary-foreground": "oklch(0.990339 0.008411 325.64)",
      "muted": "oklch(0.339728 0.039456 160.274)",
      "muted-foreground": "oklch(0.715427 0.010896 171.428)",
      "accent": "oklch(0.437021 0.060312 158.962)",
      "accent-foreground": "oklch(0.990339 0.008411 325.64)",
      "destructive": "oklch(0.655108 0.221148 23.473)",
      "border": "oklch(0.457475 0.044046 160.971)",
      "input": "oklch(0.519849 0.049896 160.863)",
      "ring": "oklch(0.796228 0.133058 157.319)",
      "chart-1": "oklch(0.796228 0.133058 157.319)",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    light: {
      "background": "oklch(0.974199 0.002856 241.597)",
      "foreground": "oklch(0.222003 0.03479 328.979)",
      "card": "oklch(0.974199 0.002856 241.597)",
      "card-foreground": "oklch(0.222003 0.03479 328.979)",
      "popover": "oklch(0.934442 0.003181 269.1)",
      "popover-foreground": "oklch(0.222003 0.03479 328.979)",
      "primary": "oklch(0.536684 0.120219 247.01)",
      "primary-foreground": "oklch(0.990339 0.008411 325.64)",
      "secondary": "oklch(0.939254 0.01193 241.729)",
      "secondary-foreground": "oklch(0.222003 0.03479 328.979)",
      "muted": "oklch(0.948004 0.009649 241.695)",
      "muted-foreground": "oklch(0.528741 0.01828 313.823)",
      "accent": "oklch(0.91295 0.018827 241.836)",
      "accent-foreground": "oklch(0.222003 0.03479 328.979)",
      "destructive": "oklch(0.637823 0.237287 25.436)",
      "border": "oklch(0.867646 0.013482 252.362)",
      "input": "oklch(0.832939 0.017389 252.598)",
      "ring": "oklch(0.536684 0.120219 247.01)",
      "chart-1": "oklch(0.536684 0.120219 247.01)",
    },
    dark: {
      "background": "oklch(0.242641 0.024125 250.573)",
      "foreground": "oklch(0.990339 0.008411 325.64)",
      "card": "oklch(0.242641 0.024125 250.573)",
      "card-foreground": "oklch(0.990339 0.008411 325.64)",
      "popover": "oklch(0.398517 0.018232 255.72)",
      "popover-foreground": "oklch(0.990339 0.008411 325.64)",
      "primary": "oklch(0.758933 0.105833 241.548)",
      "primary-foreground": "oklch(0.222003 0.03479 328.979)",
      "secondary": "oklch(0.358725 0.043145 244.911)",
      "secondary-foreground": "oklch(0.990339 0.008411 325.64)",
      "muted": "oklch(0.319287 0.036766 246.065)",
      "muted-foreground": "oklch(0.691936 0.016294 261.588)",
      "accent": "oklch(0.413315 0.051874 243.855)",
      "accent-foreground": "oklch(0.990339 0.008411 325.64)",
      "destructive": "oklch(0.655108 0.221148 23.473)",
      "border": "oklch(0.438653 0.039496 245.44)",
      "input": "oklch(0.500905 0.043574 244.781)",
      "ring": "oklch(0.758933 0.105833 241.548)",
      "chart-1": "oklch(0.758933 0.105833 241.548)",
    },
  },
  {
    id: "ember",
    name: "Ember",
    light: {
      "background": "oklch(0.976527 0.002685 60.725)",
      "foreground": "oklch(0.222003 0.03479 328.979)",
      "card": "oklch(0.976527 0.002685 60.725)",
      "card-foreground": "oklch(0.222003 0.03479 328.979)",
      "popover": "oklch(0.936659 0.002879 29.96)",
      "popover-foreground": "oklch(0.222003 0.03479 328.979)",
      "primary": "oklch(0.552831 0.129438 44.656)",
      "primary-foreground": "oklch(0.990339 0.008411 325.64)",
      "secondary": "oklch(0.942267 0.01151 50.785)",
      "secondary-foreground": "oklch(0.222003 0.03479 328.979)",
      "muted": "oklch(0.950842 0.009273 51.528)",
      "muted-foreground": "oklch(0.530413 0.018453 341.181)",
      "accent": "oklch(0.916502 0.01832 49.597)",
      "accent-foreground": "oklch(0.222003 0.03479 328.979)",
      "destructive": "oklch(0.637823 0.237287 25.436)",
      "border": "oklch(0.870631 0.013204 39.431)",
      "input": "oklch(0.836213 0.017153 38.661)",
      "ring": "oklch(0.552831 0.129438 44.656)",
      "chart-1": "oklch(0.552831 0.129438 44.656)",
    },
    dark: {
      "background": "oklch(0.245899 0.019144 42.044)",
      "foreground": "oklch(0.990339 0.008411 325.64)",
      "card": "oklch(0.245899 0.019144 42.044)",
      "card-foreground": "oklch(0.990339 0.008411 325.64)",
      "popover": "oklch(0.401111 0.014308 34.896)",
      "popover-foreground": "oklch(0.990339 0.008411 325.64)",
      "primary": "oklch(0.762174 0.124117 52.082)",
      "primary-foreground": "oklch(0.222003 0.03479 328.979)",
      "secondary": "oklch(0.361499 0.044052 49.515)",
      "secondary-foreground": "oklch(0.990339 0.008411 325.64)",
      "muted": "oklch(0.322144 0.03574 48.309)",
      "muted-foreground": "oklch(0.692479 0.015227 30.963)",
      "accent": "oklch(0.416048 0.055354 50.484)",
      "accent-foreground": "oklch(0.990339 0.008411 325.64)",
      "destructive": "oklch(0.655108 0.221148 23.473)",
      "border": "oklch(0.44099 0.040202 48.807)",
      "input": "oklch(0.503003 0.045721 49.44)",
      "ring": "oklch(0.762174 0.124117 52.082)",
      "chart-1": "oklch(0.762174 0.124117 52.082)",
    },
  },
  {
    id: "iris",
    name: "Iris",
    light: {
      "background": "oklch(0.976531 0.003855 303.226)",
      "foreground": "oklch(0.222003 0.03479 328.979)",
      "card": "oklch(0.976531 0.003855 303.226)",
      "card-foreground": "oklch(0.222003 0.03479 328.979)",
      "popover": "oklch(0.936665 0.005041 310.132)",
      "popover-foreground": "oklch(0.222003 0.03479 328.979)",
      "primary": "oklch(0.525348 0.15373 294.176)",
      "primary-foreground": "oklch(0.990339 0.008411 325.64)",
      "secondary": "oklch(0.941387 0.014687 300.474)",
      "secondary-foreground": "oklch(0.222003 0.03479 328.979)",
      "muted": "oklch(0.950194 0.011956 300.733)",
      "muted-foreground": "oklch(0.529955 0.022319 321.556)",
      "accent": "oklch(0.914882 0.022965 299.986)",
      "accent-foreground": "oklch(0.222003 0.03479 328.979)",
      "destructive": "oklch(0.637823 0.237287 25.436)",
      "border": "oklch(0.869608 0.018226 303.859)",
      "input": "oklch(0.834773 0.023405 303.676)",
      "ring": "oklch(0.525348 0.15373 294.176)",
      "chart-1": "oklch(0.525348 0.15373 294.176)",
    },
    dark: {
      "background": "oklch(0.225975 0.031062 293.741)",
      "foreground": "oklch(0.990339 0.008411 325.64)",
      "card": "oklch(0.225975 0.031062 293.741)",
      "card-foreground": "oklch(0.990339 0.008411 325.64)",
      "popover": "oklch(0.386739 0.024023 297.509)",
      "popover-foreground": "oklch(0.990339 0.008411 325.64)",
      "primary": "oklch(0.671712 0.169136 293.929)",
      "primary-foreground": "oklch(0.222003 0.03479 328.979)",
      "secondary": "oklch(0.325405 0.063614 294.23)",
      "secondary-foreground": "oklch(0.990339 0.008411 325.64)",
      "muted": "oklch(0.291515 0.05276 294.209)",
      "muted-foreground": "oklch(0.663321 0.025932 301.862)",
      "accent": "oklch(0.372436 0.07841 294.204)",
      "accent-foreground": "oklch(0.990339 0.008411 325.64)",
      "destructive": "oklch(0.655108 0.221148 23.473)",
      "border": "oklch(0.40874 0.058536 295.893)",
      "input": "oklch(0.46756 0.065775 296.265)",
      "ring": "oklch(0.671712 0.169136 293.929)",
      "chart-1": "oklch(0.671712 0.169136 293.929)",
    },
  },
]

/** Colours for a preview swatch, per mode: the default's own values by hand, the rest from the theme. */
const MIST_SWATCH = {
  light: { background: "#fcfcfc", card: "#ffffff", primary: "#1b4ed8", accent: "#f4f4f5" },
  dark: { background: "#0a0a0a", card: "#111111", primary: "#346bf1", accent: "#141414" },
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
