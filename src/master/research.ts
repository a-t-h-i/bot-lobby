import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Domain } from "../schemas/agent.ts";
import { profileFor, type BotLobbyConfig, type ProfileResolver } from "../schemas/configuration.ts";
import type { AgentRun, ResearchResult } from "../schemas/findings.ts";
import { runAgent, watchdogOptions, type AgentRequest } from "../execution/agent-runner.ts";
import { spawnPiProcess, type ProcessRunner } from "../execution/pi-runner.ts";
import { writeFileEnsured } from "../knowledge/store.ts";
import { isResearchResultUsable, parseResearchResult, validateResearchResult } from "../roles/researcher.ts";

export interface ResearchOutcome {
  result: ResearchResult;
  run: AgentRun;
  issues: string[];
  usable: boolean;
}

export interface ResearchRequest {
  taskId: string;
  /** Domain whose model, thinking level, and prompt layers the researcher reuses. */
  domain: Domain;
  /** The question or topic the Master wants researched. */
  instruction: string;
  cwd: string;
  taskDir: string;
  config: BotLobbyConfig;
  profile?: ProfileResolver;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
}

export function researchResultPath(taskDir: string, domain: Domain): string {
  return join(taskDir, `research-${domain}.json`);
}

export function saveResearchResult(taskDir: string, outcome: ResearchOutcome): void {
  writeFileEnsured(researchResultPath(taskDir, outcome.result.domain), JSON.stringify(outcome, null, 2));
}

/** Re-read persisted research reports for the given domains. */
export function loadResearchResults(taskDir: string, domains: Domain[]): ResearchOutcome[] {
  const outcomes: ResearchOutcome[] = [];
  for (const domain of domains) {
    const path = researchResultPath(taskDir, domain);
    if (!existsSync(path)) continue;
    try {
      outcomes.push(JSON.parse(readFileSync(path, "utf8")) as ResearchOutcome);
    } catch {
      // Corrupted research artifact: skip it rather than failing the workflow.
    }
  }
  return outcomes;
}

function researchContext(request: ResearchRequest): AgentRequest["context"] {
  return {
    task: request.instruction,
    instructions: request.config.agents[request.domain].instructions,
    workflowContext: `Task state: research requested by the Master. Domain: ${request.domain}. Read-only; report cited findings only.`,
  };
}

function toOutcome(run: AgentRun, domain: Domain): ResearchOutcome {
  if (run.status !== "success") {
    return {
      result: parseResearchResult(domain, run.output),
      run,
      issues: [`research ${run.status}: ${run.error ?? "no detail"}`],
      usable: false,
    };
  }
  const result = parseResearchResult(domain, run.output);
  return { result, run, issues: validateResearchResult(result), usable: isResearchResultUsable(result) };
}

/** Run the researcher for one domain and persist its report for audit. */
export async function runResearch(request: ResearchRequest, run: ProcessRunner = spawnPiProcess): Promise<ResearchOutcome> {
  const profile = profileFor(request.config, request.profile, request.domain, "researcher");
  const agentRun = await runAgent(
    {
      taskId: request.taskId,
      domain: request.domain,
      role: "researcher",
      instruction: request.instruction,
      context: researchContext(request),
      model: profile.model,
      thinking: profile.thinking,
      timeoutMs: profile.timeoutMs,
      cwd: request.cwd,
      signal: request.signal,
      onUpdate: request.onUpdate,
      ...watchdogOptions(request.config.workflow),
    },
    run,
  );
  const outcome = toOutcome(agentRun, agentRun.domain);
  saveResearchResult(request.taskDir, outcome);
  return outcome;
}
