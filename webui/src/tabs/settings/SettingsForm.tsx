/**
 * The settings form: each agent's model and effort (a slider with a stop per
 * level, skipping what the model cannot do), the workflow, the lobby and the
 * classifier, read from `settings.get` and saved back with a minimal
 * `settings.set` patch. A refused patch (`bad_request`) shows the server's own
 * message and leaves the field reading its saved value, because every control
 * is driven by the config the server last returned. The appearance,
 * notification and install rows are page-only and never sent to the server.
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, ChevronRight, Download, Maximize, Minimize } from "lucide-react"
import { toast } from "@/lib/toast"
import { useFullscreen, useInstallPrompt, useInstalled } from "@/app/install"
import { disableNotifications, enableNotifications, useNotificationsEnabled } from "@/app/notify"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ActionButton } from "@/ui/Actions"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EffortMascot } from "@/ui/EffortMascot"
import { EffortSlider, nearestSupported } from "@/ui/EffortSlider"
import { call } from "@/lib/api"
import { Section } from "@/ui/Section"
import { Choice, Field, Rows, type ChoiceItem } from "./parts"
import { ThemeGroup } from "./ThemeGroup"
import type { BotLobbyConfig, SettingsModelInfo } from "@protocol"
import {
  AGENT_LABELS,
  AGENT_ORDER,
  CLASSIFIER_FEATURE_ITEMS,
  CLASSIFIER_LABELS,
  CUSTOM_HELP,
  CUSTOM_LABEL,
  CUSTOM_MODEL,
  FIELD_LABELS,
  FIXED_SCOUT_THINKING,
  GIT_ISOLATION_ITEMS,
  GIT_LABEL,
  GROUP_TITLES,
  INHERIT_HELP,
  INHERIT_LABEL,
  INHERIT_MODEL,
  JEV_HOST_ITEMS,
  LOBBY_SWITCH_ITEMS,
  PAGE,
  PANEL_HELP,
  PANEL_ITEMS,
  ROUNDS_HELP,
  ROUNDS_LABEL,
  ROUND_CHOICES,
  SPLIT_CHOICES,
  SPLIT_HELP,
  SPLIT_LABEL,
  THINKING_LEVELS,
  WEB_BROWSER_HELP,
  WEB_BROWSER_LABEL,
  WEB_PORT_HELP,
  WEB_PORT_LABEL,
  type AgentKind,
} from "./words"

type Config = BotLobbyConfig
type Save = (patch: Record<string, unknown>) => Promise<boolean>

interface AgentView {
  model: string
  thinking: string
  timeoutMs?: number
  instructions?: string
}

/** Where each agent's fields live in the config (`agents.<kind>` for the three domains). */
const AGENT_PATH: Record<AgentKind, string[]> = {
  master: ["master"],
  designer: ["agents", "designer"],
  backend: ["agents", "backend"],
  qa: ["agents", "qa"],
  scout: ["scout"],
  researcher: ["researcher"],
  quickfix: ["quickFix"],
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
        timeoutMs: config.scout.timeoutMs,
      }
    case "researcher":
      return config.researcher
    case "quickfix":
      return config.quickFix
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
const splitLabel = (value: number): string => (value > 0 ? `over ${value} steps` : "never")

/** A small label above a control, for the dense grids inside an agent's card. */
function Mini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

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
        <div className="flex gap-2">
          <Input autoFocus value={text} placeholder="provider/model" aria-label="Model id" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); use() } }} />
          <ActionButton label="Use this model" icon={Check} tone="primary" onClick={use} />
        </div>
      ) : null}
    </div>
  )
}

