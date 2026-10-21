/**
 * Runs one subagent step on a third-party harness instead of pi. The caller
 * sees the same `PiRunResult` and stream events either way, so the workflow,
 * the lobby feed and the edit log do not care which harness did the work.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activityWord } from "../pi/activity.ts";
import { roleSpec } from "../roles/registry.ts";
import type { HarnessRun } from "../schemas/harness.ts";
import { shortDuration } from "../text.ts";
import type { PiRunOptions, PiRunResult } from "../execution/pi-runner.ts";
import { acpDriver } from "./acp.ts";
import { HARNESSES, harnessCommand, harnessEffort, harnessModelId } from "./catalog.ts";
import { claudeArgs, claudeDriver } from "./claude.ts";
import { codexArgs, codexDriver } from "./codex.ts";
import { acpPromptWithInstructions, harnessInstructions } from "./instructions.ts";
import { runHarnessProcess, type HarnessDriver, type HarnessIO, type HarnessOutcome, type HarnessProcessOptions, type HarnessSpawn } from "./process.ts";
import { loadClaudeSdk, runClaudeSdk } from "./claude-sdk.ts";

/** What one run is allowed to do, from its role's pi tool allowlist (absent: everything). */
export interface HarnessAccess {
  writes: boolean;
  shell: boolean;
  web: boolean;
  tools?: readonly string[];
  /** Bot Lobby's tools come over MCP (the oracle bridge): an ACP agent may call them. */
  mcp?: boolean;
}

export function accessOf(tools: readonly string[] | undefined): HarnessAccess {
  if (!tools) return { writes: true, shell: true, web: true };
  return {
    writes: tools.includes("edit") || tools.includes("write"),
    shell: tools.includes("bash"),
    web: tools.some((tool) => tool === "web_search" || tool === "fetch_content" || tool === "web_fetch"),
    tools,
  };
}

/** One run's harness, model, effort and instructions, resolved from the settings. */
export interface HarnessPlan {
  harness: HarnessRun;
  /** The id the harness is given; empty leaves its default. */
  model: string;
  /** The harness's own effort value, when it takes one on the command line. */
  effort?: string;
  /** The agent's effort level in pi's names (ACP agents match it against their options). */
  level: string;
  instructions: string;
  autoCompact?: boolean;
  /** The MCP server that hands the harness pi's tools (the oracle bridge); its own tools are then switched off where it allows. */
  mcp?: HarnessMcp;
}

/** One stdio MCP server, as each harness's MCP config takes it. */
export interface HarnessMcp {
  name: string;
  command: string;
  args: string[];
}

/** What the stream told us, filled in by the driver. */
export interface HarnessCollector {
  text: string;
  usage: { input: number; output: number; cost: number; turns: number };
  model?: string;
  session?: string;
  error?: string;
  warning?: string;
  stopReason?: string;
  addUsage(input: number, output: number, cost: number, model?: string): void;
  /** The agent's words and reasoning as they come, for the oracle bridge. */
  onDelta?(kind: "text" | "thinking", text: string): void;
}

export function collector(): HarnessCollector {
  const out: HarnessCollector = {
    text: "",
    usage: { input: 0, output: 0, cost: 0, turns: 0 },
    addUsage(input, output, cost, model) {
      out.usage.input += input;
      out.usage.output += output;
      out.usage.cost += cost;
      out.usage.turns += 1;
      if (model) out.model = model;
    },
  };
  return out;
}

export function planHarnessRun(options: Pick<PiRunOptions, "systemPrompt" | "thinking" | "autoCompact" | "agent"> & { harness: HarnessRun; bridged?: boolean }): HarnessPlan {
  const { harness } = options;
  const level = options.thinking ?? "medium";
  const effort = harnessEffort(harness.id, harness.settings, harness.model, level);
  const model = harnessModelId(harness.id, harness.settings, harness.model, level);
  const contract = options.agent ? roleSpec(options.agent.role).contract : undefined;
  return {
    harness,
    model,
    ...(effort && HARNESSES[harness.id].effort === "flag" ? { effort } : {}),
    level,
    instructions: harnessInstructions({ harness, ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}), ...(contract ? { contract } : {}), ...(effort ? { effort } : {}), ...(options.bridged ? { bridged: true } : {}) }),
    ...(options.autoCompact === false ? { autoCompact: false } : {}),
  };
}

/** Starts one run and resolves when it ends: a harness process, or Claude Code through the Agent SDK. */
export type HarnessStart = (collected: HarnessCollector, options: HarnessProcessOptions) => Promise<HarnessOutcome>;

/** How one run starts; Claude Code goes through the Agent SDK when it is installed, else its CLI. */
export function harnessLaunch(plan: HarnessPlan, options: Pick<PiRunOptions, "cwd" | "env"> & { prompt: string; access: HarnessAccess }, promptFile: () => string): HarnessStart {
  const launched = processLaunch(plan, options, promptFile);
  const fromProcess: HarnessStart = (collected, watch) => runHarnessProcess(launched.spawn, watch, (io) => launched.driver(io, collected));
  if (HARNESSES[plan.harness.id].protocol !== "claude-stream") return fromProcess;
  return async (collected, watch) => {
    const query = await loadClaudeSdk();
    if (!query) return fromProcess(collected, watch);
    return runClaudeSdk(query, plan, options.access, { cwd: options.cwd, env: launched.spawn.env, launchArgs: launched.launchArgs, prompt: options.prompt }, collected, watch);
  };
}

