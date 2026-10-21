/**
 * Tools & skills: what each agent may use beyond its built-in tools. On the
 * left the agents, each with a count of what it is granted; on the right one
 * card for the chosen agent, with a band for MCP tools (from the servers pi
 * has connected, grouped by server) and a band for skills (every skill pi
 * finds, or only the ones ticked). Grants pi no longer offers stay listed as
 * "not connected" so they can still be removed, and a tool can be added by
 * its exact name while its server is offline. Every tick saves at once.
 */
import { useState } from "react"
import { CircleAlert, Plus, Search } from "lucide-react"
import { useApiRead } from "@/app/useApiRead"
import { Frame, FrameHeader, FramePanel } from "@/components/reui/frame"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ActionButton } from "@/ui/Actions"
import { AgentIcon } from "@/ui/AgentIcon"
import { ROW } from "@/ui/rows"
import { Section } from "@/ui/Section"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import type { BotLobbyConfig, SettingsMcpTool, SettingsSkill } from "@protocol"
import { AGENT_LABELS, AGENT_ORDER, GRANTS, GROUP_TITLES, READ_ONLY_AGENTS, type AgentKind } from "./words"

type Save = (patch: Record<string, unknown>) => Promise<boolean>

interface Grants {
  mcpTools: string[]
  /** Absent: every skill pi finds. */
  skills?: string[]
}

/** Where each agent's grants live in the config. */
const PATH: Record<AgentKind, string[]> = {
  master: ["master"],
  designer: ["agents", "designer"],
  backend: ["agents", "backend"],
  qa: ["agents", "qa"],
  scout: ["scout"],
  researcher: ["researcher"],
  quickfix: ["quickFix"],
  planner: ["planner"],
}

export function grantsOf(config: BotLobbyConfig, kind: AgentKind): Grants {
  const entry = PATH[kind].reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], config) as { mcpTools?: string[]; skills?: string[] }
  return { mcpTools: entry.mcpTools ?? [], ...(entry.skills ? { skills: entry.skills } : {}) }
}

function patchOf(kind: AgentKind, fields: Record<string, unknown>): Record<string, unknown> {
  return PATH[kind].reduceRight<Record<string, unknown>>((acc, key) => ({ [key]: acc }), fields)
}

/** `2 tools · all skills`, as the agent list and the agent cards say it. */
export function grantsLine(grants: Grants, kind: AgentKind): string {
  const tools = grants.mcpTools.length === 0 ? GRANTS.noTools : `${grants.mcpTools.length} MCP tool${grants.mcpTools.length === 1 ? "" : "s"}`
  if (kind === "master") return tools
  const skills = !grants.skills ? GRANTS.allSkills : grants.skills.length === 0 ? GRANTS.noSkills : `${grants.skills.length} skill${grants.skills.length === 1 ? "" : "s"}`
  return `${tools} · ${skills}`
}

const TOOL_NAME = /^mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+$/

/** `get_issue` for `mcp__github__get_issue`: the server is the group's heading. */
function shortName(name: string, server: string): string {
  const prefix = `mcp__${server}__`
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

function serverOf(name: string): string {
  return /^mcp__([A-Za-z0-9_]+?)__/.exec(name)?.[1] ?? ""
}

export function GrantsGroup({ config, save, agent, onAgent }: { config: BotLobbyConfig; save: Save; agent: AgentKind; onAgent: (kind: AgentKind) => void }) {
  const read = useApiRead("settings.grants", {}, [])
  const offered = read.data
  return (
    <Section prominent title={GROUP_TITLES.grants}>
      <p className="max-w-3xl text-sm text-muted-foreground">{GRANTS.intro}</p>
      <div className="grid min-w-0 grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-start gap-4">
        <nav aria-label={GRANTS.agents} className="flex flex-col gap-0.5">
          {AGENT_ORDER.map((kind) => (
            <button key={kind} type="button" aria-current={kind === agent} onClick={() => onAgent(kind)} className={cn(ROW, "min-h-0 gap-0.5 py-2")}>
              <span className="flex items-center gap-2 text-[0.8125rem] font-medium"><AgentIcon source={kind} className="size-4 shrink-0 text-muted-foreground" />{AGENT_LABELS[kind]}</span>
              <span className="pl-6 text-xs text-muted-foreground">{grantsLine(grantsOf(config, kind), kind)}</span>
            </button>
          ))}
        </nav>
        <Frame dense aria-label={`${AGENT_LABELS[agent]} ${GRANTS.cardLabel}`}>
          <ToolsPanel key={`tools-${agent}`} kind={agent} grants={grantsOf(config, agent)} offered={offered?.mcpTools} error={read.error} save={save} />
          <SkillsPanel key={`skills-${agent}`} kind={agent} grants={grantsOf(config, agent)} offered={offered?.skills} error={read.error} save={save} />
        </Frame>
      </div>
    </Section>
  )
}

function PanelHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h4 className="text-sm font-semibold">{title}</h4>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  )
}

