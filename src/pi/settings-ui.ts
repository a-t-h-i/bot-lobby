import {
  DynamicBorder,
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, type Component, type Focusable, fuzzyFilter, getKeybindings, Input, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import {
  GIT_ISOLATIONS,
  JEV_HOSTS,
  INHERIT_MODEL,
  isThinkingLevel,
  LOBBY_PANELS,
  PLANNING_ROUND_CHOICES,
  SCOUT_THINKING,
  SPLIT_PLAN_CHOICES,
  SUBAGENT_KINDS,
  type AgentModelConfig,
  type BotLobbyConfig,
  type ClassifierFeature,
  type GitIsolation,
  type JevHostName,
  type LobbyPanel,
  type SubagentKind,
} from "../schemas/configuration.ts";
import { globalConfigPath, loadConfig, saveConfig } from "../state/project.ts";
import { checkThinking, kindLabel, modelRef, supportedThinking } from "./model-support.ts";
import { modelLookup } from "./tools.ts";
import { classifier } from "../classifier/instance.ts";
import { describeKey, hostLabel, jevEndpoint, keyHint, maskKey, resolveKey, type StatusSource } from "../classifier/hosts.ts";

const CUSTOM_MODEL = "__custom__";
const MAX_VISIBLE = 12;

/** One settings entry: the master or a subagent profile. */
export type SettingsKind = "master" | SubagentKind;
export const SETTINGS_KINDS: readonly SettingsKind[] = ["master", ...SUBAGENT_KINDS];

/** The editable fields of one entry; scouts have no thinking and no instructions of their own. */
interface EntryView {
  model: string;
  thinking?: string;
  instructions?: string;
  timeoutMs?: number;
  /** The model this agent switches to when its own runs out of usage; unset = none. */
  fallbackModel?: string;
  fallbackThinking?: string;
}

function entryView(config: BotLobbyConfig, kind: SettingsKind): EntryView {
  if (kind === "master") return config.master;
  if (kind === "scout") return { model: config.scout.model, timeoutMs: config.scout.timeoutMs, ...(config.scout.fallbackModel ? { fallbackModel: config.scout.fallbackModel } : {}) };
  if (kind === "researcher") return config.researcher;
  if (kind === "quickfix") return config.quickFix;
  if (kind === "planner") return config.planner;
  return config.agents[kind];
}

interface EntryPatch {
  model?: string;
  thinking?: string;
  instructions?: string;
  timeoutMs?: number;
  /** `inherit` clears the fallback (its thinking level with it). */
  fallbackModel?: string;
  fallbackThinking?: string;
}

/** A settings entry with the fallback patch applied: `inherit` removes the fallback model and its thinking. */
function withFallbackPatch<T extends { fallbackModel?: string; fallbackThinking?: string }>(entry: T): T {
  if (entry.fallbackModel !== INHERIT_MODEL) return entry;
  const { fallbackModel: _model, fallbackThinking: _thinking, ...rest } = entry;
  return rest as T;
}

/** Apply a patch to one entry in a config copy; scouts ignore thinking and instructions. */
export function patchEntry(config: BotLobbyConfig, kind: SettingsKind, patch: EntryPatch): BotLobbyConfig {
  const next: BotLobbyConfig = { ...config, agents: { ...config.agents } };
  if (kind === "master") next.master = withFallbackPatch({ ...config.master, ...patch } as AgentModelConfig);
  else if (kind === "scout") {
    const fallbackModel = patch.fallbackModel ?? config.scout.fallbackModel;
    next.scout = withFallbackPatch({
      model: patch.model ?? config.scout.model,
      timeoutMs: patch.timeoutMs ?? config.scout.timeoutMs,
      ...(fallbackModel ? { fallbackModel } : {}),
    });
  } else if (kind === "researcher") next.researcher = withFallbackPatch({ ...config.researcher, ...patch } as AgentModelConfig);
  else if (kind === "quickfix") next.quickFix = withFallbackPatch({ ...config.quickFix, ...patch } as AgentModelConfig);
  else if (kind === "planner") next.planner = withFallbackPatch({ ...config.planner, ...patch } as AgentModelConfig);
  else next.agents[kind] = withFallbackPatch({ ...config.agents[kind], ...patch } as AgentModelConfig);
  return next;
}

function updateEntry(kind: SettingsKind, patch: EntryPatch): void {
  saveConfig(patchEntry(loadConfig(), kind, patch));
}

/** Apply the master model/thinking to the live session; "inherit" leaves it alone. */
export async function applyMasterModel(pi: ExtensionAPI, ctx: ExtensionContext, config: BotLobbyConfig): Promise<void> {
  const { model, thinking } = config.master;
  if (model !== INHERIT_MODEL) {
    const found = modelLookup(ctx)(model);
    if (!found) ctx.ui.notify(`bot-lobby: unknown master model "${model}".`, "warning");
    else if (!(await pi.setModel(found))) ctx.ui.notify(`bot-lobby: no auth for ${model}.`, "warning");
  }
  if (isThinkingLevel(thinking)) pi.setThinkingLevel(thinking);
}

function hintText(search: boolean): string {
  const nav = "↑↓ navigate • enter select • esc back";
  return search ? `type to search • ${nav}` : nav;
}

function frame(theme: Theme, title: string, body: Component, search = false): Component {
  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
  container.addChild(body);
  container.addChild(new Text(theme.fg("dim", hintText(search)), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  return container;
}

/** Fuzzy-filter picker items over label, value and description; blank queries pass through. */
export function filterItems(items: SelectItem[], query: string): SelectItem[] {
  if (query.trim() === "") return items;
  return fuzzyFilter(items, query, (item) => `${item.label} ${item.value} ${item.description ?? ""}`);
}

function listFor(items: SelectItem[], done: (value: string | undefined) => void): SelectList {
  const list = new SelectList(items, Math.min(items.length, MAX_VISIBLE), getSelectListTheme());
  list.onSelect = (item) => done(item.value);
  list.onCancel = () => done(undefined);
  return list;
}

function isListKey(data: string): boolean {
  const kb = getKeybindings();
  return kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")
    || kb.matches(data, "tui.select.confirm") || kb.matches(data, "tui.select.cancel");
}

/** Searchable picker: typing rebuilds the list, while arrows/enter/esc still drive it. */
export class SearchPicker implements Component, Focusable {
  private readonly body = new Container();
  private readonly input = new Input({ placeholder: "search" });
  private readonly frame: Component;
  private readonly items: SelectItem[];
  private readonly done: (value: string | undefined) => void;
  private readonly requestRender: () => void;
  private list: SelectList;
  private query = "";

  constructor(title: string, items: SelectItem[], theme: Theme, done: (value: string | undefined) => void, requestRender: () => void) {
    this.items = items;
    this.done = done;
    this.requestRender = requestRender;
    this.list = listFor(items, done);
    this.body.addChild(this.input);
    this.body.addChild(this.list);
    this.frame = frame(theme, title, this.body, true);
  }

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(value: boolean) {
    this.input.focused = value;
  }

  private refine(): void {
    const query = this.input.getValue();
    if (query === this.query) return;
    this.query = query;
    const next = filterItems(this.items, query);
    this.body.removeChild(this.list);
    this.list = listFor(next, this.done);
    this.body.addChild(this.list);
  }

  handleInput(data: string): void {
    if (isListKey(data)) this.list.handleInput(data);
    else {
      this.input.handleInput(data);
      this.refine();
    }
    this.requestRender();
  }

  render(width: number): string[] {
    return this.frame.render(width);
  }

  invalidate(): void {
    this.frame.invalidate();
  }
}

async function pickPlain(ctx: ExtensionContext, title: string, items: SelectItem[]): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    const list = listFor(items, done);
    const container = frame(theme, title, list);
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

async function pickSearch(ctx: ExtensionContext, title: string, items: SelectItem[]): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    return new SearchPicker(title, items, theme, done, () => tui.requestRender());
  });
}

