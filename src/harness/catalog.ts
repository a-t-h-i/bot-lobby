/**
 * What Bot Lobby knows about each third-party harness: how to start it, which
 * models it serves and which effort levels each model takes.
 *
 * The model list is T3 Code's model manifest
 * (`apps/server/src/provider/model-manifest.json`), copied as is into
 * `model-manifest.json` next to this file; the effort descriptors and CLI
 * effort maps are read the way T3 Code's `ClaudeModelCatalog.ts` reads them.
 * The Antigravity launch details follow T3 Code's
 * `antigravityAuthSupport.ts` (`buildAntigravityAcpSpawnInput`).
 */
import { readFileSync } from "node:fs";
import { THINKING_LEVELS, type ThinkingLevelName } from "../schemas/configuration.ts";
import type { HarnessId, HarnessProtocol, HarnessSettings } from "../schemas/harness.ts";
import { tokenizeCliArgs } from "./cli-args.ts";

export interface HarnessInfo {
  id: HarnessId;
  label: string;
  protocol: HarnessProtocol;
  /** The command when the settings name no binary; empty when the user must give one. */
  command: string;
  /** Arguments that put the command into the mode Bot Lobby speaks (ACP), before the user's launch arguments. */
  args: readonly string[];
  /** The environment variable the home path setting sets. */
  homeEnv?: string;
  /** Model providers the settings offer (`value` "" keeps the harness's own). */
  providers: ReadonlyArray<{ value: string; label: string }>;
  /** Where the effort level goes: a CLI flag, the model variant (Antigravity) or the agent's own session option (ACP). */
  effort: "flag" | "variant" | "session";
  /** One line for the settings page. */
  blurb: string;
}

const WINDOWS = process.platform === "win32";

export const HARNESSES: Record<HarnessId, HarnessInfo> = {
  codex: {
    id: "codex",
    label: "Codex CLI",
    protocol: "codex-exec",
    command: "codex",
    args: [],
    homeEnv: "CODEX_HOME",
    providers: [
      { value: "", label: "Codex's own" },
      { value: "openai", label: "OpenAI" },
      { value: "ollama", label: "Ollama (local)" },
      { value: "lmstudio", label: "LM Studio (local)" },
    ],
    effort: "flag",
    blurb: "OpenAI's coding agent, run headless with codex exec.",
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    protocol: "claude-stream",
    command: "claude",
    args: [],
    homeEnv: "CLAUDE_CONFIG_DIR",
    providers: [
      { value: "", label: "Anthropic" },
      { value: "bedrock", label: "Amazon Bedrock" },
      { value: "vertex", label: "Google Vertex AI" },
    ],
    effort: "flag",
    blurb: "Anthropic's coding agent, run headless with claude -p.",
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity",
    protocol: "acp",
    command: WINDOWS ? "agy_acp_server.exe" : "agy_acp_server.par",
    args: process.platform === "linux" ? ["--uid="] : [],
    providers: [],
    effort: "variant",
    blurb: "Google's Antigravity agent through its ACP server, signed in with your Antigravity account.",
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    protocol: "acp",
    command: "gemini",
    args: ["--acp"],
    providers: [],
    effort: "session",
    blurb: "Google's Gemini CLI in ACP mode.",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    protocol: "acp",
    command: "opencode",
    args: ["acp"],
    providers: [],
    effort: "session",
    blurb: "OpenCode in ACP mode; models are named provider/model.",
  },
  acp: {
    id: "acp",
    label: "Custom ACP agent",
    protocol: "acp",
    command: "",
    args: [],
    providers: [],
    effort: "session",
    blurb: "Any agent that speaks the Agent Client Protocol: give its command and arguments.",
  },
};

/** The command and arguments one run starts, with the user's launch arguments last. */
export function harnessCommand(id: HarnessId, settings: HarnessSettings): { command: string; args: string[] } {
  const info = HARNESSES[id];
  return { command: settings.binaryPath || info.command, args: [...info.args, ...tokenizeCliArgs(settings.launchArgs)] };
}

export interface HarnessModel {
  id: string;
  label: string;
  /** False for the manifest's older models, listed after the current ones. */
  current: boolean;
  /** Effort levels (pi's names) the model takes; empty when the harness picks its own. */
  efforts: ThinkingLevelName[];
  /** The level the harness uses when none is chosen. */
  defaultEffort?: ThinkingLevelName;
  custom?: boolean;
}

interface ManifestModel {
  slug: string;
  name: string;
  status?: string;
  profile?: string;
}

interface ManifestOption {
  id: string;
  type?: string;
  options?: Array<{ id: string; isDefault?: boolean }>;
}

interface ManifestProfile {
  capabilities?: { optionDescriptors?: ManifestOption[] };
  adapter?: { claudeCode?: { effortMap?: Record<string, string | null> } };
}

interface Manifest {
  providers: Record<string, { models: ManifestModel[]; profiles?: Record<string, ManifestProfile> }>;
}

let manifest: Manifest | undefined;

function readManifest(): Manifest {
  manifest ??= JSON.parse(readFileSync(new URL("./model-manifest.json", import.meta.url), "utf8")) as Manifest;
  return manifest;
}

const MANIFEST_KEYS: Partial<Record<HarnessId, string>> = { codex: "codex", claude: "claudeAgent", antigravity: "antigravity" };

/** Codex's reasoning efforts, as T3 Code's `CodexProvider.ts` labels them. */
const CODEX_EFFORTS: ThinkingLevelName[] = ["minimal", "low", "medium", "high", "xhigh"];

