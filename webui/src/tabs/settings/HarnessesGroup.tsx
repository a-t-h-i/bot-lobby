/**
 * The Harnesses section: one card per third-party coding agent a subagent can
 * run on (Codex CLI, Claude Code, Antigravity, Gemini CLI, OpenCode, a custom
 * ACP agent), with whether it is installed, which agents use it, and its own
 * settings: the command, launch arguments, home folder, model provider,
 * compaction threshold, whether Bot Lobby's prompts go in, and extra models.
 *
 * The fields are T3 Code's provider settings (`apps/web/src/components/settings/ProviderInstanceCard.tsx`,
 * `packages/contracts/src/settings.ts`), laid out as our own flat cards.
 */
import { useEffect, useState } from "react"
import { CircleAlert, CircleCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Section } from "@/ui/Section"
import type { BotLobbyConfig, HarnessStatus } from "@protocol"
import { Choice, Field } from "./parts"
import { AGENT_LABELS, GROUP_TITLES, HARNESS, HARNESS_AGENTS, type AgentKind } from "./words"

type Config = BotLobbyConfig
type Save = (patch: Record<string, unknown>) => Promise<boolean>
type HarnessId = keyof Config["harnesses"]

/** Which agents run on each harness. */
export function harnessUsers(config: Config): Record<string, AgentKind[]> {
  const entries: Array<[AgentKind, { harness?: string }]> = [
    ["master", config.master],
    ["planner", config.planner],
    ["designer", config.agents.designer],
    ["backend", config.agents.backend],
    ["qa", config.agents.qa],
    ["scout", config.scout],
    ["researcher", config.researcher],
    ["quickfix", config.quickFix],
  ]
  const users: Record<string, AgentKind[]> = {}
  for (const [kind, entry] of entries) if (entry.harness && HARNESS_AGENTS.has(kind)) (users[entry.harness] ??= []).push(kind)
  return users
}

function TextSetting({ value, label, placeholder, onSave }: { value: string; label: string; placeholder?: string; onSave: (value: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    const next = text.trim()
    if (next !== value) onSave(next)
  }
  return <Input value={text} placeholder={placeholder} aria-label={label} spellCheck={false} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
}

/** A token count in a number box; empty means the harness's own threshold. */
function CompactSetting({ value, label, onSave }: { value: number; label: string; onSave: (value: number) => void }) {
  const shown = value > 0 ? String(value) : ""
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const commit = () => {
    const raw = text.trim().replace(/[,_\s]/g, "")
    if (raw === shown) return
    if (raw === "") return onSave(0)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 10_000 || parsed > 2_000_000) {
      toast.error(`"${text}" is not between 10,000 and 2,000,000 tokens.`)
      setText(shown)
      return
    }
    onSave(Math.round(parsed))
  }
  return (
    <div className="relative">
      <Input type="number" inputMode="numeric" min={10_000} max={2_000_000} step={10_000} value={text} placeholder="harness default" aria-label={label} className="pr-14"
        onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">tokens</span>
    </div>
  )
}

function StatusBadge({ status }: { status: HarnessStatus }) {
  const found = Boolean(status.path)
  return (
    <span title={status.path ?? `${status.command || "No command"} is not on PATH`}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", found ? "bg-success/8 text-success dark:bg-success/16" : "bg-warning/8 text-warning dark:bg-warning/16")}>
      {found ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleAlert aria-hidden="true" className="size-3.5" />}
      {found ? `${HARNESS.installed}${status.version ? ` · ${status.version}` : ""}` : HARNESS.notFound}
    </span>
  )
}