interface PickOptions {
  search?: boolean;
}

async function pick(ctx: ExtensionContext, title: string, items: SelectItem[], options: PickOptions = {}): Promise<string | undefined> {
  return options.search ? pickSearch(ctx, title, items) : pickPlain(ctx, title, items);
}

/** Model choices; only the master offers `inherit`, since it is the live session itself. */
export function modelItems(ctx: ExtensionContext, current: string, includeInherit = true): SelectItem[] {
  const items: SelectItem[] = [];
  if (includeInherit) {
    const inherit = current === INHERIT_MODEL ? `${INHERIT_MODEL} ✓` : INHERIT_MODEL;
    items.push({ value: INHERIT_MODEL, label: inherit, description: "Use the session's current model" });
  }
  const usable = ctx.scopedModels.length > 0 ? ctx.scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable();
  for (const model of usable) {
    const value = `${model.provider}/${model.id}`;
    const label = value === current ? `${value} ✓` : value;
    const description = model.name && model.name !== value ? model.name : undefined;
    items.push(description ? { value, label, description } : { value, label });
  }
  items.push({ value: CUSTOM_MODEL, label: "custom…", description: "Type a provider/model id" });
  return items;
}

/** The model an entry runs on: its own, or the session's while unset. */
function effectiveModel(ctx: ExtensionContext, model: string) {
  if (model !== INHERIT_MODEL) return modelLookup(ctx)(model);
  return ctx.model;
}

