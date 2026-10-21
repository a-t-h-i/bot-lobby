/**
 * Third-party coding harnesses (Codex CLI, Claude Code, ACP agents such as
 * Antigravity, Gemini CLI and OpenCode) that a subagent can run on instead of
 * pi. The oracle always stays on pi: Bot Lobby is a pi extension, so the
 * workflow, knowledge and compaction live there. A harness only replaces the
 * process one subagent step runs in, with our role prompt injected into it.
 *
 * The per-harness fields follow T3 Code's provider settings
 * (`packages/contracts/src/settings.ts`: binary path, home path, launch
 * arguments, custom models, auto-compact window).
 */

/** Harnesses a subagent can run on; `pi` (absent in the config) is the built-in default. */
export const HARNESS_IDS = ["codex", "claude", "antigravity", "gemini", "opencode", "acp"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === "string" && (HARNESS_IDS as readonly string[]).includes(value);
}

/** How Bot Lobby talks to a harness. */
export type HarnessProtocol = "codex-exec" | "claude-stream" | "acp";

export interface HarnessSettings {
  /** The executable; empty uses the harness's usual command on PATH. */
  binaryPath: string;
  /** Extra arguments, shell-quoted, passed on every run (for a custom ACP agent: the arguments that start it). */
  launchArgs: string;
  /** Codex's CODEX_HOME or Claude Code's CLAUDE_CONFIG_DIR; empty keeps the harness's own. */
  homePath: string;
  /** Who serves the models: Codex's `model_provider` (or `ollama`/`lmstudio` for local models), Claude Code's `anthropic`/`bedrock`/`vertex`; empty keeps the harness's own. */
  modelProvider: string;
  /** Compact the agent's context after this many tokens; 0 keeps the harness's own threshold. */
  compactAt: number;
  /** Put Bot Lobby's role prompt (the agent's instructions, knowledge and report format) into the harness; off sends the task alone. */
  injectPrompts: boolean;
  /** Model ids typed in by hand, listed after the harness's own. */
  customModels: string[];
  /** Antigravity's `localharness_external` next to its ACP server (ANTIGRAVITY_HARNESS_PATH); empty when the server finds it itself. */
  harnessPath: string;
}

export const DEFAULT_HARNESS_SETTINGS: HarnessSettings = {
  binaryPath: "",
  launchArgs: "",
  homePath: "",
  modelProvider: "",
  compactAt: 0,
  injectPrompts: true,
  customModels: [],
  harnessPath: "",
};

export type HarnessesConfig = Record<HarnessId, HarnessSettings>;

export function defaultHarnesses(): HarnessesConfig {
  return Object.fromEntries(HARNESS_IDS.map((id) => [id, { ...DEFAULT_HARNESS_SETTINGS, customModels: [] as string[] }])) as unknown as HarnessesConfig;
}

/** Smallest and largest compaction threshold a harness accepts, in tokens. */
export const HARNESS_COMPACT_MIN = 10_000;
export const HARNESS_COMPACT_MAX = 2_000_000;

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function compactAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(HARNESS_COMPACT_MAX, Math.max(HARNESS_COMPACT_MIN, Math.round(value)));
}

function modelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry.length > 0 && entry.length <= 200 && !/\s/.test(entry)))];
}

function normalizeHarness(value: unknown): HarnessSettings {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const base = DEFAULT_HARNESS_SETTINGS;
  return {
    binaryPath: text(source.binaryPath, base.binaryPath),
    launchArgs: text(source.launchArgs, base.launchArgs),
    homePath: text(source.homePath, base.homePath),
    modelProvider: text(source.modelProvider, base.modelProvider),
    compactAt: compactAt(source.compactAt),
    injectPrompts: source.injectPrompts !== false,
    customModels: modelIds(source.customModels),
    harnessPath: text(source.harnessPath, base.harnessPath),
  };
}

export function normalizeHarnesses(value: unknown): HarnessesConfig {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(HARNESS_IDS.map((id) => [id, normalizeHarness(source[id])])) as HarnessesConfig;
}

/** An agent entry's harness fields: absent for pi, else the harness and its model (empty: the harness's default). */
export interface HarnessChoice {
  harness?: HarnessId;
  harnessModel?: string;
}

export function harnessChoiceFields(entry: { harness?: unknown; harnessModel?: unknown }): HarnessChoice {
  if (!isHarnessId(entry.harness)) return {};
  const model = text(entry.harnessModel, "");
  return { harness: entry.harness, ...(model ? { harnessModel: model } : {}) };
}

/** Everything one run on a harness needs from the settings. */
export interface HarnessRun {
  id: HarnessId;
  /** Empty: the harness's own default model. */
  model: string;
  settings: HarnessSettings;
}

/** The harness an agent entry runs on, with that harness's settings; undefined for pi. */
export function harnessRunOf(entry: HarnessChoice, harnesses: HarnessesConfig): HarnessRun | undefined {
  if (!entry.harness) return undefined;
  return { id: entry.harness, model: entry.harnessModel ?? "", settings: harnesses[entry.harness] };
}
