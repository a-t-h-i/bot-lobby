/**
 * The settings form: each agent's model and effort (a drop-down listing every
 * level, the ones the model cannot do shown but not choosable), the MCP tools and skills each
 * agent is granted, the workflow, the lobby and the classifier, read from `settings.get` and saved back with a minimal
 * `settings.set` patch. A refused patch (`bad_request`) shows the server's own
 * message and leaves the field reading its saved value, because every control
 * is driven by the config the server last returned. The appearance,
 * notification and install rows are page-only and never sent to the server.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Brain, Check, ChevronRight, CircleAlert, CircleCheck, Download, Maximize, Minimize, Wrench } from "lucide-react"
import { toast } from "@/lib/toast"
import { useFullscreen, useInstallPrompt, useInstalled } from "@/app/install"
import { disableNotifications, enableNotifications, useNotificationsEnabled } from "@/app/notify"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ActionButton } from "@/ui/Actions"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EffortChoice } from "@/ui/EffortChoice"
import { nearestSupported } from "@/ui/effortLevels"
import { agentColor } from "@/ui/AgentIcon"
import { call } from "@/lib/api"
import { useApiRead } from "@/app/useApiRead"
import { Section } from "@/ui/Section"
import { Segmented } from "@/ui/Segmented"
import { Choice, Field, Rows, type ChoiceItem } from "./parts"
import { ThemeGroup } from "./ThemeGroup"
import { GrantsGroup, grantsLine, grantsOf } from "./GrantsGroup"
import { HarnessesGroup } from "./HarnessesGroup"
import type { BotLobbyConfig, HarnessModel, HarnessStatus, SettingsClassifierModel, SettingsModelInfo } from "@protocol"
import {
  AGENT_LABELS,
  AGENT_ORDER,
  CLASSIFIER_FEATURE_ITEMS,
  CLASSIFIER_LABELS,
  CUSTOM_HELP,
  CUSTOM_LABEL,
  CUSTOM_MODEL,
  FIXED_SCOUT_THINKING,
  GIT_ISOLATION_ITEMS,
  GRANTS,
  RECOMMENDED_THINKING,
  GIT_LABEL,
  GROUP_TITLES,
  HARNESS,
  HARNESS_AGENTS,
  INHERIT_HELP,
  INHERIT_LABEL,
  INHERIT_MODEL,
  JEV_HOST_ITEMS,
  LINT,
  LINT_MODE_ITEMS,
  LOBBY_SWITCH_ITEMS,
  PAGE,
  PANEL_HELP,
  PANEL_ITEMS,
  PI_HARNESS,
  RETAIN,
  ROUNDS_HELP,
  ROUNDS_LABEL,
  ROUND_CHOICES,
  THINKING_LEVELS,
  WEB_BROWSER_HELP,
  WEB_BROWSER_LABEL,
  WEB_PORT_HELP,
  WEB_PORT_LABEL,
  COMPACT_AT,
  type AgentKind,
} from "./words"

type Config = BotLobbyConfig
type Save = (patch: Record<string, unknown>) => Promise<boolean>

interface AgentView {
  model: string
  thinking: string
  autoCompact?: boolean
  compactAt?: number
  instructions?: string
  mcpTools?: string[]
  skills?: string[]
  harness?: string
  harnessModel?: string
}

/** Where each agent's fields live in the config (`agents.<kind>` for the three domains). */
const AGENT_PATH: Record<AgentKind, string[]> = {
  master: ["master"],
  designer: ["agents", "designer"],
  backend: ["agents", "backend"],
  qa: ["agents", "qa"],
  scout: ["scout"],
  researcher: ["researcher"],
  planner: ["planner"],
}

/** Every lobby toggle: the menu's switches plus the three panes. */
const LOBBY_TOGGLES = [
  ...LOBBY_SWITCH_ITEMS,
  ...PANEL_ITEMS.map((panel) => ({ id: `panel:${panel.id}`, label: panel.label, help: PANEL_HELP })),
]

function entryOf(config: Config, kind: AgentKind): AgentView {
  switch (kind) {
    case "master":
      return config.master
    case "scout":
      return {
        model: config.scout.model,
        thinking: FIXED_SCOUT_THINKING,
        mcpTools: config.scout.mcpTools,
        ...(config.scout.skills ? { skills: config.scout.skills } : {}),
        ...(config.scout.autoCompact === false ? { autoCompact: false } : {}),
        ...(config.scout.compactAt ? { compactAt: config.scout.compactAt } : {}),
        ...(config.scout.harness ? { harness: config.scout.harness } : {}),
        ...(config.scout.harnessModel ? { harnessModel: config.scout.harnessModel } : {}),
      }
    case "researcher":
      return config.researcher
    case "planner":
      return config.planner
    default:
      return config.agents[kind]
  }
}

function patchOf(kind: AgentKind, fields: Record<string, unknown>): Record<string, unknown> {
  return AGENT_PATH[kind].reduceRight<Record<string, unknown>>((acc, key) => ({ [key]: acc }), fields)
}

