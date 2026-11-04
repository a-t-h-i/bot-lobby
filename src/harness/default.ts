/**
 * The coding agent a step runs on when its settings name none: the first
 * installed of Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity.
 * pi is gone, so there is no built-in fallback.
 */
import { loadConfig } from "../state/project.ts";
import type { BotLobbyConfig } from "../schemas/configuration.ts";
import type { HarnessId, HarnessRun } from "../schemas/harness.ts";
import { harnessCommand } from "./catalog.ts";
import { findCommand } from "./status.ts";

export const DEFAULT_ORDER: readonly HarnessId[] = ["claude", "codex", "gemini", "opencode", "antigravity"];

export const NO_HARNESS = "No coding agent found. Install Claude Code, Codex, Gemini CLI or OpenCode.";

export function defaultHarness(config: BotLobbyConfig = loadConfig()): HarnessRun | undefined {
  const id = DEFAULT_ORDER.find((candidate) => {
    const { command } = harnessCommand(candidate, config.harnesses[candidate]);
    return Boolean(command && findCommand(command));
  });
  return id ? { id, model: "", settings: config.harnesses[id] } : undefined;
}