/** Thinking choices limited to what the entry's model supports. */
export function thinkingItems(levels: readonly string[], current: string | undefined): SelectItem[] {
  return levels.map((level) => (level === current ? { value: level, label: `${level} ✓` } : { value: level, label: level }));
}

async function commit(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind, patch: EntryPatch, detail: string): Promise<void> {
  updateEntry(kind, patch);
  if (kind === "master") await applyMasterModel(pi, ctx, loadConfig());
  ctx.ui.notify(`bot-lobby: ${kindLabel(kind)} ${detail} — saved to ${globalConfigPath()}`, "info");
}

/** After a model change, clamp a saved thinking level the new model cannot run, and say so. */
async function reconcileThinking(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  const view = entryView(loadConfig(), kind);
  if (!view.thinking) return;
  const check = checkThinking(effectiveModel(ctx, view.model), view.thinking);
  if (!check.warning) return;
  updateEntry(kind, { thinking: check.level });
  if (kind === "master") await applyMasterModel(pi, ctx, loadConfig());
  ctx.ui.notify(`bot-lobby: ${kindLabel(kind)} — ${check.warning}.`, "warning");
}

async function editModel(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  const current = entryView(loadConfig(), kind).model;
  const choice = await pick(ctx, `Model — ${kindLabel(kind)}`, modelItems(ctx, current, kind === "master"), { search: true });
  if (choice === undefined) return;
  const typed = choice === CUSTOM_MODEL ? (await ctx.ui.input("Model id", "provider/model"))?.trim() : choice;
  if (!typed) return;
  await commit(pi, ctx, kind, { model: typed }, `model → ${typed}`);
  await reconcileThinking(pi, ctx, kind);
}

async function editThinking(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  const view = entryView(loadConfig(), kind);
  const model = effectiveModel(ctx, view.model);
  const levels = supportedThinking(model);
  const title = model ? `Thinking — ${kindLabel(kind)} (${modelRef(model)})` : `Thinking — ${kindLabel(kind)}`;
  const level = await pick(ctx, title, thinkingItems(levels, view.thinking));
  if (!level || !isThinkingLevel(level)) return;
  await commit(pi, ctx, kind, { thinking: level }, `thinking → ${level}`);
}

/** The model an entry falls back to when its own runs out of usage; `none` removes it. */
async function editFallbackModel(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  const view = entryView(loadConfig(), kind);
  const current = view.fallbackModel ?? INHERIT_MODEL;
  const none: SelectItem = { value: INHERIT_MODEL, label: current === INHERIT_MODEL ? "none ✓" : "none", description: "No fallback: when its model runs out of usage the run fails" };
  const choice = await pick(ctx, `Fallback model — ${kindLabel(kind)}`, [none, ...modelItems(ctx, current, false)], { search: true });
  if (choice === undefined) return;
  const typed = choice === CUSTOM_MODEL ? (await ctx.ui.input("Model id", "provider/model"))?.trim() : choice;
  if (!typed) return;
  await commit(pi, ctx, kind, { fallbackModel: typed }, typed === INHERIT_MODEL ? "fallback removed" : `fallback model → ${typed}`);
  if (typed === INHERIT_MODEL || kind === "scout") return;
  // Keep the fallback's thinking level one its model can run.
  const level = entryView(loadConfig(), kind).fallbackThinking;
  const check = level ? checkThinking(modelLookup(ctx)(typed), level) : undefined;
  if (check?.warning) {
    updateEntry(kind, { fallbackThinking: check.level });
    ctx.ui.notify(`bot-lobby: ${kindLabel(kind)} fallback — ${check.warning}.`, "warning");
  }
}

/** The thinking level on the fallback model, limited to what that model supports. */
async function editFallbackThinking(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  const view = entryView(loadConfig(), kind);
  if (!view.fallbackModel) return;
  const model = modelLookup(ctx)(view.fallbackModel);
  const title = `Fallback thinking — ${kindLabel(kind)} (${view.fallbackModel})`;
  const level = await pick(ctx, title, thinkingItems(supportedThinking(model), view.fallbackThinking ?? view.thinking));
  if (!level || !isThinkingLevel(level)) return;
  await commit(pi, ctx, kind, { fallbackThinking: level }, `fallback thinking → ${level}`);
}

async function editTimeout(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  const current = entryView(loadConfig(), kind).timeoutMs ?? loadConfig().workflow.agentTimeoutMs;
  const typed = (await ctx.ui.input(`Time limit (minutes) — ${kindLabel(kind)}`, String(Math.round(current / 60_000))))?.trim();
  if (!typed) return;
  const minutes = Number(typed);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    ctx.ui.notify(`bot-lobby: "${typed}" is not a positive number of minutes.`, "warning");
    return;
  }
  await commit(pi, ctx, kind, { timeoutMs: Math.round(minutes * 60_000) }, `time limit → ${minutes}m`);
}