/** The effort levels a model supports; a model Pi does not list (a typed id, `inherit`) is allowed them all. */
function levelsFor(models: SettingsModelInfo[], model: string): readonly string[] {
  return models.find((entry) => entry.id === model)?.thinkingLevels ?? THINKING_LEVELS
}

/** The level a model runs a requested one at: itself when supported, else the nearest it supports. */
function levelOn(supported: readonly string[], level: string): string {
  const index = nearestSupported(THINKING_LEVELS, supported, Math.max(0, THINKING_LEVELS.indexOf(level as (typeof THINKING_LEVELS)[number])))
  return THINKING_LEVELS[index] ?? level
}

const roundLabel = (value: number): string => (value > 0 ? `${value} round${value === 1 ? "" : "s"}` : "unlimited")

/** A small label above a control, for the dense grids inside an agent's card. */
function ModelChoice(props: { value: string; models: SettingsModelInfo[]; label: string; none?: boolean; inherit?: boolean; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState("")
  const known = props.models.some((model) => model.id === props.value)
  const items: ChoiceItem[] = [
    ...(props.inherit ? [{ value: INHERIT_MODEL, label: INHERIT_LABEL, help: INHERIT_HELP }] : []),
    ...(props.none ? [{ value: INHERIT_MODEL, label: "none", help: "Use the primary model" }] : []),
    ...(!props.inherit && !props.none && props.value === INHERIT_MODEL ? [{ value: INHERIT_MODEL, label: INHERIT_LABEL, help: INHERIT_HELP }] : []),
    ...props.models.map((model) => ({ value: model.id, label: model.id, ...(model.label && model.label !== model.id ? { help: model.label } : {}) })),
    ...(!known && props.value !== INHERIT_MODEL ? [{ value: props.value, label: props.value, help: CUSTOM_HELP }] : []),
    { value: CUSTOM_MODEL, label: CUSTOM_LABEL, help: CUSTOM_HELP },
  ]
  const choose = (next: string) => {
    if (next !== CUSTOM_MODEL) return props.onChange(next)
    setText(known ? "" : props.value)
    setTyping(true)
  }
  const use = () => {
    const next = text.trim()
    setTyping(false)
    if (next && next !== props.value) props.onChange(next)
  }
  return (
    <div className="flex flex-col gap-2">
      <Choice value={props.value} items={items} label={props.label} onChange={choose} />
      {typing ? (
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <Input autoFocus value={text} placeholder="provider/model" aria-label="Model id" className="min-w-0 flex-1" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); use() } }} />
          <ActionButton label="Use this model" icon={Check} tone="primary" onClick={use} />
        </div>
      ) : null}
    </div>
  )
}

function ToggleField({ label, help, checked, onChange, name }: { label: string; help?: string; checked: boolean; onChange: (next: boolean) => void; name?: string }) {
  return (
    <div className="flex min-h-0 items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="break-words text-[0.8125rem] font-medium">{label}</div>
        {help ? <p className="break-words text-xs text-muted-foreground">{help}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={name ?? label} />
    </div>
  )
}

function TextValue({ value, onSave, placeholder, label }: { value: string; onSave: (value: string) => void; placeholder?: string; label: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    const next = text.trim()
    if (next !== value) onSave(next)
  }
  return <Input value={text} placeholder={placeholder} aria-label={label} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
}

function MinutesField({ value, label, onSave }: { value: number; label: string; onSave: (ms: number) => void }) {
  const minutes = Math.round(value / 60_000)
  return (
    <NumberField label={label} value={String(minutes)} min={1} suffix="min" onSave={(text) => {
      const parsed = Number(text)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error(`"${text}" is not a positive number of minutes.`)
        return false
      }
      onSave(Math.round(parsed * 60_000))
      return true
    }} />
  )
}

/** Auto-compaction's threshold in tokens; left empty, the built-in one. */
function CompactAtField({ value, label, onSave }: { value?: number; label: string; onSave: (tokens: number | null) => void }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[0.8125rem] font-medium">{COMPACT_AT.label}</div>
        <p className="break-words text-xs text-muted-foreground">{COMPACT_AT.help}</p>
      </div>
      <div className="w-36 shrink-0">
        <NumberField label={label} value={value ? String(value) : ""} min={COMPACT_AT.min} max={COMPACT_AT.max} step={1000} placeholder={COMPACT_AT.placeholder} suffix="tokens" onSave={(text) => {
          if (text === "") {
            onSave(null)
            return true
          }
          const parsed = Number(text)
          if (!Number.isInteger(parsed) || parsed < COMPACT_AT.min || parsed > COMPACT_AT.max) {
            toast.error(COMPACT_AT.bad(text))
            return false
          }
          onSave(parsed)
          return true
        }} />
      </div>
    </div>
  )
}

function PortField({ value, onSave }: { value: number; onSave: (port: number) => void }) {
  return (
    <NumberField label={WEB_PORT_LABEL} value={String(value)} min={0} max={65535} onSave={(text) => {
      if (!/^\d+$/.test(text) || Number(text) > 65535) {
        toast.error(`"${text}" is not a port (0, or 1-65535).`)
        return false
      }
      onSave(Number(text))
      return true
    }} />
  )
}

