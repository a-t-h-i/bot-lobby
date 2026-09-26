import {
  DynamicBorder,
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, type Component, type Focusable, fuzzyFilter, getKeybindings, Input, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import {
  INHERIT_MODEL,
  isThinkingLevel,
  SCOUT_THINKING,
  SUBAGENT_KINDS,
  type AgentModelConfig,
  type BotLobbyConfig,
  type SubagentKind,
} from "../schemas/configuration.ts";
import { globalConfigPath, loadConfig, saveConfig } from "../state/project.ts";
import { checkThinking, kindLabel, modelRef, supportedThinking } from "./model-support.ts";
import { modelLookup } from "./tools.ts";

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
}

function entryView(config: BotLobbyConfig, kind: SettingsKind): EntryView {
  if (kind === "master") return config.master;
  if (kind === "scout") return { model: config.scout.model, timeoutMs: config.scout.timeoutMs };
  if (kind === "researcher") return config.researcher;
  return config.agents[kind];
}

interface EntryPatch {
  model?: string;
  thinking?: string;
  instructions?: string;
  timeoutMs?: number;
}

/** Apply a patch to one entry in a config copy; scouts ignore thinking and instructions. */
export function patchEntry(config: BotLobbyConfig, kind: SettingsKind, patch: EntryPatch): BotLobbyConfig {
  const next: BotLobbyConfig = { ...config, agents: { ...config.agents } };
  if (kind === "master") next.master = { ...config.master, ...patch } as AgentModelConfig;
  else if (kind === "scout") {
    next.scout = {
      model: patch.model ?? config.scout.model,
      timeoutMs: patch.timeoutMs ?? config.scout.timeoutMs,
    };
  } else if (kind === "researcher") next.researcher = { ...config.researcher, ...patch } as AgentModelConfig;
  else next.agents[kind] = { ...config.agents[kind], ...patch } as AgentModelConfig;
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
    else if (action === "timeout") await editTimeout(pi, ctx, kind);
    else if (action === "instructions") await editInstructions(pi, ctx, kind);
  }
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
  return `${view.model} · ${thinking}${limit}${custom}`;
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
    items.push({ value: "close", label: "Close" });
    const choice = await pick(ctx, "bot-lobby settings", items);
    if (!choice || choice === "close") return;
    await editEntry(pi, ctx, choice as SettingsKind);
  }
}