async function editInstructions(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  const current = entryView(loadConfig(), kind).instructions ?? "";
  const text = await ctx.ui.editor(`Instructions — ${kindLabel(kind)}`, current);
  if (text === undefined) return;
  await commit(pi, ctx, kind, { instructions: text.trim() }, "instructions saved");
}

function minutes(ms: number | undefined): string {
  return ms ? `${Math.round(ms / 60_000)}m` : "default";
}

/** Menu rows for one entry; scouts expose model and time limit only (their thinking is fixed). */
export function entryItems(kind: SettingsKind, view: EntryView): SelectItem[] {
  const items: SelectItem[] = [{ value: "model", label: "Model", description: view.model }];
  if (kind === "scout") items.push({ value: "fixed", label: "Thinking", description: `${SCOUT_THINKING} (fixed for scouts)` });
  else items.push({ value: "thinking", label: "Thinking", description: view.thinking ?? "" });
  items.push({ value: "fallback", label: "Fallback model", description: view.fallbackModel ?? "none · used when this model runs out of usage" });
  if (kind !== "scout" && view.fallbackModel) items.push({ value: "fallbackThinking", label: "Fallback thinking", description: view.fallbackThinking ?? view.thinking ?? "" });
  if (kind !== "master") items.push({ value: "timeout", label: "Time limit", description: minutes(view.timeoutMs) });
  if (kind !== "scout" && kind !== "researcher") {
    items.push({ value: "instructions", label: "Instructions", description: view.instructions ? `${view.instructions.length} chars` : "(none)" });
  }
  items.push({ value: "back", label: "Back" });
  return items;
}

async function editEntry(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  for (;;) {
    const action = await pick(ctx, `${kindLabel(kind)} settings`, entryItems(kind, entryView(loadConfig(), kind)));
    if (!action || action === "back") return;
    if (action === "model") await editModel(pi, ctx, kind);
    else if (action === "thinking") await editThinking(pi, ctx, kind);
    else if (action === "fallback") await editFallbackModel(pi, ctx, kind);
    else if (action === "fallbackThinking") await editFallbackThinking(pi, ctx, kind);
    else if (action === "timeout") await editTimeout(pi, ctx, kind);
    else if (action === "instructions") await editInstructions(pi, ctx, kind);
  }
}

/** One agent's settings on their own: the lobby's Quick fix and Plan tabs open their agent's entry directly. */
export async function openEntrySettings(pi: ExtensionAPI, ctx: ExtensionContext, kind: SettingsKind): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`bot-lobby settings live in ${globalConfigPath()}; edit that file outside the TUI.`, "info");
    return;
  }
  await editEntry(pi, ctx, kind);
}

/**
 * Subagents never inherit silently: any subagent whose model is still unset is
 * pinned to the session's current model and saved, so settings always show
 * what each agent runs on.
 */
export function prefillModels(config: BotLobbyConfig, sessionModel: string | undefined): { config: BotLobbyConfig; filled: SubagentKind[] } {
  if (!sessionModel) return { config, filled: [] };
  let next = config;
  const filled: SubagentKind[] = [];
  for (const kind of SUBAGENT_KINDS) {
    if (entryView(next, kind).model !== INHERIT_MODEL) continue;
    next = patchEntry(next, kind, { model: sessionModel });
    filled.push(kind);
  }
  return { config: next, filled };
}

function entryDescription(kind: SettingsKind, view: EntryView): string {
  const thinking = kind === "scout" ? SCOUT_THINKING : view.thinking;
  const custom = view.instructions ? " · custom" : "";
  const limit = kind === "master" ? "" : ` · ${minutes(view.timeoutMs)}`;
  const fallback = view.fallbackModel ? ` · fallback ${view.fallbackModel}` : "";
  return `${view.model} · ${thinking}${limit}${custom}${fallback}`;
}

/** The lobby's on/off settings as the settings menu lists them; `panel:*` are the Lobby tab's panes. */
export type LobbySwitch = "autoOpen" | "autoAsk" | "mouse" | "miniLine" | "issues" | `panel:${LobbyPanel}`;

const PANEL_SWITCH_LABELS: Record<LobbyPanel, string> = { conversation: "Conversation pane", activity: "Activity log pane", thinking: "Thinking pane" };