function NumberField({ label, value, min, max, step, placeholder, suffix, onSave }: { label: string; value: string; min: number; max?: number; step?: number; placeholder?: string; suffix?: string; onSave: (text: string) => boolean }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    if (text === value) return
    if (!onSave(text.trim())) setText(value)
  }
  return (
    <div className="relative">
      <Input type="number" inputMode="numeric" min={min} max={max} step={step} placeholder={placeholder} value={text} aria-label={label} className={suffix ? (suffix.length > 3 ? "pr-14" : "pr-10") : undefined} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
      {suffix ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  )
}

function InstructionsField({ value, label, onSave }: { value: string; label: string; onSave: (value: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea rows={2} value={text} aria-label={label} onChange={(event) => setText(event.target.value)} onBlur={() => { if (text.trim() !== value) onSave(text.trim()) }} />
      <p className="text-xs text-muted-foreground">Saved when you leave the field.</p>
    </div>
  )
}

/** pi, then every third-party harness, marking the ones not found on this machine. */
function HarnessChoice({ value, statuses, label, onChange }: { value: string; statuses: HarnessStatus[]; label: string; onChange: (value: string) => void }) {
  const items: ChoiceItem[] = [
    { value: PI_HARNESS, label: HARNESS.piLabel, help: HARNESS.piHelp },
    ...statuses.map((status) => ({ value: status.id, label: status.label, help: status.path ? (status.version ? `v${status.version}` : HARNESS.installed) : HARNESS.missing })),
  ]
  if (!items.some((item) => item.value === value)) items.push({ value, label: value })
  return <Choice value={value} items={items} label={label} onChange={onChange} />
}

/** The harness's own models (current first, then older), the ones typed into its settings, and its default. */
function HarnessModelChoice({ value, models, label, onChange }: { value: string; models: HarnessModel[]; label: string; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState("")
  const known = value === "" || models.some((model) => model.id === value)
  const items: ChoiceItem[] = [
    { value: "", label: HARNESS.defaultModel, help: HARNESS.defaultModelHelp },
    ...models.map((model) => ({ value: model.id, label: model.label, help: model.custom ? CUSTOM_HELP : model.current ? model.id : `${model.id} · ${HARNESS.older}` })),
    ...(!known ? [{ value, label: value, help: CUSTOM_HELP }] : []),
    { value: CUSTOM_MODEL, label: CUSTOM_LABEL, help: CUSTOM_HELP },
  ]
  const choose = (next: string) => {
    if (next !== CUSTOM_MODEL) return onChange(next)
    setText(known ? "" : value)
    setTyping(true)
  }
  const use = () => {
    const next = text.trim()
    setTyping(false)
    if (next && next !== value) onChange(next)
  }
  return (
    <div className="flex flex-col gap-2">
      <Choice value={value} items={items} label={label} onChange={choose} />
      {typing ? (
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <Input autoFocus value={text} placeholder="model id" aria-label="Harness model id" className="min-w-0 flex-1" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); use() } }} />
          <ActionButton label="Use this model" icon={Check} tone="primary" onClick={use} />
        </div>
      ) : null}
    </div>
  )
}

/** The effort levels a harness model takes; an agent whose harness sets effort per session may try every level. */
function harnessLevels(status: HarnessStatus | undefined, model: string): readonly string[] {
  const found = status?.models.find((entry) => entry.id === model)
  if (found && found.efforts.length > 0) return found.efforts
  if (status?.effort === "session") return THINKING_LEVELS
  const efforts = status?.models.find((entry) => entry.efforts.length > 0)?.efforts
  return efforts && efforts.length > 0 ? efforts : THINKING_LEVELS
}