/** One row with a checkbox: the name, a quiet line under it, and a tag at the end. */
function GrantRow({ id, name, help, tag, tagTone, checked, disabled, title, onChange }: { id: string; name: string; help?: string; tag?: string; tagTone?: "muted" | "warning"; checked: boolean; disabled?: boolean; title?: string; onChange: (on: boolean) => void }) {
  return (
    <label htmlFor={id} title={title} className={cn("flex min-w-0 cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60", disabled && "cursor-not-allowed opacity-60 hover:bg-transparent")}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next === true)} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="break-all font-mono text-[0.8125rem]">{name}</span>
        {help ? <span className="break-words text-xs text-muted-foreground">{help}</span> : null}
      </span>
      {tag ? <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium", tagTone === "warning" ? "bg-warning/12 text-warning" : "bg-accent text-muted-foreground")}>{tag}</span> : null}
    </label>
  )
}

function ToolsPanel({ kind, grants, offered, error, save }: { kind: AgentKind; grants: Grants; offered?: SettingsMcpTool[]; error?: string; save: Save }) {
  const [filter, setFilter] = useState("")
  const [typed, setTyped] = useState("")
  const granted = new Set(grants.mcpTools)
  const readOnly = READ_ONLY_AGENTS.has(kind)
  const set = (next: string[]) => save(patchOf(kind, { mcpTools: [...new Set(next)] }))
  const toggle = (names: readonly string[], on: boolean) => void set(on ? [...grants.mcpTools, ...names] : grants.mcpTools.filter((name) => !names.includes(name)))
  // Grants pi does not offer now (the server is off, or the tool is gone) stay listed, so they can be removed.
  const known = new Set((offered ?? []).map((tool) => tool.name))
  const missing: SettingsMcpTool[] = grants.mcpTools.filter((name) => !known.has(name)).map((name) => ({ name, server: serverOf(name), description: "", readOnly: false }))
  const query = filter.trim().toLowerCase()
  const shown = [...(offered ?? []), ...missing].filter((tool) => !query || tool.name.toLowerCase().includes(query) || tool.description.toLowerCase().includes(query))
  const servers = [...new Set(shown.map((tool) => tool.server))]
  const usable = (tool: SettingsMcpTool) => !readOnly || tool.readOnly || !known.has(tool.name)
  const add = () => {
    const name = typed.trim()
    if (!TOOL_NAME.test(name)) {
      toast.error(GRANTS.badName)
      return
    }
    setTyped("")
    if (!granted.has(name)) void set([...grants.mcpTools, name])
  }
  return (
    <>
      <FrameHeader className="gap-1 border-b border-(--frame-panel-border-color) py-2.5">
        <PanelHeading title={GRANTS.tools} note={`${grants.mcpTools.length} granted`} />
        <p className="text-xs text-muted-foreground">{readOnly ? GRANTS.readOnlyHelp : kind === "qa" ? GRANTS.qaHelp : GRANTS.toolsHelp}</p>
      </FrameHeader>
      <FramePanel fit className="flex flex-col gap-3 py-3">
        {(offered?.length ?? 0) > 8 ? (
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} placeholder={GRANTS.filter} aria-label={GRANTS.filter} className="pl-8" onChange={(event) => setFilter(event.target.value)} />
          </div>
        ) : null}
        {!offered && !error ? <p className="text-sm text-muted-foreground">{GRANTS.looking}</p> : null}
        {error && !offered ? <p className="text-sm text-muted-foreground">{error}</p> : null}
        {offered && offered.length === 0 && missing.length === 0 ? (
          <p className="text-sm text-muted-foreground">{GRANTS.noServers} <code className="rounded bg-accent px-1 py-0.5 font-mono text-xs">pi mcp add &lt;name&gt; -- &lt;command&gt;</code></p>
        ) : null}
        {servers.map((server) => {
          const tools = shown.filter((tool) => tool.server === server)
          const choosable = tools.filter(usable).map((tool) => tool.name)
          const on = choosable.filter((name) => granted.has(name)).length
          return (
            <div key={server} role="group" aria-label={`${server} tools`} className="flex flex-col gap-0.5">
              <label className="flex items-center gap-3 px-2 py-1 text-xs font-medium text-muted-foreground">
                <Checkbox
                  checked={on === 0 ? false : on === choosable.length ? true : "indeterminate"}
                  disabled={choosable.length === 0}
                  aria-label={`Every ${server} tool`}
                  onCheckedChange={(next) => toggle(choosable, next === true)}
                />
                <span className="font-mono">{server || GRANTS.unknownServer}</span>
                <span>{on} of {tools.length}</span>
              </label>
              {tools.map((tool) => {
                const connected = known.has(tool.name)
                const blocked = !usable(tool)
                return (
                  <GrantRow
                    key={tool.name}
                    id={`grant-${kind}-${tool.name}`}
                    name={shortName(tool.name, tool.server)}
                    help={connected ? tool.description || undefined : GRANTS.notConnectedHelp}
                    tag={!connected ? GRANTS.notConnected : tool.readOnly ? GRANTS.readOnly : GRANTS.writes}
                    tagTone={!connected ? "warning" : "muted"}
                    checked={granted.has(tool.name)}
                    disabled={blocked && !granted.has(tool.name)}
                    {...(blocked ? { title: GRANTS.blockedHelp } : {})}
                    onChange={(next) => toggle([tool.name], next)}
                  />
                )
              })}
            </div>
          )
        })}
        <div className="flex min-w-0 items-center gap-2 border-t border-(--frame-panel-border-color) pt-3">
          <Input value={typed} placeholder="mcp__server__tool" aria-label={GRANTS.addLabel} className="min-w-0 flex-1 font-mono" onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} />
          <ActionButton label={GRANTS.add} icon={Plus} onClick={add} />
        </div>
      </FramePanel>
    </>
  )
}