export const LOBBY_SWITCHES: ReadonlyArray<{ id: LobbySwitch; label: string; help: string }> = [
  { id: "autoOpen", label: "Open with a task", help: "open the lobby when this session starts or resumes a task" },
  { id: "autoAsk", label: "Ask at once", help: "put the panel's questions to you as soon as a round ends, while the Plan tab is open" },
  { id: "mouse", label: "Mouse", help: "click tabs and draft lines, scroll with the wheel (shift+drag still selects text)" },
  { id: "miniLine", label: "Status line when hidden", help: "one line under the editor while the lobby is hidden: task steps, the planning round, a quick fix, or idle" },
  { id: "issues", label: "Issues tab", help: "the GitHub Issues tab" },
  ...LOBBY_PANELS.map((panel) => ({
    id: `panel:${panel}` as const,
    label: PANEL_SWITCH_LABELS[panel],
    help: "shown on the Lobby tab; its key in the lobby toggles it too",
  })),
];

export function lobbySwitch(config: BotLobbyConfig, id: LobbySwitch): boolean {
  if (id.startsWith("panel:")) return config.lobby.panels[id.slice("panel:".length) as LobbyPanel];
  return config.lobby[id as Exclude<LobbySwitch, `panel:${string}`>];
}

/** The config with one lobby setting flipped. */
export function toggleLobbySwitch(config: BotLobbyConfig, id: LobbySwitch): BotLobbyConfig {
  const value = !lobbySwitch(config, id);
  if (id.startsWith("panel:")) {
    const panel = id.slice("panel:".length) as LobbyPanel;
    return { ...config, lobby: { ...config.lobby, panels: { ...config.lobby.panels, [panel]: value } } };
  }
  return { ...config, lobby: { ...config.lobby, [id]: value } };
}

/** `5 rounds`, or `unlimited` for 0. */
export function roundLimitLabel(limit: number): string {
  return limit > 0 ? `${limit} round${limit === 1 ? "" : "s"}` : "unlimited";
}

/** The next planning round limit in the menu's cycle (2, 3, 5, 8, unlimited); a hand-edited value rejoins it. */
export function nextRoundLimit(current: number): number {
  const index = PLANNING_ROUND_CHOICES.indexOf(current as (typeof PLANNING_ROUND_CHOICES)[number]);
  if (index >= 0) return PLANNING_ROUND_CHOICES[(index + 1) % PLANNING_ROUND_CHOICES.length]!;
  return PLANNING_ROUND_CHOICES.find((choice) => choice > current) ?? 0;
}

/** `over 8 steps`, or `never` for 0. */
export function splitLimitLabel(limit: number): string {
  return limit > 0 ? `over ${limit} steps` : "never";
}

/** The next step count in the menu's cycle (6, 8, 10, 12, never); a hand-edited value rejoins it. */
export function nextSplitLimit(current: number): number {
  const index = SPLIT_PLAN_CHOICES.indexOf(current as (typeof SPLIT_PLAN_CHOICES)[number]);
  if (index >= 0) return SPLIT_PLAN_CHOICES[(index + 1) % SPLIT_PLAN_CHOICES.length]!;
  return SPLIT_PLAN_CHOICES.find((choice) => choice > current) ?? 0;
}

/** `on · port 7347 · opens the browser · questions both`, for the settings menu. */
export function webSummary(config: BotLobbyConfig): string {
  const web = config.lobby.web;
  return `${web.enabled ? "on" : "off"} · port ${web.port === 0 ? "any" : web.port} · ${web.openBrowser ? "opens the browser" : "link only"} · questions ${web.questions}`;
}

/** The next place the web UI's questions are answered (`both`, in the browser or the terminal). */
export function nextWebQuestions(current: string): "both" | "terminal" {
  return current === "both" ? "terminal" : "both";
}

/** A port typed in the settings menu: 0 (any free port) or a real port; undefined when it is not a port. */
export function parseWebPort(typed: string): number | undefined {
  if (!/^\d+$/.test(typed.trim())) return undefined;
  const port = Number(typed.trim());
  return port === 0 || (port > 0 && port <= 65535) ? port : undefined;
}

/** The loopback web UI's own settings: on/off, its port, the browser and where its questions are answered. */
async function editWeb(ctx: ExtensionContext): Promise<void> {
  const typed = await pick(ctx, "bot-lobby settings · Web UI", [
    { value: "enabled", label: "Web UI", description: `${loadConfig().lobby.web.enabled ? "on" : "off"} · start the loopback browser UI with /bot-lobby web` },
    { value: "port", label: "Port", description: `${loadConfig().lobby.web.port === 0 ? "any free port" : loadConfig().lobby.web.port} · the base port (then the next free up to +20); 0 means any free port` },
    { value: "browser", label: "Open browser", description: `${loadConfig().lobby.web.openBrowser ? "on" : "off"} · open the link in the browser on /bot-lobby web` },
    { value: "questions", label: "Questions", description: `${loadConfig().lobby.web.questions} · where the web UI's questions are answered: both, or the terminal only` },
    { value: "back", label: "Back" },
  ]);
  if (!typed || typed === "back") return;
  const config = loadConfig();
  if (typed === "enabled") saveConfig({ ...config, lobby: { ...config.lobby, web: { ...config.lobby.web, enabled: !config.lobby.web.enabled } } });
  else if (typed === "browser") saveConfig({ ...config, lobby: { ...config.lobby, web: { ...config.lobby.web, openBrowser: !config.lobby.web.openBrowser } } });
  else if (typed === "questions") saveConfig({ ...config, lobby: { ...config.lobby, web: { ...config.lobby.web, questions: nextWebQuestions(config.lobby.web.questions) } } });
  else await editWebPort(ctx);
  await editWeb(ctx);
}