/** The process to start and the driver that speaks to it. */
function processLaunch(plan: HarnessPlan, options: Pick<PiRunOptions, "cwd" | "env"> & { prompt: string; access: HarnessAccess }, promptFile: () => string): { spawn: HarnessSpawn; launchArgs: string[]; driver: (io: HarnessIO, collected: HarnessCollector) => HarnessDriver } {
  const { id, settings } = plan.harness;
  const info = HARNESSES[id];
  const { command, args: launchArgs } = harnessCommand(id, settings);
  if (!command) throw new Error(`${info.label} has no command yet: set it in Settings > Harnesses`);
  const { access } = options;
  const env: Record<string, string | undefined> = { ...process.env, ...options.env };
  if (info.homeEnv && settings.homePath) env[info.homeEnv] = settings.homePath;
  if (id === "antigravity" && settings.harnessPath) env.ANTIGRAVITY_HARNESS_PATH = settings.harnessPath;
  const task = options.prompt;
  if (info.protocol === "codex-exec") {
    const built = codexArgs(plan, access, launchArgs);
    const prompt = built.promptPrefix ? acpPromptWithInstructions(task, built.promptPrefix) : task;
    return { spawn: { command, args: built.args, cwd: options.cwd, env }, launchArgs, driver: (io, collected) => codexDriver(io, plan, prompt, collected) };
  }
  if (info.protocol === "claude-stream") {
    const built = claudeArgs(plan, access, launchArgs, plan.instructions ? promptFile() : undefined);
    return { spawn: { command, args: built.args, cwd: options.cwd, env: { ...env, ...built.env } }, launchArgs, driver: (io, collected) => claudeDriver(io, task, collected) };
  }
  const prompt = acpPromptWithInstructions(task, plan.instructions);
  return { spawn: { command, args: launchArgs, cwd: options.cwd, env }, launchArgs, driver: (io, collected) => acpDriver(io, plan, prompt, collected, access, options.cwd) };
}

function toResult(collected: HarnessCollector, outcome: HarnessOutcome, aborted: boolean, options: PiRunOptions, label: string): PiRunResult {
  const base = { output: collected.text, usage: collected.usage, ...(collected.model ? { model: collected.model } : {}) };
  if (outcome.stalled) return { ...base, status: "timeout", stalled: true, error: `stalled: no output for ${shortDuration(options.stallTimeoutMs ?? 0)}` };
  if (outcome.killed || aborted || collected.stopReason === "aborted") return { ...base, status: "cancelled", error: "agent was cancelled" };
  if (outcome.spawnError) return { ...base, status: "failed", error: `${label}: ${outcome.spawnError}` };
  if (collected.error) return { ...base, status: "failed", error: `${label}: ${collected.error}` };
  if (outcome.exitCode !== 0 && !collected.text.trim()) {
    const detail = collected.warning ?? lastLines(outcome.stderr);
    return { ...base, status: "failed", error: `${label}: ${detail || `exited with code ${outcome.exitCode}`}` };
  }
  if (!collected.text.trim()) return { ...base, status: "failed", error: `${label}: the agent produced no usable output${collected.warning ? ` (${collected.warning})` : ""}` };
  return { ...base, status: "success" };
}

function lastLines(text: string): string {
  return text.trim().split("\n").slice(-3).join(" ").slice(0, 400);
}

/** Run one subagent step on its harness and normalise the outcome like a pi run. */
export async function runHarnessAgent(options: PiRunOptions & { harness: HarnessRun }): Promise<PiRunResult> {
  const empty = { status: "cancelled" as const, output: "", usage: { input: 0, output: 0, cost: 0, turns: 0 } };
  if (options.signal?.aborted) return empty;
  const plan = planHarnessRun(options);
  const label = HARNESSES[plan.harness.id].label;
  let dir: string | undefined;
  const promptFile = () => {
    dir ??= mkdtempSync(join(tmpdir(), "bot-lobby-harness-"));
    const file = join(dir, "instructions.md");
    writeFileSync(file, plan.instructions, { encoding: "utf8", mode: 0o600 });
    return file;
  };
  try {
    let start: HarnessStart;
    try {
      start = harnessLaunch(plan, { cwd: options.cwd, ...(options.env ? { env: options.env } : {}), prompt: `Task: ${options.task}`, access: accessOf(options.tools) }, promptFile);
    } catch (error) {
      return { ...empty, status: "failed", error: (error as Error).message };
    }
    const collected = collector();
    const outcome = await start(collected, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.stallTimeoutMs !== undefined ? { stallTimeoutMs: options.stallTimeoutMs } : {}),
      ...(options.toolStallTimeoutMs !== undefined ? { toolStallTimeoutMs: options.toolStallTimeoutMs } : {}),
      ...(options.onStart ? { onStart: options.onStart } : {}),
      onEvent: (event) => {
        if (event.type === "tool_execution_start") options.onActivity?.(activityWord(event.toolName));
        options.onEvent?.(event);
      },
    });
    return toResult(collected, outcome, options.signal?.aborted === true, options, label);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