function AgentCard({ kind, config, models, harnesses, save, onGrants }: { kind: AgentKind; config: Config; models: SettingsModelInfo[]; harnesses: HarnessStatus[]; save: Save; onGrants: () => void }) {
  const entry = entryOf(config, kind)
  const set = (fields: Record<string, unknown>) => save(patchOf(kind, fields))
  const name = AGENT_LABELS[kind]
  const harness = entry.harness ? harnesses.find((status) => status.id === entry.harness) : undefined
  const onHarness = Boolean(entry.harness)
  const harnessModel = entry.harnessModel ?? ""
  const supported = onHarness ? harnessLevels(harness, harnessModel) : levelsFor(models, entry.model)
  const chooseHarness = (next: string) => {
    if (next === (entry.harness ?? PI_HARNESS)) return
    if (next === PI_HARNESS) return void set({ harness: PI_HARNESS })
    const levels = harnessLevels(harnesses.find((status) => status.id === next), "")
    const fields: Record<string, unknown> = { harness: next, harnessModel: "" }
    if (kind !== "scout" && !levels.includes(entry.thinking)) fields.thinking = levelOn(levels, entry.thinking)
    void set(fields)
  }
  const chooseHarnessModel = (model: string) => {
    const levels = harnessLevels(harness, model)
    const fields: Record<string, unknown> = { harnessModel: model }
    if (kind !== "scout" && !levels.includes(entry.thinking)) fields.thinking = levelOn(levels, entry.thinking)
    void set(fields)
  }
  // Changing the model carries the effort along to what the new model supports.
  const chooseModel = (model: string) => {
    const fields: Record<string, unknown> = { model }
    if (kind !== "scout" && !levelsFor(models, model).includes(entry.thinking)) fields.thinking = levelOn(levelsFor(models, model), entry.thinking)
    set(fields)
  }
  const hasInstructions = kind !== "scout" && kind !== "researcher"
  const [open, setOpen] = useState(false)
  const custom = customCount(entry, kind)
  return (
    <section data-slot="agent-row" className="glass flex min-w-0 flex-col gap-2.5 rounded-xl border px-3.5 pt-2.5 pb-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 break-words text-sm font-semibold"><span aria-hidden="true" className="cs-tile" style={{ "--ac": agentColor(kind) } as CSSProperties}>{name[0]}</span>{name}</h3>
        <MoreButton open={open} custom={custom} onToggle={() => setOpen((now) => !now)} />
      </div>
      {/* Every card keeps the same rows, so the cards line up: a fixed setting shows as a still row in its place. */}
      {HARNESS_AGENTS.has(kind) ? <HarnessChoice value={entry.harness ?? PI_HARNESS} statuses={harnesses} label={`${name} ${HARNESS.label.toLowerCase()}`} onChange={chooseHarness} /> : <FixedRow value={HARNESS.piLabel} note={`always ${HARNESS.piLabel}`} label={`${name} ${HARNESS.label.toLowerCase()}`} />}
      {onHarness ? (
        <HarnessModelChoice value={harnessModel} models={harness?.models ?? []} label={`${name} model`} onChange={chooseHarnessModel} />
      ) : (
        <ModelChoice value={entry.model} models={models} label={`${name} model`} inherit={kind === "master"} onChange={chooseModel} />
      )}
      {kind === "scout" ? <ScoutEffort /> : (
        <EffortChoice value={entry.thinking} levels={THINKING_LEVELS} supported={supported} recommended={RECOMMENDED_THINKING[kind]}
          model={onHarness ? (harnessModel || `${harness?.label ?? entry.harness}'s default model`) : entry.model === INHERIT_MODEL ? "the session model" : entry.model} label={`${name} effort`} onChange={(level) => set({ thinking: level })} />
      )}
      {onHarness && harness?.effort === "session" && kind !== "scout" ? <p className="-mt-1 text-xs text-muted-foreground">{HARNESS.effortNote}</p> : null}
      <div className="mt-auto grid gap-2.5">
      <ToggleField
        label="Auto-compact"
        help={kind === "master" ? "Compacts the oracle's context as it fills, and files what it learned into the knowledge base, shared with the agents it concerns." : onHarness ? (harness?.protocol === "acp" ? `${harness.label} compacts on its own; this switch applies to pi, Codex and Claude Code.` : `Lets ${harness?.label ?? "the harness"} compact this agent's context, at the threshold under Harnesses.`) : "Compacts this agent's context as it fills."}
        checked={entry.autoCompact !== false}
        onChange={(on) => set({ autoCompact: on })}
        name={`${name} auto-compact`}
      />
      {entry.autoCompact !== false && !onHarness ? <CompactAtField value={entry.compactAt} label={`${name} compact at`} onSave={(tokens) => set({ compactAt: tokens })} /> : null}
      </div>
      <div hidden={!open} className="grid gap-2 border-t border-border pt-2">
        {onHarness ? <p className="break-words text-xs text-muted-foreground">{HARNESS.agentNote}</p> : null}
        {hasInstructions ? <InstructionsField value={entry.instructions ?? ""} label={`${name} instructions`} onSave={(text) => set({ instructions: text })} /> : null}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="min-w-[7rem] flex-1 break-words text-xs text-muted-foreground">{grantsLine(grantsOf(config, kind), kind)}</p>
          <ActionButton label={GRANTS.edit} icon={Wrench} onClick={onGrants} />
        </div>
      </div>
    </section>
  )
}

/** How many settings under More differ from their defaults, shown on the collapsed row. */
function customCount(entry: AgentView, kind: AgentKind): number {
  const notes = kind !== "scout" && kind !== "researcher" && Boolean(entry.instructions)
  return [notes, entry.mcpTools !== undefined, kind !== "master" && entry.skills !== undefined].filter(Boolean).length
}

function ScoutEffort() {
  return <FixedRow value={<><Brain aria-hidden="true" className="size-3.5" /><span className="capitalize">{FIXED_SCOUT_THINKING}</span></>} note="fixed for scouts" label="Scout effort" />
}

/** A setting that can't change here, drawn as a still row the size of a picker so the cards keep one shape. */
function FixedRow({ value, note, label }: { value: ReactNode; note: string; label: string }) {
  return (
    <div role="group" aria-label={`${label}: ${note}`} className="cs-fixrow">
      <span className="flex items-center gap-1.5">{value}</span>
      <span className="cs-fixnote">{note}</span>
    </div>
  )
}

