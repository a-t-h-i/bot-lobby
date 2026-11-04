/**
 * Which installed coding agent runs the Orchestrator: the one Settings names
 * (`master.harness`), else the first installed in this order. Only Claude
 * Code can host it today; the others are named here so the order is in one place.
 */
import { harnessCommand, harnessEffort, harnessModelId } from "../harness/catalog.ts";
import { findCommand } from "../harness/status.ts";
import { tokenizeCliArgs } from "../harness/cli-args.ts";
import type { BotLobbyConfig } from "../schemas/configuration.ts";
import type { HarnessId } from "../schemas/harness.ts";
import type { OrchestratorDriver } from "./host.ts";
import { claudeDriver } from "./drivers/claude.ts";

export const ORCHESTRATOR_ORDER: readonly HarnessId[] = ["claude", "codex", "gemini", "opencode", "antigravity"];

/** Harnesses that can host the Orchestrator now (others still run workers). */
const CAN_ORCHESTRATE: ReadonlySet<HarnessId> = new Set(["claude"]);

export function installedHarness(config: BotLobbyConfig, id: HarnessId): string | undefined {
  const { command } = harnessCommand(id, config.harnesses[id]);
  return command ? findCommand(command) : undefined;
}

/** The Orchestrator's harness, or undefined when no suitable one is installed. */
export function pickOrchestrator(config: BotLobbyConfig): HarnessId | undefined {
  const named = config.master.harness;
  const order = named ? [named, ...ORCHESTRATOR_ORDER.filter((id) => id !== named)] : ORCHESTRATOR_ORDER;
  return order.find((id) => CAN_ORCHESTRATE.has(id) && installedHarness(config, id));
}

export function orchestratorDriver(config: BotLobbyConfig, cwd: string): OrchestratorDriver | undefined {
  const id = pickOrchestrator(config);
  if (!id) return undefined;
  const settings = config.harnesses[id];
  const command = installedHarness(config, id)!;
  const master = config.master;
  const model = harnessModelId(id, settings, master.harnessModel ?? "", master.thinking);
  const effort = harnessEffort(id, settings, master.harnessModel ?? "", master.thinking);
  const launchArgs = [...tokenizeCliArgs(settings.launchArgs)];
  const env: Record<string, string | undefined> = {};
  if (settings.homePath) env.CLAUDE_CONFIG_DIR = settings.homePath;
  if (settings.modelProvider === "bedrock") env.CLAUDE_CODE_USE_BEDROCK = "1";
  if (settings.modelProvider === "vertex") env.CLAUDE_CODE_USE_VERTEX = "1";
  return claudeDriver({ command, cwd, ...(model ? { model } : {}), ...(effort ? { effort } : {}), launchArgs, env });
}