/** Type the web UI's port; 0 means any free port. */
async function editWebPort(ctx: ExtensionContext): Promise<void> {
  const typed = (await ctx.ui.input("Web UI port (0: any free port)", String(loadConfig().lobby.web.port)))?.trim();
  if (!typed) return;
  const port = parseWebPort(typed);
  if (port === undefined) {
    ctx.ui.notify(`bot-lobby: "${typed}" is not a port (0, or 1-65535).`, "warning");
    return;
  }
  const config = loadConfig();
  saveConfig({ ...config, lobby: { ...config.lobby, web: { ...config.lobby.web, port } } });
}

/** On/off settings for the lobby, and the planning round limit; enter flips or cycles one and saves it. Key rebinding stays in the file (lobby.keys). */
async function editLobby(ctx: ExtensionContext): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const items: SelectItem[] = LOBBY_SWITCHES.map((entry) => ({ value: entry.id, label: entry.label, description: `${lobbySwitch(config, entry.id) ? "on" : "off"} · ${entry.help}` }));
    items.push({ value: "rounds", label: "Planning rounds", description: `${roundLimitLabel(config.lobby.maxPlanningRounds)} · enter cycles 2, 3, 5, 8, unlimited; the last round the oracle settles alone` });
    items.push({ value: "split", label: "Split long plans", description: `${splitLimitLabel(config.lobby.splitPlanAbove)} · saving a plan with more steps offers to split it into up to 5 tasks · enter cycles 6, 8, 10, 12, never` });
    items.push({ value: "web", label: "Web UI", description: webSummary(config) });
    items.push({ value: "back", label: "Back", description: `keys: lobby.keys in ${globalConfigPath()}` });
    const choice = await pick(ctx, "bot-lobby settings · Lobby", items);
    if (!choice || choice === "back") return;
    if (choice === "web") await editWeb(ctx);
    else if (choice === "rounds") saveConfig({ ...config, lobby: { ...config.lobby, maxPlanningRounds: nextRoundLimit(config.lobby.maxPlanningRounds) } });
    else if (choice === "split") saveConfig({ ...config, lobby: { ...config.lobby, splitPlanAbove: nextSplitLimit(config.lobby.splitPlanAbove) } });
    else saveConfig(toggleLobbySwitch(config, choice as LobbySwitch));
  }
}

function lobbySummary(config: BotLobbyConfig): string {
  const hidden = LOBBY_PANELS.filter((panel) => !config.lobby.panels[panel]);
  return [
    config.lobby.autoOpen ? "opens with a task" : "opens on alt+l",
    config.lobby.autoAsk ? "asks at once" : "asks on enter",
    config.lobby.mouse ? "mouse" : "no mouse",
    ...(config.lobby.miniLine ? [] : ["no status line"]),
    `planning: ${roundLimitLabel(config.lobby.maxPlanningRounds)}`,
    `split plans ${splitLimitLabel(config.lobby.splitPlanAbove)}`,
    ...(config.lobby.issues ? ["issues tab"] : []),
    ...(hidden.length > 0 ? [`hidden: ${hidden.join(", ")}`] : []),
  ].join(" · ");
}

/**
 * Classifier decisions that exist so far, as the settings menu lists them.
 * Each phase of the classifier work adds its own entry.
 */
export const CLASSIFIER_FEATURE_ITEMS: ReadonlyArray<{ id: ClassifierFeature; label: string; help: string }> = [
  { id: "seats", label: "Planning seats", help: "each round, only the seats your idea or latest answers touch sit; 1-4 in the Plan tab pins one" },
  { id: "answers", label: "Obvious answers", help: "a panel question whose recommended option the conversation already makes clearly right is answered for you (listed under Assumptions)" },
  { id: "triage", label: "Task triage", help: "a new task's size, domains and research need reach the Master as hints; a quick fix that is really a task is held for you" },
  { id: "effort", label: "Effort routing", help: "a simple step runs one thinking level lower, a trivial one on the cheaper model below; a routed run that falls short runs again on your settings" },
  { id: "review", label: "Pull request read", help: "the Git tab's quick read of a pull request: its size, and how likely it is risky, security-relevant, breaking or untested, before an agent reviews it" },
  { id: "knowledge", label: "Relevant knowledge", help: "when an agent's knowledge, standards or decisions file is too long for its prompt, Jev picks the sections that bear on the step, and the agent is told where the rest is" },
  { id: "files", label: "File hints", help: "scouts, workers, quick fixes and the planning panel start with the files most likely needed, and can look more up with find_relevant_files" },
];