function MoreButton({ open, custom, onToggle }: { open: boolean; custom: number; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle}
      className="-mr-1.5 flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <ChevronRight aria-hidden="true" className={cn("size-3.5 transition-transform duration-200 ease-snap", open && "rotate-90")} />
      More
      {custom > 0 ? <span className="text-primary">· {custom} customised</span> : null}
    </button>
  )
}

function lobbyToggle(config: Config, id: string): boolean {
  if (id.startsWith("panel:")) return config.lobby.panels[id.slice("panel:".length) as "conversation" | "activity" | "thinking"]
  return (config.lobby as unknown as Record<string, boolean>)[id]
}

function LobbyToggle({ config, item, save }: { config: Config; item: { id: string; label: string; help: string }; save: Save }) {
  const panel = item.id.startsWith("panel:")
  const toggle = (next: boolean) => {
    if (panel) void save({ lobby: { panels: { [item.id.slice("panel:".length)]: next } } })
    else void save({ lobby: { [item.id]: next } })
  }
  return <ToggleField label={item.label} help={item.help} checked={lobbyToggle(config, item.id)} onChange={toggle} />
}

function WorkflowGroup({ config, save }: { config: Config; save: Save }) {
  const current = config.workflow.gitIsolation
  return (
    <Section prominent title={GROUP_TITLES.workflow}>
      <Rows>
        <Field label={GIT_LABEL} help={GIT_ISOLATION_ITEMS.find((item) => item.id === current)?.help ?? "enter cycles off, branch, worktree"}>
          <Choice value={current} items={GIT_ISOLATION_ITEMS.map((item) => ({ value: item.id, label: item.label }))} label={GIT_LABEL} onChange={(value) => void save({ workflow: { gitIsolation: value } })} />
        </Field>
      </Rows>
    </Section>
  )
}

/** Where a found linter's config sits, as the page says it. */
const folderLabel = (folder: string): string => (folder ? `${folder}/` : LINT.top)

/** Extensions as typed (`.ts tsx, *.py`) into the list the config keeps. */
function extensionList(text: string): string[] {
  return text.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean)
}