function ToggleField({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[0.8125rem] font-medium">{label}</div>
        {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
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

function NumberField({ label, value, min, max, suffix, onSave }: { label: string; value: string; min: number; max?: number; suffix?: string; onSave: (text: string) => boolean }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    if (text === value) return
    if (!onSave(text.trim())) setText(value)
  }
  return (
    <div className="relative">
      <Input type="number" inputMode="numeric" min={min} max={max} value={text} aria-label={label} className={suffix ? "pr-10" : undefined} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
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

function AgentCard({ kind, config, models, save }: { kind: AgentKind; config: Config; models: SettingsModelInfo[]; save: Save }) {
  const entry = entryOf(config, kind)
  const set = (fields: Record<string, unknown>) => save(patchOf(kind, fields))
  const name = AGENT_LABELS[kind]
  const supported = levelsFor(models, entry.model)
  // Changing the model carries the effort along to what the new model supports.
  const chooseModel = (model: string) => {
    const fields: Record<string, unknown> = { model }
    if (kind !== "scout" && !levelsFor(models, model).includes(entry.thinking)) fields.thinking = levelOn(levelsFor(models, model), entry.thinking)
    set(fields)
  }
  // The mascot acts out what the model really runs at (an unsupported level is clamped).
  const effective = kind === "scout" ? FIXED_SCOUT_THINKING : levelOn(supported, entry.thinking)
  const hasInstructions = kind !== "scout" && kind !== "researcher"
  const [showNotes, setShowNotes] = useState(Boolean(entry.instructions))
  return (
    <section className="glass flex min-w-0 flex-col gap-3 rounded-xl p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{name}</h3>
        <span className="truncate text-xs text-muted-foreground">
          {entry.model === INHERIT_MODEL ? "session model" : entry.model} · {kind === "scout" ? FIXED_SCOUT_THINKING : entry.thinking}
        </span>
      </header>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <Mini label={FIELD_LABELS.model}>
          <ModelChoice value={entry.model} models={models} label={`${name} model`} inherit={kind === "master"} onChange={chooseModel} />
        </Mini>
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
        <EffortMascot level={effective} className="size-16" />
        <div className="min-w-0 flex-1">
          {kind === "scout" ? (
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">{FIELD_LABELS.thinking}</span>
              <p className="text-sm text-muted-foreground">{FIXED_SCOUT_THINKING} (fixed for scouts)</p>
            </div>
          ) : (
            <EffortSlider
              value={entry.thinking}
              levels={THINKING_LEVELS}
              supported={supported}
              model={entry.model === INHERIT_MODEL ? "the session model" : entry.model}
              label={`${name} effort`}
              onChange={(level) => set({ thinking: level })}
            />
          )}
        </div>
      </div>
      <div className="flex min-h-7 items-center justify-between gap-3">
        {hasInstructions ? (
          <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
            type="button"
            aria-expanded={showNotes}
            onClick={() => setShowNotes((now) => !now)}
            className="flex min-h-10 items-center gap-1 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <ChevronRight aria-hidden="true" className={cn("size-3.5 transition-transform duration-200 ease-snap", showNotes && "rotate-90")} />
            {FIELD_LABELS.instructions}
            {!showNotes && entry.instructions ? <span className="text-primary">· set</span> : null}
          </button>
        ) : (
          <span />
        )}
        {kind !== "master" ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Time limit</span>
            <div className="w-24">
              <MinutesField value={entry.timeoutMs ?? config.workflow.agentTimeoutMs} label={`${name} time limit`} onSave={(ms) => set({ timeoutMs: ms })} />
            </div>
          </div>
        ) : null}
      </div>
      {hasInstructions && showNotes ? <InstructionsField value={entry.instructions ?? ""} label={`${name} instructions`} onSave={(text) => set({ instructions: text })} /> : null}
    </section>
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

function LobbyGroup({ config, save }: { config: Config; save: Save }) {
  const web = config.lobby.web
  return (
    <Section prominent title={GROUP_TITLES.lobby}>
      <Rows>
        {LOBBY_TOGGLES.map((item) => <LobbyToggle key={item.id} config={config} item={item} save={save} />)}
        <Field label={ROUNDS_LABEL} help={ROUNDS_HELP}>
          <Choice value={String(config.lobby.maxPlanningRounds)} items={ROUND_CHOICES.map((value) => ({ value: String(value), label: roundLabel(value) }))} label={ROUNDS_LABEL} onChange={(value) => void save({ lobby: { maxPlanningRounds: Number(value) } })} />
        </Field>
        <Field label={SPLIT_LABEL} help={SPLIT_HELP}>
          <Choice value={String(config.lobby.splitPlanAbove)} items={SPLIT_CHOICES.map((value) => ({ value: String(value), label: splitLabel(value) }))} label={SPLIT_LABEL} onChange={(value) => void save({ lobby: { splitPlanAbove: Number(value) } })} />
        </Field>
        <Field label={WEB_PORT_LABEL} help={WEB_PORT_HELP}>
          <PortField value={web.port} onSave={(port) => void save({ lobby: { web: { port } } })} />
        </Field>
        <ToggleField label={WEB_BROWSER_LABEL} help={WEB_BROWSER_HELP} checked={web.openBrowser} onChange={(next) => void save({ lobby: { web: { openBrowser: next } } })} />
      </Rows>
    </Section>
  )
}

function ClassifierGroup({ config, models, save }: { config: Config; models: SettingsModelInfo[]; save: Save }) {
  const classifier = config.classifier
  const host = JEV_HOST_ITEMS.find((item) => item.id === classifier.provider)?.label
  return (
    <Section prominent title={GROUP_TITLES.classifier}>
      <Rows>
        <ToggleField label={CLASSIFIER_LABELS.enabled} help={CLASSIFIER_LABELS.enabledHelp} checked={classifier.enabled} onChange={(next) => void save({ classifier: { enabled: next } })} />
        <Field label={CLASSIFIER_LABELS.host}>
          <Choice value={classifier.provider} items={JEV_HOST_ITEMS.map((item) => ({ value: item.id, label: item.label }))} label={CLASSIFIER_LABELS.host} onChange={(value) => void save({ classifier: { provider: value } })} />
        </Field>
        <Field label={CLASSIFIER_LABELS.model} help={CLASSIFIER_LABELS.modelHelp}>
          <TextValue value={classifier.model} label={CLASSIFIER_LABELS.model} placeholder="the host's default" onSave={(value) => void save({ classifier: { model: value } })} />
        </Field>
        <Field label={CLASSIFIER_LABELS.key} help={CLASSIFIER_LABELS.keyNote}>
          <p className="text-sm text-muted-foreground sm:text-right">{host ?? classifier.provider}</p>
        </Field>
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
            <div className="flex sm:justify-end">
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
            <div className="flex sm:justify-end">
              <ActionButton label={fullscreen.on ? PAGE.fullscreenOn : PAGE.fullscreenOff} icon={fullscreen.on ? Minimize : Maximize} pressed={fullscreen.on} onClick={() => void fullscreen.toggle()} />
            </div>
          </Field>
        ) : null}
      </Rows>
    </Section>
  )
}

const SECTIONS = ["Agents", "Workflow", "Lobby", "Classifier", "Appearance & notifications"]

export function SettingsForm({ config, models, onConfig }: { config: Config; models: SettingsModelInfo[]; onConfig: (config: Config) => void }) {
  const [section, setSection] = useState("Agents")
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 pt-5 pb-dock sm:px-8 sm:pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{PAGE.title}</h1>
        <p className="text-sm text-muted-foreground">{PAGE.intro}</p>
      </header>
      <nav aria-label="Settings sections" className="-mx-1 flex flex-wrap gap-1 border-b border-border pb-3">
        {SECTIONS.map((name) => (
          <button
            key={name}
            type="button"
            aria-keyshortcuts="Enter Space"
            aria-describedby="focused-action-help"
            aria-current={section === name ? "page" : undefined}
            aria-controls={`settings-${name.split(" ")[0]}`}
            onClick={() => setSection(name)}
            className={cn(
              "h-10 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
              section === name ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {name}
          </button>
        ))}
      </nav>
      <div id="settings-Agents" hidden={section !== "Agents"} aria-hidden={section !== "Agents"}>
        <Section prominent title={GROUP_TITLES.agents}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {AGENT_ORDER.map((kind) => <AgentCard key={kind} kind={kind} config={config} models={models} save={save} />)}
          </div>
        </Section>
      </div>
      <div id="settings-Workflow" hidden={section !== "Workflow"} aria-hidden={section !== "Workflow"}><WorkflowGroup config={config} save={save} /></div>
      <div id="settings-Lobby" hidden={section !== "Lobby"} aria-hidden={section !== "Lobby"}><LobbyGroup config={config} save={save} /></div>
      <div id="settings-Classifier" hidden={section !== "Classifier"} aria-hidden={section !== "Classifier"}><ClassifierGroup config={config} models={models} save={save} /></div>
      <div id="settings-Appearance" hidden={section !== "Appearance & notifications"} aria-hidden={section !== "Appearance & notifications"}>
        <div className="flex flex-col gap-8"><ThemeGroup /><NotificationsGroup /><InstallGroup /></div>
      </div>
    </div>
  )
}