/** What each git isolation means, for the settings menu. */
const GIT_ISOLATION_HELP: Record<GitIsolation, string> = {
  off: "tasks work in the folder you started them in",
  branch: "each new task gets a git branch named after it, checked out in the working folder",
  worktree: "each new task gets its own worktree and branch, named after it: every agent runs there, apart from your checkout",
};

/** The next git isolation in the menu's cycle (off, branch, worktree). */
export function nextGitIsolation(current: GitIsolation): GitIsolation {
  return GIT_ISOLATIONS[(GIT_ISOLATIONS.indexOf(current) + 1) % GIT_ISOLATIONS.length]!;
}

/** `branch · each new task gets…`, for the settings menu; `--branch`, `--worktree` and `--no-branch` decide for one task. */
export function gitSummary(config: BotLobbyConfig): string {
  const isolation = config.workflow.gitIsolation;
  return `${isolation} · ${GIT_ISOLATION_HELP[isolation]} · enter cycles ${GIT_ISOLATIONS.join(", ")}`;
}

/** The next Jev host in the menu's cycle. */
export function nextJevHost(current: JevHostName): JevHostName {
  return JEV_HOSTS[(JEV_HOSTS.indexOf(current) + 1) % JEV_HOSTS.length]!;
}

/** The config with one classifier decision switched on or off. */
export function toggleClassifierFeature(config: BotLobbyConfig, feature: ClassifierFeature): BotLobbyConfig {
  const features = { ...config.classifier.features, [feature]: !config.classifier.features[feature] };
  return { ...config, classifier: { ...config.classifier, features } };
}

/** `on · OpenCode Zen · jev-1.13-free · key stored in pi`, for the settings menu and `/bot-lobby config`. */
export function classifierSummary(config: BotLobbyConfig, status: StatusSource | undefined): string {
  const { host, model } = jevEndpoint(config.classifier, status);
  const via = config.classifier.provider === "auto" ? `${host.label} (auto)` : host.label;
  return [config.classifier.enabled ? "on" : "off", via, model, `key ${describeKey(host, status)}`].join(" · ");
}

/** pi's auth status per provider, never throwing. */
function authStatus(ctx: ExtensionContext): StatusSource {
  return (piProvider) => {
    try {
      return ctx.modelRegistry.getProviderAuthStatus(piProvider);
    } catch {
      return undefined;
    }
  };
}

/** Where the key lives and how to set it, with the loaded key masked. */
async function keyHelp(ctx: ExtensionContext, config: BotLobbyConfig): Promise<string> {
  const status = authStatus(ctx);
  const { host } = jevEndpoint(config.classifier, status);
  let masked = "";
  try {
    const key = await resolveKey(host, (provider) => ctx.modelRegistry.getApiKeyForProvider(provider));
    if (key) masked = ` Loaded: ${maskKey(key)}.`;
  } catch {
    // No key to show.
  }
  const where = host.name === "opencode"
    ? "it is the OpenCode key pi already uses for Zen and Go models"
    : host.name === "typesafe" ? "it is saved in pi's auth.json with your other keys" : `it is the key pi already holds for ${host.label}`;
  return `Jev via ${host.label}: key ${describeKey(host, status)}.${masked} To set it, ${keyHint(config.classifier)}; ${where}.`;
}

