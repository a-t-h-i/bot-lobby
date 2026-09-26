import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  agentProfile,
  isThinkingLevel,
  THINKING_LEVELS,
  type BotLobbyConfig,
  type ProfileResolver,
  type SubagentKind,
  type ThinkingLevelName,
} from "../schemas/configuration.ts";

/** Find a model by `provider/id` (or bare id); undefined when the registry does not know it. */
export type ModelLookup = (ref: string) => Model<Api> | undefined;

export type { ProfileResolver };

/** `provider/id` for a model, the form settings store. */
export function modelRef(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

/** Thinking levels a model supports, in pi's order; every level when the model is unknown. */
export function supportedThinking(model: Model<Api> | undefined): ThinkingLevelName[] {
  if (!model) return [...THINKING_LEVELS];
  return getSupportedThinkingLevels(model).filter((level): level is ThinkingLevelName => isThinkingLevel(level));
}

export interface ThinkingCheck {
  /** The level to run at: the requested one, or pi's nearest supported level. */
  level: string;
  /** Set when the requested level had to change. */
  warning?: string;
}

/** Clamp `level` to what `model` supports, explaining any change; unknown models pass through. */
export function checkThinking(model: Model<Api> | undefined, level: string): ThinkingCheck {
  if (!model || !isThinkingLevel(level)) return { level };
  const clamped = clampThinkingLevel(model, level as ModelThinkingLevel);
  if (clamped === level) return { level };
  return { level: clamped, warning: `"${level}" thinking isn't supported by ${modelRef(model)} — using "${clamped}"` };
}

const LABELS: Record<SubagentKind | "master", string> = {
  master: "Master",
  designer: "Designer",
  backend: "Backend",
  qa: "QA",
  scout: "Scout",
  researcher: "Researcher",
};

export function kindLabel(kind: SubagentKind | "master"): string {
  return LABELS[kind];
}

export interface ResolverOptions {
  lookup: ModelLookup;
  /** The session's model as `provider/id`; used only where settings name no model yet. */
  sessionModel?: string;
  /** Receives each distinct clamp warning once per process. */
  warn?: (message: string) => void;
}

const warned = new Set<string>();

/**
 * Profiles straight from settings, with the thinking level clamped to what
 * each model supports. A subagent whose model is still unset runs on the
 * session's model (named explicitly on the command line) until settings pin one.
 */
export function createProfileResolver(config: BotLobbyConfig, options: ResolverOptions): ProfileResolver {
  return (domain, role) => {
    const profile = agentProfile(config, domain, role);
    const model = profile.model ?? options.sessionModel;
    const check = checkThinking(model ? options.lookup(model) : undefined, profile.thinking);
    if (check.warning) {
      const message = `bot-lobby: ${kindLabel(profile.kind)} — ${check.warning}. Change it in /bot-lobby settings.`;
      if (!warned.has(message)) {
        warned.add(message);
        options.warn?.(message);
      }
    }
    return { ...profile, model, thinking: check.level };
  };
}

/** Every configured subagent whose thinking level its model does not support, for `/bot-lobby config`. */
export function thinkingMismatches(config: BotLobbyConfig, lookup: ModelLookup, sessionModel?: string): string[] {
  const entries: Array<[SubagentKind | "master", string, string]> = [
    ["master", config.master.model, config.master.thinking],
    ["designer", config.agents.designer.model, config.agents.designer.thinking],
    ["backend", config.agents.backend.model, config.agents.backend.thinking],
    ["qa", config.agents.qa.model, config.agents.qa.thinking],
    ["researcher", config.researcher.model, config.researcher.thinking],
  ];
  return entries.flatMap(([kind, ref, level]) => {
    const model = ref === "inherit" ? sessionModel : ref;
    const check = checkThinking(model ? lookup(model) : undefined, level);
    return check.warning ? [`${kindLabel(kind)}: ${check.warning}`] : [];
  });
}