function SkillsPanel({ kind, grants, offered, error, save }: { kind: AgentKind; grants: Grants; offered?: SettingsSkill[]; error?: string; save: Save }) {
  if (kind === "master") {
    return (
      <>
        <FrameHeader className="gap-1 border-y border-(--frame-panel-border-color) py-2.5"><PanelHeading title={GRANTS.skills} note={GRANTS.sessionSkills} /></FrameHeader>
        <FramePanel fit className="py-3"><p className="text-sm text-muted-foreground">{GRANTS.masterSkills}</p></FramePanel>
      </>
    )
  }
  const all = !grants.skills
  const granted = new Set(grants.skills ?? [])
  const set = (next: string[] | null) => save(patchOf(kind, { skills: next ? [...new Set(next)] : null }))
  const known = new Set((offered ?? []).map((skill) => skill.name))
  const missing = (grants.skills ?? []).filter((name) => !known.has(name))
  // Turning "every skill" off starts from what the agent had: every skill pi finds now.
  const chooseAll = (on: boolean) => void set(on ? null : (offered ?? []).map((skill) => skill.name))
  return (
    <>
      <FrameHeader className="gap-1 border-y border-(--frame-panel-border-color) py-2.5">
        <PanelHeading title={GRANTS.skills} note={all ? GRANTS.allSkills : `${granted.size} granted`} />
        <p className="text-xs text-muted-foreground">{GRANTS.skillsHelp}</p>
      </FrameHeader>
      <FramePanel fit className="flex flex-col gap-3 py-3">
        <div className="flex min-w-0 items-center justify-between gap-4 px-2">
          <div className="min-w-0">
            <div className="text-[0.8125rem] font-medium">{GRANTS.everySkill}</div>
            <p className="text-xs text-muted-foreground">{GRANTS.everySkillHelp}</p>
          </div>
          <Switch checked={all} onCheckedChange={chooseAll} aria-label={`${AGENT_LABELS[kind]} ${GRANTS.everySkill.toLowerCase()}`} />
        </div>
        {!offered && !error ? <p className="px-2 text-sm text-muted-foreground">{GRANTS.looking}</p> : null}
        {error && !offered ? <p className="px-2 text-sm text-muted-foreground">{error}</p> : null}
        {offered && offered.length === 0 && missing.length === 0 ? <p className="px-2 text-sm text-muted-foreground">{GRANTS.noSkillsFound}</p> : null}
        <div role="group" aria-label={`${AGENT_LABELS[kind]} skills`} className={cn("flex flex-col gap-0.5", all && "opacity-60")}>
          {(offered ?? []).map((skill) => (
            <GrantRow key={skill.name} id={`skill-${kind}-${skill.name}`} name={skill.name} help={skill.description} checked={all || granted.has(skill.name)} disabled={all} title={skill.path}
              onChange={(next) => void set(next ? [...granted, skill.name] : [...granted].filter((name) => name !== skill.name))} />
          ))}
          {missing.map((name) => (
            <GrantRow key={name} id={`skill-${kind}-${name}`} name={name} help={GRANTS.skillMissingHelp} tag={GRANTS.notFound} tagTone="warning" checked
              onChange={() => void set([...granted].filter((entry) => entry !== name))} />
          ))}
        </div>
        {!all && granted.size === 0 ? (
          <p className="flex items-center gap-1.5 px-2 text-xs text-warning"><CircleAlert aria-hidden="true" className="size-3.5" />{GRANTS.noneWarning}</p>
        ) : null}
      </FramePanel>
    </>
  )
}