/** Type a Jev model id; empty uses the host's default (OpenCode: the free jev-1.13-free). */
async function editJevModel(ctx: ExtensionContext): Promise<void> {
  const config = loadConfig();
  const { host } = jevEndpoint(config.classifier, authStatus(ctx));
  const typed = await ctx.ui.input(`Jev model (empty: ${host.label}'s default, ${host.model})`, config.classifier.model || host.model);
  if (typed === undefined) return;
  const model = typed.trim() === host.model ? "" : typed.trim();
  saveConfig({ ...config, classifier: { ...config.classifier, model } });
  ctx.ui.notify(`bot-lobby: Jev model → ${model || `${host.model} (${host.label}'s default)`} — saved to ${globalConfigPath()}`, "info");
}

/** The model trivial steps run on; `none` keeps each agent's model and only lowers thinking. */
async function editCheapModel(ctx: ExtensionContext): Promise<void> {
  const config = loadConfig();
  const current = config.classifier.effort.cheapModel;
  const none: SelectItem = { value: INHERIT_MODEL, label: current === INHERIT_MODEL ? "none ✓" : "none", description: "Trivial steps keep their model and run one thinking level lower" };
  const choice = await pick(ctx, "Cheaper model for trivial steps", [none, ...modelItems(ctx, current, false)], { search: true });
  if (choice === undefined) return;
  const typed = choice === CUSTOM_MODEL ? (await ctx.ui.input("Model id", "provider/model"))?.trim() : choice;
  if (!typed) return;
  saveConfig({ ...config, classifier: { ...config.classifier, effort: { cheapModel: typed } } });
  ctx.ui.notify(`bot-lobby: trivial steps run on ${typed === INHERIT_MODEL ? "their own model, one thinking level lower" : typed} — saved to ${globalConfigPath()}`, "info");
}

/** The classifier: on/off, where Jev is called, its key, which decisions it makes, and a connection test. */
async function editClassifier(ctx: ExtensionContext): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const settings = config.classifier;
    const status = authStatus(ctx);
    const { host, model } = jevEndpoint(settings, status);
    const items: SelectItem[] = [
      { value: "enabled", label: "Classifier", description: `${settings.enabled ? "on" : "off"} · Jev makes the obvious decisions so large models spend fewer tokens on them` },
      { value: "host", label: "Host", description: `${hostLabel(settings.provider)}${settings.provider === "auto" ? ` → ${host.label}` : ""} · enter cycles ${JEV_HOSTS.map(hostLabel).join(", ")}` },
      { value: "key", label: "API key", description: describeKey(host, status) },
      { value: "model", label: "Model", description: `${model}${settings.model ? "" : " (the host's default)"} · e.g. jev-1.13 once OpenCode's free jev-1.13-free ends` },
      ...CLASSIFIER_FEATURE_ITEMS.map((entry) => ({ value: `feature:${entry.id}`, label: entry.label, description: `${settings.features[entry.id] ? "on" : "off"} · ${entry.help}` })),
      { value: "cheap", label: "Cheaper model", description: `${settings.effort.cheapModel === INHERIT_MODEL ? "none: trivial steps keep their model and drop a thinking level" : settings.effort.cheapModel} · what effort routing runs trivial steps on` },
      { value: "test", label: "Test connection", description: "one tiny call: shows the model and how long it took" },
      { value: "back", label: "Back", description: `thresholds and limits: classifier in ${globalConfigPath()}` },
    ];
    const choice = await pick(ctx, "bot-lobby settings · Classifier (Jev)", items);
    if (!choice || choice === "back") return;
    if (choice === "enabled") saveConfig({ ...config, classifier: { ...settings, enabled: !settings.enabled } });
    else if (choice === "host") saveConfig({ ...config, classifier: { ...settings, provider: nextJevHost(settings.provider) } });
    else if (choice === "key") ctx.ui.notify(await keyHelp(ctx, config), "info");
    else if (choice === "model") await editJevModel(ctx);
    else if (choice === "cheap") await editCheapModel(ctx);
    else if (choice === "test") {
      const result = await classifier().test();
      ctx.ui.notify(result.ok ? `Jev answered in ${result.ms} ms (${result.model}).` : `Jev test failed: ${result.error}`, result.ok ? "info" : "error");
    } else if (choice.startsWith("feature:")) saveConfig(toggleClassifierFeature(config, choice.slice("feature:".length) as ClassifierFeature));
  }
}

/** Open the per-agent settings editor; every change is written to the global config. */
export async function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`bot-lobby settings live in ${globalConfigPath()}; edit that file outside the TUI.`, "info");
    return;
  }
  const prefilled = prefillModels(loadConfig(), ctx.model ? modelRef(ctx.model) : undefined);
  if (prefilled.filled.length > 0) {
    saveConfig(prefilled.config);
    ctx.ui.notify(`bot-lobby: set ${prefilled.filled.map(kindLabel).join(", ")} to the session model; change them here any time.`, "info");
  }
  for (;;) {
    const config = loadConfig();
    const items: SelectItem[] = SETTINGS_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind), description: entryDescription(kind, entryView(config, kind)) }));
    items.push({ value: "git", label: "Git isolation", description: gitSummary(config) });
    items.push({ value: "lobby", label: "Lobby", description: lobbySummary(config) });
    items.push({ value: "classifier", label: "Classifier (Jev)", description: classifierSummary(config, authStatus(ctx)) });
    items.push({ value: "close", label: "Close" });
    const choice = await pick(ctx, "bot-lobby settings", items);
    if (!choice || choice === "close") return;
    if (choice === "git") saveConfig({ ...config, workflow: { ...config.workflow, gitIsolation: nextGitIsolation(config.workflow.gitIsolation) } });
    else if (choice === "lobby") await editLobby(ctx);
    else if (choice === "classifier") await editClassifier(ctx);
    else await editEntry(pi, ctx, choice as SettingsKind);
  }
}