function HarnessCard({ status, config, users, save }: { status: HarnessStatus; config: Config; users: AgentKind[]; save: Save }) {
  const id = status.id as HarnessId
  const settings = config.harnesses[id]
  const set = (fields: Record<string, unknown>) => void save({ harnesses: { [id]: fields } })
  const acp = status.protocol === "acp"
  const homeEnv = id === "codex" ? "CODEX_HOME" : id === "claude" ? "CLAUDE_CONFIG_DIR" : undefined
  const providers = status.providers.some((item) => item.value === settings.modelProvider) || !settings.modelProvider
    ? status.providers
    : [...status.providers, { value: settings.modelProvider, label: settings.modelProvider }]
  return (
    <section data-slot="harness-card" aria-label={status.label} className="glass flex min-w-0 flex-col gap-3 rounded-xl border px-3.5 pt-3 pb-3.5">
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h3 className="min-w-0 break-words text-sm font-semibold">{status.label}</h3>
          <StatusBadge status={status} />
        </div>
        <p className="break-words text-xs text-muted-foreground">{status.blurb}</p>
        <p className="break-words text-xs">
          <span className="text-muted-foreground">{HARNESS.usedBy}: </span>
          {users.length > 0 ? users.map((kind) => AGENT_LABELS[kind]).join(", ") : <span className="text-muted-foreground">{HARNESS.unused.toLowerCase()}</span>}
        </p>
      </header>
      <div className="flex flex-col divide-y divide-border border-t border-border [&>*]:py-2.5 [&>*:last-child]:pb-0">
        <Field stacked label={HARNESS.binary} help={HARNESS.binaryHelp}>
          <TextSetting value={settings.binaryPath} label={`${status.label} ${HARNESS.binary.toLowerCase()}`} placeholder={status.command || "/path/to/agent"} onSave={(value) => set({ binaryPath: value })} />
        </Field>
        <Field stacked label={HARNESS.args} help={id === "acp" ? HARNESS.argsAcpHelp : HARNESS.argsHelp}>
          <TextSetting value={settings.launchArgs} label={`${status.label} ${HARNESS.args.toLowerCase()}`} placeholder={id === "acp" ? "--acp" : "none"} onSave={(value) => set({ launchArgs: value })} />
        </Field>
        {homeEnv ? (
          <Field stacked label={HARNESS.home} help={HARNESS.homeHelp(homeEnv)}>
            <TextSetting value={settings.homePath} label={`${status.label} ${HARNESS.home.toLowerCase()}`} placeholder={id === "codex" ? "~/.codex" : "~/.claude"} onSave={(value) => set({ homePath: value })} />
          </Field>
        ) : null}
        {providers.length > 0 ? (
          <Field stacked label={HARNESS.provider} help={HARNESS.providerHelp}>
            <Choice value={settings.modelProvider} items={providers.map((item) => ({ value: item.value, label: item.label }))} label={`${status.label} ${HARNESS.provider.toLowerCase()}`} onChange={(value) => set({ modelProvider: value })} />
          </Field>
        ) : null}
        {acp ? null : (
          <Field stacked label={HARNESS.compact} help={HARNESS.compactHelp}>
            <CompactSetting value={settings.compactAt} label={`${status.label} ${HARNESS.compact.toLowerCase()}`} onSave={(value) => set({ compactAt: value })} />
          </Field>
        )}
        {id === "antigravity" ? (
          <Field stacked label={HARNESS.harnessPath} help={HARNESS.harnessPathHelp}>
            <TextSetting value={settings.harnessPath} label={`${status.label} ${HARNESS.harnessPath.toLowerCase()}`} placeholder="localharness_external" onSave={(value) => set({ harnessPath: value })} />
          </Field>
        ) : null}
        <Field stacked label={HARNESS.custom} help={HARNESS.customHelp}>
          <TextSetting value={settings.customModels.join(" ")} label={`${status.label} ${HARNESS.custom.toLowerCase()}`} placeholder={id === "opencode" ? "anthropic/claude-sonnet-5-5" : "model-id"} onSave={(value) => set({ customModels: value.split(/[\s,]+/).filter(Boolean) })} />
        </Field>
        <div className="flex min-h-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="break-words text-[0.8125rem] font-medium">{HARNESS.inject}</div>
            <p className="break-words text-xs text-muted-foreground">{HARNESS.injectHelp}</p>
          </div>
          <Switch checked={settings.injectPrompts} onCheckedChange={(on) => set({ injectPrompts: on })} aria-label={`${status.label}: ${HARNESS.inject}`} />
        </div>
      </div>
    </section>
  )
}

export function HarnessesGroup({ config, statuses, error, save }: { config: Config; statuses: HarnessStatus[] | undefined; error?: string; save: Save }) {
  const users = harnessUsers(config)
  return (
    <Section prominent title={GROUP_TITLES.harnesses}>
      <p className="max-w-3xl text-sm text-muted-foreground">{HARNESS.intro}</p>
      {!statuses ? (
        <p className="text-sm text-muted-foreground">{error ?? "Looking for installed harnesses…"}</p>
      ) : (
        <div className="grid grid-cols-2 items-start gap-3 xl:grid-cols-3">
          {statuses.map((status) => <HarnessCard key={status.id} status={status} config={config} users={users[status.id] ?? []} save={save} />)}
        </div>
      )}
    </Section>
  )
}
