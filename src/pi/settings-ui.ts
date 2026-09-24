import {
  DynamicBorder,
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, type Component, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { AGENT_KINDS, type AgentKind } from "../schemas/agent.ts";
import {
  INHERIT_MODEL,
  INHERIT_THINKING,
  isThinkingLevel,
  THINKING_LEVELS,
  type AgentModelConfig,
  type DevHouseConfig,
} from "../schemas/configuration.ts";
import { globalConfigPath, loadConfig, saveConfig } from "../state/project.ts";

const CUSTOM_MODEL = "__custom__";

function agentLabel(agent: AgentKind): string {
  return agent === "master" ? "Master" : `${agent[0]!.toUpperCase()}${agent.slice(1)}`;
}

function agentConfig(config: DevHouseConfig, agent: AgentKind): AgentModelConfig {
  return agent === "master" ? config.master : config.agents[agent];
}

function updateAgent(agent: AgentKind, patch: Partial<AgentModelConfig>): void {
  const config = loadConfig();
  if (agent === "master") config.master = { ...config.master, ...patch };
  else config.agents[agent] = { ...config.agents[agent], ...patch };
  saveConfig(config);
}

/** Find a `provider/id` (or bare id) among the models this session can use. */
function findModel(ctx: ExtensionContext, ref: string) {
  const slash = ref.indexOf("/");
  if (slash > 0) return ctx.modelRegistry.find(ref.slice(0, slash), ref.slice(slash + 1));
  return ctx.modelRegistry.getAvailable().find((model) => model.id === ref);
}

/** Apply the master model/thinking to the live session; "inherit" leaves it alone. */
export async function applyMasterModel(pi: ExtensionAPI, ctx: ExtensionContext, config: DevHouseConfig): Promise<void> {
  const { model, thinking } = config.master;
  if (model !== INHERIT_MODEL) {
    const found = findModel(ctx, model);
    if (!found) ctx.ui.notify(`dev-lobby: unknown master model "${model}".`, "warning");
    else if (!(await pi.setModel(found))) ctx.ui.notify(`dev-lobby: no auth for ${model}.`, "warning");
  }
  if (isThinkingLevel(thinking)) pi.setThinkingLevel(thinking);
}

function frame(theme: Theme, title: string, body: Component): Component {
  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
  container.addChild(body);
  container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc back"), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  return container;
}

async function pick(ctx: ExtensionContext, title: string, items: SelectItem[]): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    const list = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    const container = frame(theme, title, list);
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput?.(data);
        tui.requestRender();
      },
    };
  });
}

function modelItems(ctx: ExtensionContext, current: string): SelectItem[] {
  const inherit = current === INHERIT_MODEL ? `${INHERIT_MODEL} ✓` : INHERIT_MODEL;
  const items: SelectItem[] = [{ value: INHERIT_MODEL, label: inherit, description: "Use the session's current model" }];
  const usable = ctx.scopedModels.length > 0 ? ctx.scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
  for (const model of usable) {
    const value = `${model.provider}/${model.id}`;
    items.push({ value, label: value === current ? `${value} ✓` : value });
  }
  items.push({ value: CUSTOM_MODEL, label: "custom…", description: "Type a provider/model id" });
  return items;
}

async function commit(pi: ExtensionAPI, ctx: ExtensionContext, agent: AgentKind, patch: Partial<AgentModelConfig>, detail: string): Promise<void> {
  updateAgent(agent, patch);
  if (agent === "master") await applyMasterModel(pi, ctx, loadConfig());
  ctx.ui.notify(`dev-lobby: ${agent} ${detail} — saved to ${globalConfigPath()}`, "info");
}

async function editModel(pi: ExtensionAPI, ctx: ExtensionContext, agent: AgentKind): Promise<void> {
  const current = agentConfig(loadConfig(), agent).model;
  const choice = await pick(ctx, `Model — ${agentLabel(agent)}`, modelItems(ctx, current));
  if (choice === undefined) return;
  const typed = choice === CUSTOM_MODEL ? (await ctx.ui.input("Model id", "provider/model"))?.trim() : choice;
  if (!typed) return;
  await commit(pi, ctx, agent, { model: typed }, `model → ${typed}`);
}

async function editThinking(pi: ExtensionAPI, ctx: ExtensionContext, agent: AgentKind): Promise<void> {
  const current = agentConfig(loadConfig(), agent).thinking;
  const items: SelectItem[] = [
    { value: INHERIT_THINKING, label: `${INHERIT_THINKING} (live session level)`, description: "Use the thinking level of the current session" },
    ...THINKING_LEVELS.map((level) => ({ value: level, label: level })),
  ].map((item) => (item.value === current ? { ...item, label: `${item.label} ✓` } : item));
  const level = await pick(ctx, `Thinking — ${agentLabel(agent)}`, items);
  if (!level) return;
  await commit(pi, ctx, agent, { thinking: level }, `thinking → ${level}`);
}

async function editInstructions(pi: ExtensionAPI, ctx: ExtensionContext, agent: AgentKind): Promise<void> {
  const current = agentConfig(loadConfig(), agent).instructions ?? "";
  const text = await ctx.ui.editor(`Instructions — ${agentLabel(agent)}`, current);
  if (text === undefined) return;
  await commit(pi, ctx, agent, { instructions: text.trim() }, "instructions saved");
}

async function editAgent(pi: ExtensionAPI, ctx: ExtensionContext, agent: AgentKind): Promise<void> {
  for (;;) {
    const cfg = agentConfig(loadConfig(), agent);
    const items: SelectItem[] = [
      { value: "model", label: "Model", description: cfg.model },
      { value: "thinking", label: "Thinking", description: cfg.thinking },
      { value: "instructions", label: "Instructions", description: cfg.instructions ? `${cfg.instructions.length} chars` : "(none)" },
      { value: "back", label: "Back" },
    ];
    const action = await pick(ctx, `${agentLabel(agent)} settings`, items);
    if (!action || action === "back") return;
    if (action === "model") await editModel(pi, ctx, agent);
    else if (action === "thinking") await editThinking(pi, ctx, agent);
    else await editInstructions(pi, ctx, agent);
  }
}

/** Open the per-agent settings editor; every change is written to the global config. */
export async function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`dev-lobby settings live in ${globalConfigPath()}; edit that file outside the TUI.`, "info");
    return;
  }
  for (;;) {
    const config = loadConfig();
    const items: SelectItem[] = AGENT_KINDS.map((agent) => {
      const cfg = agentConfig(config, agent);
      const custom = cfg.instructions ? " · custom" : "";
      return { value: agent, label: agentLabel(agent), description: `${cfg.model} · ${cfg.thinking}${custom}` };
    });
    items.push({ value: "close", label: "Close" });
    const choice = await pick(ctx, "dev-lobby settings", items);
    if (!choice || choice === "close") return;
    await editAgent(pi, ctx, choice as AgentKind);
  }
}
