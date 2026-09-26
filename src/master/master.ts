import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BotLobbyConfig } from "../schemas/configuration.ts";
import type { Domain } from "../schemas/agent.ts";
import type { AgentRun, ReviewResult, ScoutResult, WorkerResult } from "../schemas/findings.ts";
import { domainSpec } from "../agents/registry.ts";
import { runAgent, runParallel, watchdogOptions, type AgentRequest } from "../execution/agent-runner.ts";
import { spawnPiProcess, type ProcessRunner } from "../execution/pi-runner.ts";
import { readAgentKnowledge, writeFileEnsured } from "../knowledge/store.ts";
import { selectKnowledge, type KnowledgeSelection } from "../knowledge/selector.ts";
import { summarizeOutcomes } from "./synthesis.ts";
import { parseWorkerResult, validateWorkerResult } from "../roles/worker.ts";
import { parseReviewResult, validateReviewResult } from "../roles/reviewer.ts";
import { truncate } from "../text.ts";
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
  dataRoots: readonly string[];
  taskDir: string;
  config: BotLobbyConfig;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
}

/** Models are inherited from the session unless the config pins one. */
export function resolveModel(config: BotLobbyConfig, domain: Domain): string | undefined {
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
  const slices = readAgentKnowledge(request.dataRoots, domain);
  return {
    task: request.taskText,
    ...selectKnowledge(`${request.taskText} ${domainSpec(domain).scoutFocus}`, slices),
    instructions: request.config.agents[domain].instructions,
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
    ...watchdogOptions(request.config.workflow),
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

/** Re-read persisted scout findings for the given domains; the first dir with a file wins. */
export function loadScoutResults(taskDirs: string | readonly string[], domains: Domain[]): ScoutOutcome[] {
  const dirs = typeof taskDirs === "string" ? [taskDirs] : taskDirs;
  const outcomes: ScoutOutcome[] = [];
  for (const domain of domains) {
    const found = readScoutArtifact(dirs, domain);
    if (found) outcomes.push(found);
  }
  return outcomes;
}

function readScoutArtifact(dirs: readonly string[], domain: Domain): ScoutOutcome | undefined {
  for (const dir of dirs) {
    const path = scoutResultPath(dir, domain);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as ScoutOutcome;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface WorkerOutcome {
  result: WorkerResult;
  run: AgentRun;
  issues: string[];
}

export interface WorkerRequest {
  taskId: string;
  domain: Domain;
  /** What the Master wants implemented. */
  instruction: string;
  /** Requirements + approved objective + approved plan. */
  taskText: string;
  scoutOutcomes: ScoutOutcome[];
  cwd: string;
  dataRoots: readonly string[];
  config: BotLobbyConfig;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
}

function workerWorkflowContext(request: WorkerRequest): string {
  const spec = domainSpec(request.domain);
  const own = request.scoutOutcomes.filter(
    (outcome) => outcome.result.domain === request.domain && outcome.usable,
  );
  return [
    `Task state: implementing. Domain: ${request.domain}.`,
    `Domain boundary: ${spec.boundary}`,
    "Dependency policy: never add a dependency or make a significant architectural change yourself; list them under the matching output section and stop that part of the work.",
    own.length > 0
      ? `Scout findings for your domain:\n${summarizeOutcomes(own, 1500)}`
      : "No scout findings were collected for your domain; verify the repository yourself.",
  ].join("\n\n");
}

/** Delegate one implementation step to a domain worker. */
export async function runWorker(
  request: WorkerRequest,
  run: ProcessRunner = spawnPiProcess,
): Promise<WorkerOutcome> {
  const slices = readAgentKnowledge(request.dataRoots, request.domain);
  const selected = selectKnowledge(`${request.taskText} ${request.instruction}`, slices);
  const agentRun = await runAgent(
    {
      taskId: request.taskId,
      domain: request.domain,
      role: "worker",
      instruction: request.instruction,
      context: {
        task: request.taskText,
        ...selected,
        instructions: request.config.agents[request.domain].instructions,
        workflowContext: workerWorkflowContext(request),
      },
      model: resolveModel(request.config, request.domain),
      thinking: request.config.agents[request.domain].thinking,
      timeoutMs: request.config.workflow.agentTimeoutMs,
      cwd: request.cwd,
      signal: request.signal,
      onUpdate: request.onUpdate,
      ...watchdogOptions(request.config.workflow),
    },
    run,
  );
  const result = parseWorkerResult(request.domain, agentRun.output);
  const issues =
    agentRun.status === "success"
      ? validateWorkerResult(result)
      : [`worker ${agentRun.status}: ${agentRun.error ?? "no detail"}`];
  return { result, run: agentRun, issues };
}

export interface ReviewerOutcome {
  result: ReviewResult;
  run: AgentRun;
  issues: string[];
}

export interface ReviewerRequest {
  taskId: string;
  domain: Domain;
  taskText: string;
  workerSummary: string;
  scoutOutcomes: ScoutOutcome[];
  diff: string;
  instruction?: string;
  cwd: string;
  dataRoots: readonly string[];
  config: BotLobbyConfig;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
}

function reviewerContext(request: ReviewerRequest): string {
  const owns = request.scoutOutcomes.filter(
    (outcome) => outcome.result.domain === request.domain && outcome.usable,
  );
  return [
    `Task state: reviewing. Domain: ${request.domain}.`,
    "You may not modify implementation. Report required changes instead.",
    request.workerSummary ? `Worker summary:\n${truncate(request.workerSummary, 2000)}` : "No worker summary available.",
    owns.length > 0 ? `Scout findings:\n${summarizeOutcomes(owns, 1200)}` : "",
    `Repository changes:\n${request.diff}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

/** True when the output carries the reviewer contract's required heading. */
export function hasReviewVerdict(text: string): boolean {
  return /##\s*verdict/i.test(text);
}

/** A success without the Verdict section is off-contract and worth resampling. */
function isRetryableReviewRun(run: AgentRun): boolean {
  return run.status !== "cancelled" && (run.status !== "success" || !hasReviewVerdict(run.output));
}

function reviewerAgentRequest(request: ReviewerRequest, selected: KnowledgeSelection): AgentRequest {
  return {
    taskId: request.taskId,
    domain: request.domain,
    role: "reviewer",
    instruction:
      request.instruction?.trim() ||
      "Review the current repository changes against the approved requirements and plan.",
    context: {
      task: request.taskText,
      ...selected,
      instructions: request.config.agents[request.domain].instructions,
      workflowContext: reviewerContext(request),
    },
    model: resolveModel(request.config, request.domain),
    thinking: request.config.agents[request.domain].thinking,
    timeoutMs: request.config.workflow.agentTimeoutMs,
    cwd: request.cwd,
    signal: request.signal,
    onUpdate: request.onUpdate,
    ...watchdogOptions(request.config.workflow),
    retries: 0,
  };
}

function reviewerIssues(run: AgentRun, result: ReviewResult): string[] {
  return run.status === "success"
    ? validateReviewResult(result)
    : [`reviewer ${run.status}: ${run.error ?? "no detail"}`];
}

/** Independently review the current repository state for one domain. */
export async function runReviewer(
  request: ReviewerRequest,
  run: ProcessRunner = spawnPiProcess,
): Promise<ReviewerOutcome> {
  const selected = selectKnowledge(
    `${request.taskText} ${request.workerSummary}`,
    readAgentKnowledge(request.dataRoots, request.domain),
  );
  const agentRequest = reviewerAgentRequest(request, selected);
  const attempts = Math.max(1, request.config.workflow.maxAgentRetries + 1);
  let agentRun = await runAgent(agentRequest, run);
  for (let attempt = 2; attempt <= attempts && isRetryableReviewRun(agentRun); attempt++) {
    agentRun = await runAgent(agentRequest, run);
  }
  const result = parseReviewResult(request.domain, agentRun.output);
  return { result, run: agentRun, issues: reviewerIssues(agentRun, result) };
}
