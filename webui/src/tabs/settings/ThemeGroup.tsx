/**
 * Appearance: light, dark or follow the system, and the colour theme. A few
 * themes come with the page; a theme from tweakcn (its CSS, pasted, or a
 * `.css` / `.json` file) can be imported under a name of your own. Saved
 * themes, and which theme is chosen, are kept with pi (in its global config
 * folder), so every pi session and project shows them.
 */
import { useRef, useState, type KeyboardEvent } from "react"
import { Check, ExternalLink, Pencil, Trash2, Upload, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useTheme } from "@/components/theme-provider"
import { Switch } from "@/components/ui/switch"
import { setSoundMuted, useSoundMuted } from "@/app/sound"
import { Textarea } from "@/components/ui/textarea"
import { usePalette } from "@/app/palette"
import { MAX_THEME_BYTES, parseTheme, swatch, type Palette } from "@palette"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
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
          <button aria-keyshortcuts="Enter Space ArrowLeft ArrowRight" aria-describedby="focused-action-help"
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
                {palette.isSaved(entry.id) ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">saved</span> : null}
              </span>
              {on ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** One saved theme: its name, which can be changed in place, and a way to remove it. */
function SavedRow({ entry }: { entry: Palette }) {
  const palette = usePalette()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entry.name)
  const [error, setError] = useState<string>()
  async function rename() {
    const next = name.trim()
    if (!next || next === entry.name) return setEditing(false)
    try {
      await palette.rename(entry.id, next)
      setEditing(false)
      setError(undefined)
      toast.success(`Renamed to ${next}.`)
    } catch (failure) {
      setError((failure as Error).message)
    }
  }
  return (
    <li className="flex min-h-10 flex-wrap items-center gap-2 py-1.5">
      {editing ? (
        <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void rename() }}>
          <Input
            autoFocus
            value={name}
            maxLength={40}
            aria-label={`New name for ${entry.name}`}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              setName(entry.name)
              setEditing(false)
            }}
            className="h-8 max-w-64"
          />
          <ActionButton label="Save the name" text="Save" icon={Check} tone="primary" type="submit" disabled={!name.trim()} />
          <ActionButton label="Keep the old name" icon={X} iconOnly onClick={() => { setName(entry.name); setEditing(false) }} />
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
          <ActionButton label={`Rename ${entry.name}`} text="Rename" icon={Pencil} onClick={() => { setName(entry.name); setEditing(true) }} />
          <ConfirmButton label={`Remove ${entry.name}`} text="Remove" title={`Remove ${entry.name}?`} description="It is removed for every pi session. Keep a copy of its CSS if you want to use it again." confirmLabel="Remove theme" icon={Trash2} variant="destructive" onConfirm={() => void palette.remove(entry.id).catch((failure: Error) => toast.error(failure.message))} />
        </>
      )}
      {error ? <p role="alert" className="w-full text-xs text-destructive">{error}</p> : null}
    </li>
  )
}

function SavedThemes() {
  const palette = usePalette()
  if (palette.saved.length === 0) return <p className="text-xs text-muted-foreground">No saved themes yet. Import one below and give it a name.</p>
  return (
    <ul aria-label="Saved themes" className="divide-y divide-border">
      {palette.saved.map((entry) => <SavedRow key={entry.id} entry={entry} />)}
    </ul>
  )
}

function ImportTheme() {
  const palette = usePalette()
  const [text, setText] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  async function apply(source: string, fallbackName: string) {
    const parsed = parseTheme(source)
    if ("error" in parsed) {
      setError(parsed.error)
      return
    }
    setError(undefined)
    setSaving(true)
    try {
      const kept = await palette.adopt(parsed, name.trim() || parsed.name || fallbackName)
      setText("")
      setName("")
      const missing = !parsed.light ? "light" : !parsed.dark ? "dark" : undefined
      toast.success(missing ? `${kept.name} saved and applied. It has no ${missing} colours, so ${missing} mode keeps the default ones.` : `${kept.name} saved and applied.`)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_THEME_BYTES) {
      setError("That file is too large to be a theme.")
      return
    }
    await apply(await file.text(), file.name.replace(/\.[^.]+$/, "") || "Custom theme")
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
      <label className="grid gap-1 text-xs text-muted-foreground">
        Name
        <Input value={name} maxLength={40} placeholder="the theme's own name, or the file's" onChange={(event) => setName(event.target.value)} className="h-8 max-w-80 text-foreground" />
      </label>
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
        <ActionButton label="Save and apply the pasted theme" text="Save theme" icon={Check} tone="primary" disabled={!text.trim() || saving} onClick={() => void apply(text, "Custom theme")} />
        <ActionButton label="Upload a .css or .json theme file" text="Upload file" icon={Upload} disabled={saving} onClick={() => picker.current?.click()} />
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
  const muted = useSoundMuted()
  return (
    <Section prominent title={GROUP_TITLES.appearance}>
      <Rows>
        <Field label="Prompt sounds" help="A droplet for each new actionable prompt or delivery review. Kept in this browser; sound starts after interaction. Desktop notifications remain separate.">
          <Switch checked={!muted} onCheckedChange={(on) => setSoundMuted(!on)} aria-label="Prompt sounds" />
        </Field>
        <Field label={PAGE.themeLabel} help={PAGE.appearanceHelp}>
          <Choice value={theme} items={PAGE.themeItems.map((item) => ({ value: item.id, label: item.label }))} label={PAGE.themeLabel} onChange={(value) => setTheme(value as "light" | "dark" | "system")} />
        </Field>
        <Field label="Colour theme" help="The page's colours, the same in every pi session." stacked>
          <ThemePicker />
        </Field>
        <Field label="Saved themes" help="Themes you imported, kept with pi for every session and project." stacked>
          <SavedThemes />
        </Field>
        <Field label="Import a theme" stacked>
          <ImportTheme />
        </Field>
      </Rows>
    </Section>
  )
}