function FoundLinters({ replaced }: { replaced: boolean }) {
  const read = useApiRead("settings.linters", {}, [])
  const linters = read.data?.linters
  return (
    <Field label={LINT.found} help={replaced ? LINT.foundReplaced : LINT.foundHelp}>
      {!linters ? (
        <p className="break-words text-sm text-muted-foreground text-right">{read.error ? read.error : "Looking…"}</p>
      ) : linters.length === 0 ? (
        <p className="break-words text-sm text-muted-foreground text-right">{LINT.foundNone}</p>
      ) : (
        <ul aria-label={LINT.found} className={cn("flex flex-col items-end gap-1.5", replaced && "opacity-60")}>
          {linters.map((linter) => (
            <li key={`${linter.tool}:${linter.folder}`} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 break-words font-medium">{linter.tool}</span>
              <span className="min-w-0 break-words text-xs text-muted-foreground">{folderLabel(linter.folder)}</span>
              <span
                title={linter.installed ? undefined : LINT.missingHelp}
                className={cn("inline-flex shrink-0 items-center gap-1 text-xs", linter.installed ? "text-success" : "text-warning")}
              >
                {linter.installed ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleAlert aria-hidden="true" className="size-3.5" />}
                {linter.installed ? LINT.installed : LINT.missing}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Field>
  )
}

function LintGroup({ config, save }: { config: Config; save: Save }) {
  const lint = config.lint
  const off = lint.mode === "off"
  const custom = lint.command.trim().length > 0
  return (
    <Section prominent title={GROUP_TITLES.lint}>
      <p className="max-w-3xl text-sm text-muted-foreground">{LINT.intro}</p>
      <Rows>
        <Field label={LINT.mode} help={LINT_MODE_ITEMS.find((item) => item.id === lint.mode)?.help}>
          <Choice value={lint.mode} items={LINT_MODE_ITEMS.map((item) => ({ value: item.id, label: item.label }))} label={LINT.mode} onChange={(value) => void save({ lint: { mode: value } })} />
        </Field>
        <div className={cn("flex flex-col divide-y divide-border [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0", off && "opacity-60")} aria-disabled={off || undefined}>
          <Field label={LINT.command} help={LINT.commandHelp}>
            <TextValue value={lint.command} label={LINT.command} placeholder={LINT.commandPlaceholder} onSave={(value) => void save({ lint: { command: value } })} />
          </Field>
          {custom ? (
            <Field label={LINT.extensions} help={LINT.extensionsHelp}>
              <TextValue value={lint.extensions.join(" ")} label={LINT.extensions} placeholder={LINT.extensionsPlaceholder} onSave={(value) => void save({ lint: { extensions: extensionList(value) } })} />
            </Field>
          ) : null}
          <Field label={LINT.timeout} help={LINT.timeoutHelp}>
            <MinutesField value={lint.timeoutMs} label={`Lint ${LINT.timeout.toLowerCase()}`} onSave={(ms) => void save({ lint: { timeoutMs: ms } })} />
          </Field>
          <FoundLinters replaced={custom} />
        </div>
      </Rows>
    </Section>
  )
}

function LobbyGroup({ config, save }: { config: Config; save: Save }) {
  const web = config.lobby.web
  return (
    <Section prominent title={GROUP_TITLES.lobby}>
      <Rows>
        {LOBBY_TOGGLES.map((item) => <LobbyToggle key={item.id} config={config} item={item} save={save} />)}
        <Field label={ROUNDS_LABEL} help={ROUNDS_HELP}>
          <Choice value={String(config.lobby.maxPlanningRounds)} items={ROUND_CHOICES.map((value) => ({ value: String(value), label: roundLabel(value) }))} label={ROUNDS_LABEL} onChange={(value) => void save({ lobby: { maxPlanningRounds: Number(value) } })} />
        </Field>
        <Field label={WEB_PORT_LABEL} help={WEB_PORT_HELP}>
          <PortField value={web.port} onSave={(port) => void save({ lobby: { web: { port } } })} />
        </Field>
        <ToggleField label={WEB_BROWSER_LABEL} help={WEB_BROWSER_HELP} checked={web.openBrowser} onChange={(next) => void save({ lobby: { web: { openBrowser: next } } })} />
        <RetentionToggle />
      </Rows>
    </Section>
  )
}

/**
 * Whether this repository tracks `.pi/bot-lobby` in git, read from the repository's own .gitignore: the switch
 * rewrites that file and reads its state back from it, so a hand-edited file still shows what git does.
 */
function RetentionToggle() {
  const read = useApiRead("lobby.retention", {}, [])
  const set = async (enabled: boolean) => {
    try {
      await call("lobby.setRetention", { enabled })
      read.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work. Try again.")
    }
  }
  return (
    <ToggleField
      label={RETAIN.label}
      help={read.error ? RETAIN.error : RETAIN.help}
      checked={read.data?.enabled ?? false}
      onChange={(next) => void set(next)}
    />
  )
}

/** The provider half of a `provider/id` reference; empty for one without a slash. */
function providerOf(ref: string): string {
  const slash = ref.indexOf("/")
  return slash > 0 ? ref.slice(0, slash) : ""
}

interface EngineOption {
  id: string
  label: string
  kind: "classifier" | "chat"
}

/** Every model the classifier can use, classifier models first, without repeats. */
function engineOptions(models: SettingsModelInfo[], classifiers: SettingsClassifierModel[]): EngineOption[] {
  const seen = new Set<string>()
  const out: EngineOption[] = []
  for (const model of classifiers) if (!seen.has(model.id)) { seen.add(model.id); out.push({ id: model.id, label: model.label, kind: "classifier" }) }
  for (const model of models) if (!seen.has(model.id)) { seen.add(model.id); out.push({ id: model.id, label: model.label, kind: "chat" }) }
  return out
}

/**
 * Who answers the classifier's questions, in two steps: the provider (Jev on a
 * host, or any provider your pi logins offer), then that provider's model,
 * classifier models first. A model pi does not list can be typed as `provider/id`.
 */
function EngineChoice({ value, models, classifiers, onChange }: { value: string; models: SettingsModelInfo[]; classifiers: SettingsClassifierModel[]; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState("")
  const options = engineOptions(models, classifiers)
  const current = providerOf(value)
  const [picked, setPicked] = useState(current)
  const provider = value ? current : picked
  const providers = [...new Set([...options.map((option) => providerOf(option.id)), ...(current ? [current] : [])])].filter(Boolean).sort()
  const providerItems: ChoiceItem[] = [
    { value: JEV_PROVIDER, label: CLASSIFIER_LABELS.engineJev, help: CLASSIFIER_LABELS.engineJevHelp },
    ...providers.map((name) => {
      const own = options.filter((option) => providerOf(option.id) === name)
      const scorers = own.filter((option) => option.kind === "classifier").length
      const chats = own.length - scorers
      const help = [scorers ? `${scorers} ${CLASSIFIER_LABELS.engineClassifier}${scorers === 1 ? "" : "s"}` : "", chats ? `${chats} chat model${chats === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ")
      return { value: name, label: name, ...(help ? { help } : {}) }
    }),
  ]
  const own = options.filter((option) => providerOf(option.id) === provider)
  const modelItems: ChoiceItem[] = [
    ...own.map((option) => ({ value: option.id, label: option.id.slice(provider.length + 1), help: `${option.kind === "classifier" ? CLASSIFIER_LABELS.engineClassifier : CLASSIFIER_LABELS.engineChat}${option.label && option.label !== option.id ? ` · ${option.label}` : ""}` })),
    ...(value && !own.some((option) => option.id === value) ? [{ value, label: value.slice(provider.length + 1) || value, help: CUSTOM_HELP }] : []),
    { value: CUSTOM_MODEL, label: CUSTOM_LABEL, help: CUSTOM_HELP },
  ]
  const chooseProvider = (next: string) => {
    setTyping(false)
    if (next === JEV_PROVIDER) { setPicked(""); return onChange("") }
    setPicked(next)
    // A provider is used through one of its models: the first classifier model, else its first chat model.
    const first = options.find((option) => providerOf(option.id) === next && option.kind === "classifier") ?? options.find((option) => providerOf(option.id) === next)
    if (first) onChange(first.id)
  }
  const chooseModel = (next: string) => {
    if (next !== CUSTOM_MODEL) return onChange(next)
    setText(value && !own.some((option) => option.id === value) ? value : `${provider}/`)
    setTyping(true)
  }
  const use = () => {
    const next = text.trim()
    setTyping(false)
    if (next && next !== value) onChange(next)
  }
  return (
    <div className="flex flex-col gap-2">
      <Choice value={provider || JEV_PROVIDER} items={providerItems} label={CLASSIFIER_LABELS.provider} onChange={chooseProvider} />
      {provider ? <Choice value={value || CUSTOM_MODEL} items={modelItems} label={CLASSIFIER_LABELS.engineModel} onChange={chooseModel} /> : null}
      {typing ? (
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <Input autoFocus value={text} placeholder="provider/model" aria-label="Classifier model id" className="min-w-0 flex-1" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); use() } }} />
          <ActionButton label="Use this model" icon={Check} tone="primary" onClick={use} />
        </div>
      ) : null}
    </div>
  )
}

/** The provider picker's value for Jev on a host (the empty engine). */
const JEV_PROVIDER = "__jev__"

function ClassifierGroup({ config, models, classifiers, save }: { config: Config; models: SettingsModelInfo[]; classifiers: SettingsClassifierModel[]; save: Save }) {
  const classifier = config.classifier
  const host = JEV_HOST_ITEMS.find((item) => item.id === classifier.provider)?.label
  const jev = !classifier.engine
  return (
    <Section prominent title={GROUP_TITLES.classifier}>
      <Rows>
        <ToggleField label={CLASSIFIER_LABELS.enabled} help={CLASSIFIER_LABELS.enabledHelp} checked={classifier.enabled} onChange={(next) => void save({ classifier: { enabled: next } })} />
        <Field label={CLASSIFIER_LABELS.engine} help={CLASSIFIER_LABELS.engineHelp}>
          <EngineChoice value={classifier.engine} models={models} classifiers={classifiers} onChange={(value) => void save({ classifier: { engine: value } })} />
        </Field>
        {jev ? (
          <>
            <Field label={CLASSIFIER_LABELS.host}>
              <Choice value={classifier.provider} items={JEV_HOST_ITEMS.map((item) => ({ value: item.id, label: item.label }))} label={CLASSIFIER_LABELS.host} onChange={(value) => void save({ classifier: { provider: value } })} />
            </Field>
            <Field label={CLASSIFIER_LABELS.model} help={CLASSIFIER_LABELS.modelHelp}>
              <TextValue value={classifier.model} label={CLASSIFIER_LABELS.model} placeholder="the host's default" onSave={(value) => void save({ classifier: { model: value } })} />
            </Field>
            <Field label={CLASSIFIER_LABELS.key} help={CLASSIFIER_LABELS.keyNote}>
              <p className="break-words text-sm text-muted-foreground text-right">{host ?? classifier.provider}</p>
            </Field>
          </>
        ) : null}
        {CLASSIFIER_FEATURE_ITEMS.map((feature) => (
          <ToggleField key={feature.id} label={feature.label} help={feature.help} checked={classifier.features[feature.id]} onChange={(next) => void save({ classifier: { features: { [feature.id]: next } } })} />
        ))}
        <Field label={CLASSIFIER_LABELS.cheap} help={CLASSIFIER_LABELS.cheapHelp}>
          <ModelChoice value={classifier.effort.cheapModel} models={models} label={CLASSIFIER_LABELS.cheap} none onChange={(value) => void save({ classifier: { effort: { cheapModel: value } } })} />
        </Field>
      </Rows>
    </Section>
  )
}

function NotificationsGroup() {
  const enabled = useNotificationsEnabled()
  const change = async (next: boolean) => {
    if (!next) return disableNotifications()
    const result = await enableNotifications()
    if (result === "granted") toast.success(PAGE.notificationsOn)
    else toast.error(result === "unsupported" ? PAGE.notificationsUnsupported : PAGE.notificationsBlocked)
  }
  return (
    <Section prominent title={GROUP_TITLES.notifications}>
      <Rows>
        <ToggleField label={PAGE.notificationsLabel} help={PAGE.notificationsHelp} checked={enabled} onChange={(next) => void change(next)} />
      </Rows>
    </Section>
  )
}

function InstallGroup() {
  const { available, install } = useInstallPrompt()
  const installed = useInstalled()
  const fullscreen = useFullscreen()
  return (
    <Section prominent title={GROUP_TITLES.install}>
      <Rows>
        <Field label={PAGE.installLabel} help={installed ? PAGE.installedNow : PAGE.installHelp}>
          {installed ? null : (
            <div className="flex justify-end">
            <ActionButton
              label={PAGE.installButton}
              icon={Download}
              tone="primary"
              onClick={() => (available ? void install().then(() => toast.success(PAGE.installDone)) : toast.warning(PAGE.installUnavailable))}
            />
            </div>
          )}
        </Field>
        {fullscreen.supported ? (
          <Field label={PAGE.fullscreenLabel} help={PAGE.fullscreenHelp}>
            <div className="flex justify-end">
              <ActionButton label={fullscreen.on ? PAGE.fullscreenOn : PAGE.fullscreenOff} icon={fullscreen.on ? Minimize : Maximize} pressed={fullscreen.on} onClick={() => void fullscreen.toggle()} />
            </div>
          </Field>
        ) : null}
      </Rows>
    </Section>
  )
}

const SECTIONS = ["Agents", "Harnesses", "Tools & skills", "Workflow", "Lobby", "Classifier", "Appearance & notifications"] as const
type SectionName = (typeof SECTIONS)[number]
const sectionId = (name: SectionName) => `settings-${name.split(" ")[0]}`

export function SettingsForm({ config, models, classifierModels = [], onConfig }: { config: Config; models: SettingsModelInfo[]; classifierModels?: SettingsClassifierModel[]; onConfig: (config: Config) => void }) {
  const [section, setSection] = useState<SectionName>("Agents")
  const [grantee, setGrantee] = useState<AgentKind>("master")
  const openGrants = (kind: AgentKind) => {
    setGrantee(kind)
    setSection("Tools & skills")
  }
  const harnessRead = useApiRead("settings.harnesses", {}, [])
  // Extra models and commands change what the harnesses offer: read them again after a change.
  const harnessKey = JSON.stringify(config.harnesses)
  const reloadHarnesses = harnessRead.reload
  const seenKey = useRef(harnessKey)
  useEffect(() => {
    if (seenKey.current === harnessKey) return
    seenKey.current = harnessKey
    reloadHarnesses()
  }, [harnessKey, reloadHarnesses])
  const harnesses = harnessRead.data?.harnesses ?? []
  // One save at a time, in the order they were made: the form shows the config of the last reply, so replies must come back in order.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const save: Save = (patch) => {
    const run = async () => {
      try {
        const result = await call("settings.set", { patch })
        onConfig(result.config)
        toast.success(PAGE.saved)
        return true
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That did not work. Try again.")
        return false
      }
    }
    const next = queue.current.then(run, run)
    queue.current = next
    return next
  }
  return (
    <div className="cs-pg cs-set flex flex-col pb-dock">
      <header className="cs-pgh">
        <div className="min-w-0">
          <h1 className="cs-hd1">{PAGE.title}</h1>
          <p className="cs-hd2">{PAGE.intro}</p>
        </div>
      </header>
      <nav aria-label="Settings sections" className="cs-secn">
        <Segmented as="nav" size="md" label="Settings sections" items={SECTIONS.map((name) => ({ id: name, label: name, controls: sectionId(name) }))} value={section} onChange={setSection} />
      </nav>
      <div id={sectionId("Agents")} hidden={section !== "Agents"} aria-hidden={section !== "Agents"}>
        <h2 className="sr-only">{GROUP_TITLES.agents}</h2>
        <div className="cs-agrid grid grid-cols-2 gap-3.5 lg:grid-cols-3">
          {AGENT_ORDER.map((kind) => <AgentCard key={kind} kind={kind} config={config} models={models} harnesses={harnesses} save={save} onGrants={() => openGrants(kind)} />)}
        </div>
      </div>
      <div id={sectionId("Harnesses")} hidden={section !== "Harnesses"} aria-hidden={section !== "Harnesses"}>
        <HarnessesGroup config={config} statuses={harnessRead.data?.harnesses} {...(harnessRead.error ? { error: harnessRead.error } : {})} save={save} />
      </div>
      <div id={sectionId("Tools & skills")} hidden={section !== "Tools & skills"} aria-hidden={section !== "Tools & skills"}>
        <GrantsGroup config={config} save={save} agent={grantee} onAgent={setGrantee} />
      </div>
      <div id={sectionId("Workflow")} hidden={section !== "Workflow"} aria-hidden={section !== "Workflow"}>
        <div className="flex flex-col gap-6"><WorkflowGroup config={config} save={save} /><LintGroup config={config} save={save} /></div>
      </div>
      <div id={sectionId("Lobby")} hidden={section !== "Lobby"} aria-hidden={section !== "Lobby"}><LobbyGroup config={config} save={save} /></div>
      <div id={sectionId("Classifier")} hidden={section !== "Classifier"} aria-hidden={section !== "Classifier"}><ClassifierGroup config={config} models={models} classifiers={classifierModels} save={save} /></div>
      <div id={sectionId("Appearance & notifications")} hidden={section !== "Appearance & notifications"} aria-hidden={section !== "Appearance & notifications"}>
        <div className="flex flex-col gap-6"><ThemeGroup /><NotificationsGroup /><InstallGroup /></div>
      </div>
    </div>
  )
}
