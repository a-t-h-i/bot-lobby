import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DevHouseConfig } from "../schemas/configuration.ts";
import type { Domain } from "../schemas/agent.ts";
import type { AgentRun, ScoutResult } from "../schemas/findings.ts";
import { domainSpec } from "../agents/registry.ts";
import { runParallel, type AgentRequest } from "../execution/agent-runner.ts";
import { spawnPiProcess, type ProcessRunner } from "../execution/pi-runner.ts";
import { readAgentKnowledge, writeFileEnsured } from "../knowledge/store.ts";
import { selectKnowledge } from "../knowledge/selector.ts";
import { isScoutResultUsable, parseScoutResult, validateScoutResult } from "../roles/scout.ts";

export interface ScoutOutcome {
  result: ScoutResult;
  run: AgentRun;
  issues: string[];
  usable: boolean;
}

export interface ScoutRequest {
  taskId: string;
  /** Requirements/objective text used for context selection. */
  taskText: string;
  /** What the Master wants investigated. */
  instruction: string;
  domains: Domain[];
  cwd: string;
  dataRoot: string;
  taskDir: string;
  config: DevHouseConfig;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
}

/** Models are inherited from the session unless the config pins one. */
export function resolveModel(config: DevHouseConfig, domain: Domain): string | undefined {
  const model = config.agents[domain].model;
  return model === "inherit" ? undefined : model;
}

function scoutInstruction(request: ScoutRequest, domain: Domain): string {
  return [
    request.instruction,
    "",
    `Domain focus: ${domainSpec(domain).scoutFocus}.`,
    "Investigate the repository and report structured findings. Do not modify any file.",
  ].join("\n");
}

function scoutContext(request: ScoutRequest, domain: Domain): AgentRequest["context"] {
  const slices = readAgentKnowledge(request.dataRoot, domain);
  return {
    task: request.taskText,
    ...selectKnowledge(`${request.taskText} ${domainSpec(domain).scoutFocus}`, slices),
    workflowContext: `Task state: scouting. Domain: ${domain}. Read-only reconnaissance; no implementation.`,
  };
}

function toOutcome(run: AgentRun, domain: Domain): ScoutOutcome {
  if (run.status !== "success") {
    return {
      result: parseScoutResult(domain, run.output),
      run,
      issues: [`scout ${run.status}: ${run.error ?? "no detail"}`],
      usable: false,
    };
  }
  const result = parseScoutResult(domain, run.output);
  return { result, run, issues: validateScoutResult(result), usable: isScoutResultUsable(result) };
}

/** Run the selected domain scouts concurrently and persist their findings. */
export async function runScouts(request: ScoutRequest, run: ProcessRunner = spawnPiProcess): Promise<ScoutOutcome[]> {
  const requests: AgentRequest[] = request.domains.map((domain) => ({
    taskId: request.taskId,
    domain,
    role: "scout",
    instruction: scoutInstruction(request, domain),
    context: scoutContext(request, domain),
    model: resolveModel(request.config, domain),
    thinking: request.config.agents[domain].thinking,
    timeoutMs: request.config.workflow.agentTimeoutMs,
    cwd: request.cwd,
    signal: request.signal,
    onUpdate: request.onUpdate,
  }));
  const runs = await runParallel(requests, request.config.workflow.maxParallelScouts, run);
  const outcomes = runs.map((agentRun) => toOutcome(agentRun, agentRun.domain));
  saveScoutResults(request.taskDir, outcomes);
  return outcomes;
}
export function scoutResultPath(taskDir: string, domain: Domain): string {
  return join(taskDir, `scout-${domain}.json`);
}

export function saveScoutResults(taskDir: string, outcomes: ScoutOutcome[]): void {
  for (const outcome of outcomes) {
    writeFileEnsured(scoutResultPath(taskDir, outcome.result.domain), JSON.stringify(outcome, null, 2));
  }
}

/** Re-read persisted scout findings for the given domains. */
export function loadScoutResults(taskDir: string, domains: Domain[]): ScoutOutcome[] {
  const outcomes: ScoutOutcome[] = [];
  for (const domain of domains) {
    const path = scoutResultPath(taskDir, domain);
    if (!existsSync(path)) continue;
    try {
      outcomes.push(JSON.parse(readFileSync(path, "utf8")) as ScoutOutcome);
    } catch {
      // Corrupted scout artifact: skip it rather than failing the workflow.
    }
  }
  return outcomes;
}
