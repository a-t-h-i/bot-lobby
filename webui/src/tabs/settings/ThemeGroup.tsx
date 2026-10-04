/**
 * Appearance: light, dark or follow the system, and the colour theme. A few
 * themes come with the page; a theme from tweakcn (its CSS, pasted, or a
 * `.css` / `.json` file) can be imported and is kept in this browser. Nothing
 * here is sent to the server.
 */
import { useRef, useState, type KeyboardEvent } from "react"
import { Check, ExternalLink, Trash2, Upload } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Textarea } from "@/components/ui/textarea"
import { usePalette } from "@/app/palette"
import { MAX_THEME_BYTES, parseTheme, swatch, type Palette } from "@/app/palette-core"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { ActionButton } from "@/ui/Actions"
import { Section } from "@/ui/Section"
import { Choice, Field, Rows } from "./parts"
import { GROUP_TITLES, PAGE } from "./words"

const TWEAKCN = "https://tweakcn.com/editor/theme"

function useDark(): boolean {
  const { theme } = useTheme()
  return theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches)
}

/** Four dots in the theme's own colours, for the mode you are in. */
function Swatch({ palette, dark }: { palette: Palette; dark: boolean }) {
  const colours = swatch(palette, dark)
  return (
    <span aria-hidden="true" className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2" style={{ background: colours.background }}>
      <span className="size-4 rounded-full border border-black/10" style={{ background: colours.card }} />
      <span className="size-4 rounded-full" style={{ background: colours.primary }} />
      <span className="h-2 flex-1 rounded-full" style={{ background: colours.accent }} />
    </span>
  )
}

function ThemePicker() {
  const palette = usePalette()
  const dark = useDark()
  const group = useRef<HTMLDivElement>(null)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    const index = Math.max(0, palette.all.findIndex((entry) => entry.id === palette.active.id))
    const next = palette.all[(index + step + palette.all.length) % palette.all.length]!
    palette.choose(next.id)
    window.requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-theme-id="${next.id}"]`)?.focus())
  }

  return (
    <div ref={group} role="radiogroup" aria-label="Colour theme" onKeyDown={onKeyDown} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {palette.all.map((entry) => {
        const on = entry.id === palette.active.id
        return (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-theme-id={entry.id}
            tabIndex={on ? 0 : -1}
            onClick={() => palette.choose(entry.id)}
            className={cn(
              "grid gap-1.5 rounded-lg border p-2 text-left outline-none transition-[border-color,box-shadow,background-color] duration-150 focus-visible:ring-3 focus-visible:ring-ring/40",
              on ? "border-primary bg-accent shadow-[0_0_0_1px_var(--primary)]" : "border-border hover:bg-accent/50"
            )}
          >
            <Swatch palette={entry} dark={dark} />
            <span className="flex items-center justify-between gap-2 px-0.5 text-[0.8125rem] font-medium">
              <span className="truncate">
                {entry.name}
                {entry.id === "custom" ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">imported</span> : null}
              </span>
              {on ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ImportTheme() {
  const palette = usePalette()
  const [text, setText] = useState("")
  const [error, setError] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)

  function apply(source: string, fallbackName: string) {
    const parsed = parseTheme(source)
    if ("error" in parsed) {
      setError(parsed.error)
      return
    }
    setError(undefined)
    const kept = palette.adopt(parsed, fallbackName)
    setText("")
    const missing = !parsed.light ? "light" : !parsed.dark ? "dark" : undefined
    toast.success(missing ? `${kept.name} applied. It has no ${missing} colours, so ${missing} mode keeps the default ones.` : `${kept.name} applied.`)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_THEME_BYTES) {
      setError("That file is too large to be a theme.")
      return
    }
    apply(await file.text(), file.name.replace(/\.[^.]+$/, "") || "Custom theme")
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Pick or build a theme in the{" "}
        <a href={TWEAKCN} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-link underline-offset-2 hover:underline">
          tweakcn editor <ExternalLink aria-hidden="true" className="size-3" />
        </a>
        , press Code, copy it, and paste it here, or save it as a file and upload that. Colours and fonts are used; corners stay the page's own.
      </p>
      <Textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setError(undefined)
        }}
        rows={4}
        spellCheck={false}
        aria-label="Theme CSS from tweakcn"
        aria-invalid={error ? true : undefined}
        placeholder={":root {\n  --background: oklch(0.98 0 0);\n  --primary: oklch(0.55 0.2 260);\n  …\n}\n.dark { … }"}
        className="max-h-56 font-mono text-xs md:text-xs"
      />
      <div className="flex items-center gap-1">
        <input ref={picker} type="file" accept=".css,.json,text/css,application/json" hidden tabIndex={-1} aria-label="Upload a theme file" onChange={(event) => {
          void onFile(event.target.files?.[0])
          event.target.value = ""
        }} />
        <ActionButton label="Apply the pasted theme" icon={Check} tone="primary" disabled={!text.trim()} onClick={() => apply(text, "Custom theme")} />
        <ActionButton label="Upload a .css or .json theme file" icon={Upload} onClick={() => picker.current?.click()} />
        {palette.custom ? <ActionButton label={`Remove ${palette.custom.name}`} icon={Trash2} tone="danger" onClick={() => palette.removeCustom()} /> : null}
        {error ? (
          <p role="alert" className="ml-2 min-w-0 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function ThemeGroup() {
  const { theme, setTheme } = useTheme()
  return (
    <Section title={GROUP_TITLES.appearance}>
      <Rows>
        <Field label={PAGE.themeLabel} help={PAGE.appearanceHelp}>
          <Choice value={theme} items={PAGE.themeItems.map((item) => ({ value: item.id, label: item.label }))} label={PAGE.themeLabel} onChange={(value) => setTheme(value as "light" | "dark" | "system")} />
        </Field>
        <Field label="Colour theme" help="The page's colours. Kept in this browser only." stacked>
          <ThemePicker />
        </Field>
        <Field label="Import a theme" stacked>
          <ImportTheme />
        </Field>
      </Rows>
    </Section>
  )
}