const isLevel = (value: string): value is ThinkingLevelName => (THINKING_LEVELS as readonly string[]).includes(value);

function claudeEfforts(profile: ManifestProfile | undefined): { efforts: ThinkingLevelName[]; defaultEffort?: ThinkingLevelName } {
  const option = profile?.capabilities?.optionDescriptors?.find((entry) => entry.id === "effort");
  if (!option?.options) return { efforts: [] };
  const map = profile?.adapter?.claudeCode?.effortMap ?? {};
  const efforts = option.options.map((entry) => entry.id).filter((id): id is ThinkingLevelName => isLevel(id) && map[id] !== null);
  const fallback = option.options.find((entry) => entry.isDefault)?.id;
  return { efforts, ...(fallback && isLevel(fallback) ? { defaultEffort: fallback } : {}) };
}

/** Antigravity sells one model per effort (`…-flash-high`); the settings show one model with an effort slider. */
const VARIANT = /^(.*)-(low|medium|high)$/;
const VARIANT_LABEL = / \((Low|Medium|High)\)$/;

function antigravityModels(models: ManifestModel[]): HarnessModel[] {
  const families = new Map<string, HarnessModel>();
  const out: HarnessModel[] = [];
  for (const model of models) {
    const match = VARIANT.exec(model.slug);
    if (!match) {
      out.push({ id: model.slug, label: model.name, current: model.status === "current", efforts: [] });
      continue;
    }
    const [, base, level] = match as unknown as [string, string, ThinkingLevelName];
    let family = families.get(base);
    if (!family) {
      family = { id: base, label: model.name.replace(VARIANT_LABEL, ""), current: model.status === "current", efforts: [], defaultEffort: "high" };
      families.set(base, family);
      out.push(family);
    }
    family.efforts.push(level);
  }
  for (const family of families.values()) family.efforts.sort((a, b) => THINKING_LEVELS.indexOf(a) - THINKING_LEVELS.indexOf(b));
  return out;
}

/** The models a harness offers: the manifest's current ones, its older ones, then the ones typed into settings. */
export function harnessModels(id: HarnessId, settings: HarnessSettings): HarnessModel[] {
  const key = MANIFEST_KEYS[id];
  const entry = key ? readManifest().providers[key] : undefined;
  let models: HarnessModel[] = [];
  if (entry && id === "antigravity") models = antigravityModels(entry.models);
  else if (entry) {
    models = entry.models.map((model) => {
      const efforts = id === "codex" ? { efforts: CODEX_EFFORTS, defaultEffort: "medium" as const } : claudeEfforts(model.profile ? entry.profiles?.[model.profile] : undefined);
      return { id: model.slug, label: model.name, current: model.status === "current", ...efforts };
    });
  }
  models.sort((a, b) => Number(b.current) - Number(a.current));
  const known = new Set(models.map((model) => model.id));
  const fallbackEfforts = id === "codex" ? CODEX_EFFORTS : id === "claude" ? (["low", "medium", "high", "xhigh", "max"] as ThinkingLevelName[]) : [];
  for (const custom of settings.customModels) {
    if (!known.has(custom)) models.push({ id: custom, label: custom, current: true, efforts: fallbackEfforts, custom: true });
  }
  return models;
}

/** The nearest level at or below `level` that `efforts` holds, else the lowest one above it. */
export function nearestEffort(efforts: readonly ThinkingLevelName[], level: string): ThinkingLevelName | undefined {
  if (efforts.length === 0) return undefined;
  const at = THINKING_LEVELS.indexOf(isLevel(level) ? level : "medium");
  const below = efforts.filter((effort) => THINKING_LEVELS.indexOf(effort) <= at);
  return below.length > 0 ? below[below.length - 1] : efforts[0];
}

/**
 * What the harness is told for an agent's effort: Codex's `model_reasoning_effort`,
 * Claude Code's `--effort` (through the model's effort map) or Antigravity's
 * model variant. Undefined leaves it to the harness (and to ACP session options).
 */
export function harnessEffort(id: HarnessId, settings: HarnessSettings, model: string, level: string): string | undefined {
  const info = HARNESSES[id];
  if (info.effort === "session") return undefined;
  const known = harnessModels(id, settings).find((entry) => entry.id === model);
  if (id === "codex") return nearestEffort(known?.efforts.length ? known.efforts : CODEX_EFFORTS, level);
  if (id === "claude") {
    const efforts = known?.efforts.length ? known.efforts : (["low", "medium", "high", "xhigh", "max"] as ThinkingLevelName[]);
    const chosen = nearestEffort(efforts, level);
    if (!chosen) return undefined;
    const key = MANIFEST_KEYS.claude!;
    const manifestModel = readManifest().providers[key]?.models.find((entry) => entry.slug === model);
    const profile = manifestModel?.profile ? readManifest().providers[key]?.profiles?.[manifestModel.profile] : undefined;
    const mapped = profile?.adapter?.claudeCode?.effortMap?.[chosen];
    return typeof mapped === "string" ? mapped : chosen;
  }
  return known?.efforts.length ? nearestEffort(known.efforts, level) : undefined;
}

/** The model id a run passes to the harness: Antigravity's variant slug carries the effort. */
export function harnessModelId(id: HarnessId, settings: HarnessSettings, model: string, level: string): string {
  if (!model || HARNESSES[id].effort !== "variant") return model;
  const effort = harnessEffort(id, settings, model, level);
  return effort ? `${model}-${effort}` : model;
}
