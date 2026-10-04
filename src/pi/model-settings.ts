/**
 * What the settings page writes to the config, in one place: a profile entry
 * patched into a config copy, the master's model and thinking applied to the
 * live session, the subagents pinned to the session model, and the
 * classifier's one-line summary.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  INHERIT_MODEL,
  isThinkingLevel,
  SUBAGENT_KINDS,
  type AgentModelConfig,
  type BotLobbyConfig,
  type SubagentKind,
} from "../schemas/configuration.ts";
import { modelLookup } from "./tools.ts";
import { describeKey, jevEndpoint, type StatusSource } from "../classifier/hosts.ts";

/** One settings entry: the master or a subagent profile. */
export type SettingsKind = "master" | SubagentKind;
export const SETTINGS_KINDS: readonly SettingsKind[] = ["master", ...SUBAGENT_KINDS];

/** The editable fields of one entry; scouts have no thinking and no instructions of their own. */
export interface EntryView {
  model: string;
  thinking?: string;
  instructions?: string;
  timeoutMs?: number;
}

export function entryView(config: BotLobbyConfig, kind: SettingsKind): EntryView {
  if (kind === "master") return config.master;
  if (kind === "scout") return { model: config.scout.model, timeoutMs: config.scout.timeoutMs };
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
}

/** Apply a patch to one entry in a config copy; scouts ignore thinking and instructions. */
export function patchEntry(config: BotLobbyConfig, kind: SettingsKind, patch: EntryPatch): BotLobbyConfig {
  const next: BotLobbyConfig = { ...config, agents: { ...config.agents } };
  if (kind === "master") next.master = { ...config.master, ...patch } as AgentModelConfig;
  else if (kind === "scout") next.scout = { model: patch.model ?? config.scout.model, timeoutMs: patch.timeoutMs ?? config.scout.timeoutMs };
  else if (kind === "researcher") next.researcher = { ...config.researcher, ...patch } as AgentModelConfig;
  else if (kind === "quickfix") next.quickFix = { ...config.quickFix, ...patch } as AgentModelConfig;
  else if (kind === "planner") next.planner = { ...config.planner, ...patch } as AgentModelConfig;
  else next.agents[kind] = { ...config.agents[kind], ...patch } as AgentModelConfig;
  return next;
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

/** `on · OpenCode Zen · jev-1.13-free · key stored in pi`, for the settings menu and `/bot-lobby config`. */
export function classifierSummary(config: BotLobbyConfig, status: StatusSource | undefined): string {
  const { host, model } = jevEndpoint(config.classifier, status);
  const via = config.classifier.provider === "auto" ? `${host.label} (auto)` : host.label;
  return [config.classifier.enabled ? "on" : "off", via, model, `key ${describeKey(host, status)}`].join(" · ");
}

