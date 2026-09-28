import { realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { BotLobbyConfig, ProfileResolver } from "../schemas/configuration.ts";
import type { AgentRun, Pushback, ResearchResult, ReviewResult, WorkerResult } from "../schemas/findings.ts";
import {
  MAX_RUN_LOG,
  MAX_WORKER_RECORDS,
  TASK_STATES,
  TERMINAL_STATES,
  taskRequest,
  type Approval,
  type ApprovalKind,
  type Task,
  type TaskState,
  type WorkerRunRecord,
} from "../schemas/task.ts";
import { isDomain, type Domain } from "../schemas/agent.ts";
import { transition } from "../state/task-state.ts";
import { ownerlessTask, readTaskArtifact, removeTaskScratchpads, saveTask, selectTask, taskDirFor, taskReadDirs } from "../state/persistence.ts";
import { dataRoot, readDataRoots } from "../state/project.ts";
import { appendCompletedTask, appendDecision, applyKnowledge, readFileOr, writeFileEnsured, type KnowledgeKind } from "../knowledge/store.ts";
import { compactKnowledgeFile, overThreshold } from "../knowledge/compactor.ts";
import { knowledgeDir, type KnowledgeAgent } from "../knowledge/paths.ts";
import { writeScratchpad } from "../state/persistence.ts";
import { spawnPiProcess, type ProcessRunner } from "../execution/pi-runner.ts";
import { mapConcurrent } from "../execution/agent-runner.ts";
import { parseWorkerResult } from "../roles/worker.ts";
import { autoNote, DESK_TOOLS, DeskSession } from "../desk/session.ts";
import type { Handover } from "../desk/desk.ts";
import { changedFiles, commitBefore, headCommit, readRepositoryDiff } from "../execution/git.ts";
import { appendChange, explainChanges, provenanceLines, provenanceSummary, readChanges, type FileProvenance } from "../state/changes.ts";
import { budgetLine, budgetState, formatMinutes, MIN_READ_MS, parseMinutes, qaAllotment, readBudget, readerAllotment, updateBudget, workerAllotment, type Allotment, type BudgetState, type TaskBudget } from "../state/budget.ts";
import type { AgentTime } from "../execution/agent-runner.ts";
import {
  loadScoutResults,
  runReviewer,
  runScouts,
  runWorker,
  type ReviewerOutcome,
  type ReviewerRequest,
  type ScoutOutcome,
  type WorkerOutcome,
  type WorkerRequest,
} from "../master/master.ts";
import { researchResultPath, runResearch, type ResearchOutcome, type ResearchRequest } from "../master/research.ts";
import { assessReconnaissance, completionBlockers, decideReviewLoop, recordDecision } from "../master/decisions.ts";
import { detectSharedFiles, summarizeOutcomes } from "../master/synthesis.ts";
import { tail, truncate } from "../text.ts";
import { isAutoMode } from "../state/auto.ts";
import { assertNoPendingApprovals, pendingApprovals, requestApproval, resolveApproval } from "./approvals.ts";
import { pingApproval } from "../pi/notify.ts";
import { describeRun, runLogEntry } from "../pi/run-summary.ts";
import { nextStates } from "./transitions.ts";
import type { FileHinter } from "../classifier/files.ts";
import type { Classifier } from "../classifier/classifier.ts";
import type { EffortRouter } from "../classifier/effort.ts";
import { answerClarify } from "../classifier/triage.ts";
import { appendMetrics, metricFromRun } from "../state/metrics.ts";
import { markCommentsAddressed, pendingComments, readPlanComments } from "../state/comments.ts";

export const ORCHESTRATE_ACTIONS = [
  "clarify",
  "scout",
  "research",
  "propose",
  "plan",
  "implement",
  "resolve_approval",
  "qa",
  "knowledge",
  "compact",
  "complete",
  "block",
  "resume",
  "decide",
  "budget",
  "status",
  "cancel",
] as const;
export type OrchestrateAction = (typeof ORCHESTRATE_ACTIONS)[number];

/** Actions that claim an ownerless task for the calling session; status/cancel/resolve_approval never do. */
export const CLAIM_ACTIONS: ReadonlySet<OrchestrateAction> = new Set(
  ORCHESTRATE_ACTIONS.filter((action) => action !== "status" && action !== "cancel" && action !== "resolve_approval"),
);

export interface OrchestrateParams {
  action: OrchestrateAction;
  taskId?: string;
  question?: string;
  options?: string[];
  domains?: string[];
  instruction?: string;
  proposal?: string;
  concerns?: string[];
  plan?: string;
  domain?: string;
  /** implement: the concrete instruction for the worker. */
  task?: string;
  /** implement: several domains at once, run in parallel through the file desk. */
  assignments?: Array<{ domain: string; task: string; minutes?: number }>;
  /** implement: minutes the step may take under the task's time budget; budget: extra minutes to ask the user for. */
  minutes?: number;
  /** knowledge: which persistent file the text belongs to. */
  kind?: KnowledgeKind;
  /** compact: the knowledge file being rewritten. */
  file?: string;
  approvalId?: string;
  decision?: "approved" | "rejected";
  note?: string;
  reason?: string;
  text?: string;
}

export interface WorkflowDeps {
  root: string;
  configDir: string;
  cwd: string;
  /** The pi session driving this workflow; task ownership is skipped when absent (tests, headless use). */
  sessionId?: string;
  config: BotLobbyConfig;
  /** Per-run model/thinking/time limit, clamped to each model; plain settings when absent. */
  profile?: ProfileResolver;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
  ask: (question: string) => Promise<string | undefined>;
  choose: (title: string, options: string[]) => Promise<string | undefined>;
  notify: (message: string, level?: "info" | "warning" | "error") => void;
  runProcess?: ProcessRunner;
  /** Likely files for scouts and workers, while the classifier's file hints are on. */
  hints?: FileHinter;
  /** Answers a clarify question whose recommended option is clearly right, when it is on. */
  classifier?: Classifier;
  /** Re-reads a request after an amendment (the task's triage), when the classifier is on. */
  triage?: (request: string, signal?: AbortSignal) => Promise<Task["triage"]>;
  /** Lowers thinking or the model for scouts and workers on steps the classifier judges simple or trivial. */
  effort?: EffortRouter;
}

export interface WorkflowResult {
  ok: boolean;
  taskId: string;
  state: TaskState;
  message: string;
  /** Subagent runs that finished during this action, oldest first. */
  runs?: AgentRun[];
}

export type ApprovalChoice = "approve" | "amend" | "decline";
export const APPROVAL_OPTIONS = ["Approve", "Amend", "Decline"];

const PLAN_REQUIREMENTS: Array<[string, RegExp]> = [
  ["objective", /objective|goal/i],
  ["affected domains", /domains?/i],
  ["files/areas", /files?|areas?|modules?/i],
  ["implementation sequence", /sequence|steps|order/i],
  ["dependencies", /dependenc/i],
  ["testing strategy", /test/i],
  ["acceptance criteria", /acceptance|criteria/i],
  ["rollback/failure", /rollback|failure|revert/i],
  ["review requirements", /review/i],
];

/** §12: the internal plan must cover every required area. */
export function validatePlan(plan: string): string[] {
  return PLAN_REQUIREMENTS.filter(([, pattern]) => !pattern.test(plan)).map(([label]) => label);
}

/** A user-facing proposal must be a short `- ` bullet list so the user can scan it. */
export const MAX_PROPOSAL_CHARS = 1200;
export function validateProposal(proposal: string): string[] {
  const lines = proposal.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const issues: string[] = [];
  if (lines.length === 0) issues.push("proposal is empty");
  if (lines.some((line) => !line.startsWith("- "))) issues.push("every proposal line must be a \`- \` bullet");
  if (proposal.length > MAX_PROPOSAL_CHARS) issues.push(`proposal is too long (> ${MAX_PROPOSAL_CHARS} chars)`);
  return issues;
}

function requireState(task: Task, allowed: TaskState[]): void {
  if (!allowed.includes(task.state)) {
    throw new Error(`action not allowed in state "${task.state}" (expected: ${allowed.join(", ")})`);
  }
}

function deriveDomains(values: string[] | undefined): Domain[] {
  const domains = (values ?? []).map((value) => value.trim().toLowerCase()).filter((value) => isDomain(value));
  if (domains.length === 0) throw new Error("scout requires at least one of: designer, backend, qa");
  return [...new Set(domains)];
}

function parseDomain(value: string | undefined, action: string): Domain {
  const domain = value?.trim().toLowerCase();
  if (!domain || !isDomain(domain)) throw new Error(`${action} requires domain: designer, backend, or qa`);
  return domain;
}

export function describeTask(task: Task): string {
  const lines = [
    `${task.id} — state: ${task.state}${task.paused ? " (paused)" : ""}`,
    `Title: ${task.title}`,
    `Request: ${truncate(taskRequest(task), 200)}`,
    task.domains.length > 0 ? `Domains: ${task.domains.join(", ")}` : "",
    `Review iterations: ${Object.entries(task.reviewIterations).map(([d, n]) => `${d}=${n}`).join(", ")}`,
    pendingApprovals(task).length > 0
      ? `Pending approvals: ${pendingApprovals(task).map((a) => `${a.id} ${a.kind} for ${a.domain}: ${truncate(a.detail, 120)}`).join("; ")}`
      : "",
    task.blockers.length > 0 ? `Blockers: ${task.blockers.map((b) => b.reason).join("; ")}` : "",
    `Next legal states: ${nextStates(task.state).join(", ")}`,
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

/** Knowledge files past the compaction threshold, for status reporting. */
export function describeOversizedKnowledge(dataRoots: readonly string[], threshold: number): string[] {
  return overThreshold(dataRoots, threshold).map((entry) => `${entry.agent}/${entry.file} (${entry.chars} chars)`);
}

/**
 * Why the user is not asked on this task, if they are not: auto mode drives
 * it unattended, and a plan the user agreed in the planning panel needs no
 * second approval.
 */
export function unattendedReason(task: Task, auto: boolean): "auto mode" | "approved plan" | undefined {
  if (auto) return "auto mode";
  if (task.approvedPlan) return "approved plan";
  return undefined;
}

/** Apply the user's approve/amend/decline decision to an awaiting-approval task. */
export function applyApprovalChoice(task: Task, choice: ApprovalChoice, amendment?: string): string {
  requireState(task, ["awaiting_approval"]);
  if (choice === "approve") {
    transition(task, "planning");
    return "Proposal approved. Write the detailed internal plan and call action=plan.";
  }
  if (choice === "decline") {
    transition(task, "abandoned");
    return "Proposal declined; the task is abandoned.";
  }
  const text = amendment?.trim();
  if (!text) throw new Error("amend requires the amendment text");
  task.amendments.push(text);
  return `Amendment recorded: ${text}\nRe-evaluate the affected findings, update the proposal, and call action=propose again.`;
}

function scoutReport(outcomes: ScoutOutcome[], verifying: boolean): string {
  const assessment = assessReconnaissance(outcomes);
  const pushbacks = outcomes.map((outcome) => pushbackLine(outcome.result.pushback, outcome.result.domain)).filter(Boolean);
  const shared = detectSharedFiles(outcomes);
  return [
    verifying ? "Targeted verification results:" : "Scout results:",
    "",
    summarizeOutcomes(outcomes),
    "",
    `Usable reconnaissance: ${assessment.usableDomains.join(", ") || "none"}`,
    shared.length > 0
      ? `Files reported by multiple domains: ${shared.map((entry) => `${entry.path} (${entry.domains.join("/")})`).join(", ")}`
      : "",
    assessment.warnings.length > 0 ? `Gaps to verify: ${assessment.warnings.join("; ")}` : "",
    pushbacks.length > 0 ? `Pushbacks recorded: ${pushbacks.join("; ")}` : "",
    verifying
      ? "Use this to confirm or correct the claim, then continue with action=propose."
      : "Next: synthesize these findings, target-verify anything important, then call action=propose.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

async function handleClarify(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["created", "clarifying"]);
  const question = params.question?.trim();
  if (!question) throw new Error("clarify requires a question");
  transition(task, "clarifying");
  const settled = await clarifyByClassifier(task, question, params.options ?? [], deps);
  if (settled) {
    recordDecision(task, `Answered by the classifier (${settled.probability.toFixed(2)}): ${truncate(question, 300)} → ${settled.answer}`);
    return `Answered by the classifier with your recommended option (${settled.probability.toFixed(2)}): ${settled.answer}. It is recorded as a decision; mention it in your proposal so the user can amend it, and continue.`;
  }
  const unattended = unattendedReason(task, isAutoMode(deps.root, deps.configDir, task.id));
  if (unattended) {
    recordDecision(task, `Not asked (${unattended}): ${truncate(question, 300)}`);
    return `${unattended === "auto mode" ? "Auto mode is on, so nobody will answer." : "The user agreed this plan in the planning panel."} Do not ask the user: answer this yourself from the request${task.approvedPlan ? ", the agreed plan" : ""} and your reconnaissance, say what you decided in your proposal, and continue.\n\nQuestion: ${question}`;
  }
  const answer = params.options?.length ? await deps.choose(question, params.options) : await deps.ask(question);
  if (answer === undefined) {
    return `No answer captured. Ask the user this in your reply, then continue.\n\nQuestion: ${question}`;
  }
  return `User answered: ${answer}`;
}

/** The classifier's answer to a clarify question with options, when the request already settles it. */
async function clarifyByClassifier(task: Task, question: string, options: readonly string[], deps: WorkflowDeps): Promise<{ answer: string; probability: number } | undefined> {
  if (!deps.classifier || options.length < 2) return undefined;
  const notes = [
    ...task.amendments.map((text) => `Amendment: ${text}`),
    ...task.decisions.slice(-12).map((decision) => `Decision: ${decision.text}`),
  ].join("\n");
  try {
    return await answerClarify(deps.classifier, question, options, { request: taskRequest(task), notes, ...(task.proposal ? { proposal: task.proposal } : {}) }, deps.signal);
  } catch {
    return undefined;
  }
}

async function handleScout(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["created", "clarifying", "scouting", "synthesizing"]);
  const domains = deriveDomains(params.domains);
  if (task.state === "created") transition(task, "clarifying");
  if (task.state === "clarifying") transition(task, "scouting");
  const verifying = task.state === "synthesizing";
  const instruction = params.instruction?.trim() || "Investigate this request and report findings the Master needs.";
  const time = readerTime(task, deps, "SCOUTS", instruction, SCOUT_SHARE, deps.config.scout.timeoutMs, "scouting");
  const outcomes = await runScouts(
    {
      taskId: task.id,
      taskText: taskRequest(task),
      instruction,
      ...(time ? { time } : {}),
      domains,
      cwd: deps.cwd,
      dataRoots: readDataRoots(deps.root, deps.configDir),
      taskDir: taskDirFor(deps.root, deps.configDir, task.id),
      config: deps.config,
      profile: deps.profile,
      signal: deps.signal,
      onUpdate: deps.onUpdate,
      ...(deps.hints ? { hints: deps.hints } : {}),
      ...(deps.effort ? { effort: deps.effort } : {}),
    },
    deps.runProcess ?? spawnPiProcess,
  );
  if (time) settleAllotment(task, deps, time.id, "finished");
  if (!verifying) transition(task, "synthesizing");
  const involved = outcomes.filter((outcome) => outcome.usable).map((outcome) => outcome.result.domain);
  task.domains = [...new Set([...task.domains, ...involved])];
  recordAdvisoryPushbacks(task, outcomes.map((outcome) => ({ pushback: outcome.result.pushback, who: outcome.result.domain })));
  return scoutReport(outcomes, verifying);
}

/** Research is evidence gathering, so it is legal in every non-terminal state. */
const RESEARCH_STATES: TaskState[] = TASK_STATES.filter((state) => !TERMINAL_STATES.includes(state));

const RESEARCH_DEGRADED =
  "The researcher is spawned with read-only repository tools plus web_search, fetch_content, source_check and get_search_content. If pi-web-access is not installed, the pi CLI silently ignores those tool names, so research degrades to repository-only and cannot cite the internet.";

function bulletSection(label: string, items: string[], limit: number): string {
  if (items.length === 0) return "";
  const bullets = items.slice(0, limit).map((item) => `- ${truncate(item, 300)}`);
  return `${label}:\n${bullets.join("\n")}`;
}

function sourceSection(result: ResearchResult): string {
  if (result.sources.length === 0) return "";
  const lines = result.sources.slice(0, 12).map(
    (source) =>
      `- ${source.url}${source.title ? ` — ${truncate(source.title, 160)}` : ""}${source.date ? ` (${source.date})` : ""}`,
  );
  return `Sources:\n${lines.join("\n")}`;
}

function researchLogEntry(domain: Domain, outcome: ResearchOutcome): string {
  const { result, run, issues, usable } = outcome;
  return [
    `## ${new Date().toISOString()} — ${domain} (${run.status}${usable ? "" : ", unusable"})`,
    result.question ? `Question: ${result.question}` : "",
    bulletSection("Findings", result.findings, 20),
    sourceSection(result),
    bulletSection("Unverified", result.unverified, 10),
    `Confidence: ${result.confidence}`,
    issues.length > 0 ? `Issues: ${issues.join("; ")}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function appendResearchLog(taskDir: string, domain: Domain, outcome: ResearchOutcome): void {
  const path = join(taskDir, "research.md");
  const existing = readFileOr(path).trimEnd();
  const entry = [existing, researchLogEntry(domain, outcome)].filter(Boolean).join("\n\n");
  writeFileEnsured(path, `${entry}\n`);
}

function researchReport(outcome: ResearchOutcome, artifact: string): string {
  const { result, run, issues, usable } = outcome;
  if (run.status !== "success" || !usable) {
    return [
      `No usable cited research report (run ${run.status}).`,
      RESEARCH_DEGRADED,
      run.error ? `Error: ${run.error}` : "",
      issues.length > 0 ? `Issues: ${issues.join("; ")}` : "",
      `Artifact: ${artifact}`,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }
  return [
    `Research for ${result.domain} (confidence: ${result.confidence})`,
    `Question: ${truncate(result.question, 400)}`,
    bulletSection("Findings", result.findings, 12),
    sourceSection(result),
    bulletSection("Unverified", result.unverified, 8),
    `Artifact: ${artifact}`,
    pushbackLine(result.pushback, result.domain),
    "Research is evidence only: it is not injected into worker, reviewer, or QA prompts, and nothing enters persistent knowledge until you record it with action=knowledge.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function researchRequestFor(
  deps: WorkflowDeps,
  task: Task,
  domain: Domain,
  instruction: string,
  taskDir: string,
  time?: AgentTime,
): ResearchRequest {
  return {
    taskId: task.id,
    domain,
    instruction,
    ...(time ? { time } : {}),
    config: deps.config,
    profile: deps.profile,
    cwd: deps.cwd,
    taskDir,
    signal: deps.signal,
    onUpdate: deps.onUpdate,
  };
}

async function handleResearch(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, RESEARCH_STATES);
  const domain = parseDomain(params.domain, "research");
  const instruction = params.instruction?.trim();
  if (!instruction) throw new Error("research requires instruction (the question to investigate)");
  const taskDir = taskDirFor(deps.root, deps.configDir, task.id);
  const time = readerTime(task, deps, "RESEARCH", instruction, RESEARCH_SHARE, deps.config.researcher.timeoutMs ?? deps.config.workflow.agentTimeoutMs, "research");
  const outcome = await runResearch(researchRequestFor(deps, task, domain, instruction, taskDir, time), deps.runProcess ?? spawnPiProcess);
  if (time) settleAllotment(task, deps, time.id, "finished");
  appendResearchLog(taskDir, domain, outcome);
  recordAdvisoryPushbacks(task, [{ pushback: outcome.result.pushback, who: domain }]);
  return researchReport(outcome, researchResultPath(taskDir, domain));
}

async function handlePropose(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["created", "clarifying", "synthesizing", "awaiting_approval"]);
  const proposal = params.proposal?.trim();
  if (!proposal) throw new Error("propose requires a proposal");
  const proposalIssues = validateProposal(proposal);
  if (proposalIssues.length > 0) throw new Error(`proposal must be a concise bullet list: ${proposalIssues.join("; ")}`);
  if (task.state === "created") transition(task, "clarifying");
  if (task.state === "clarifying") transition(task, "awaiting_approval");
  task.proposal = proposal;
  writeFileEnsured(join(taskDirFor(deps.root, deps.configDir, task.id), "proposal.md"), proposal);
  // A new proposal answers any lobby comments left on the previous one.
  if (!task.plan) addressComments(task, deps);
  for (const concern of params.concerns ?? []) recordDecision(task, `Concern: ${concern}`);
  transition(task, "awaiting_approval");
  if (!deps.config.workflow.requireApprovalForFeatures) return applyApprovalChoice(task, "approve");
  const unattended = unattendedReason(task, isAutoMode(deps.root, deps.configDir, task.id));
  if (unattended) {
    recordDecision(task, `Proposal approved without asking (${unattended}).`);
    return `${applyApprovalChoice(task, "approve")} (No approval needed: ${unattended === "auto mode" ? "auto mode is on" : `the user agreed this plan in the planning panel (${task.approvedPlan})`}.)`;
  }
  const choice = await deps.choose(`Approve this proposal?\n\n${truncate(proposal, 2000)}`, APPROVAL_OPTIONS);
  if (!choice) return `Awaiting approval. Present the proposal to the user and continue after they respond.\n\n${proposal}`;
  const lower = choice.toLowerCase();
  if (lower.startsWith("approve")) return applyApprovalChoice(task, "approve");
  if (lower.startsWith("decline")) return applyApprovalChoice(task, "decline");
  const result = applyApprovalChoice(task, "amend", await deps.ask("What should change?"));
  await retriage(task, deps);
  return result;
}

/** After an amendment, the classifier reads the request again, so the Master's hints follow the change. */
async function retriage(task: Task, deps: WorkflowDeps): Promise<void> {
  if (!deps.triage || !task.triage) return;
  try {
    const next = await deps.triage([taskRequest(task), ...task.amendments.map((text) => `Amendment: ${text}`)].join("\n\n"), deps.signal);
    if (next) task.triage = next;
  } catch {
    // Hints only: the old triage stays.
  }
}

/** States in which `plan` replaces an approved plan instead of recording the first one. */
const AMEND_PLAN_STATES: readonly TaskState[] = ["implementing", "reviewing"];

/** Mark the user's outstanding lobby comments on this task as addressed; returns how many. */
function addressComments(task: Task, deps: WorkflowDeps): number {
  const pending = pendingComments(readPlanComments(deps.root, deps.configDir, task.id));
  if (pending.length > 0) markCommentsAddressed(deps.root, deps.configDir, task.id, pending.map((comment) => comment.id));
  return pending.length;
}

function commentsNote(count: number): string {
  return count > 0 ? ` ${count} lobby comment${count === 1 ? "" : "s"} marked addressed.` : "";
}

/**
 * Record the internal plan while planning, or amend it later (for example when
 * the user comments on it from the lobby): an amendment replaces the plan and
 * keeps the task where it is, so finished steps stay done.
 */
function handlePlan(task: Task, params: OrchestrateParams, deps: WorkflowDeps): string {
  requireState(task, ["planning", ...AMEND_PLAN_STATES]);
  const plan = params.plan?.trim();
  if (!plan) throw new Error("plan requires the plan text");
  const missing = validatePlan(plan);
  if (missing.length > 0) throw new Error(`plan is missing: ${missing.join(", ")}`);
  const amending = AMEND_PLAN_STATES.includes(task.state);
  task.plan = plan;
  writeFileEnsured(join(taskDirFor(deps.root, deps.configDir, task.id), "plan.md"), plan);
  const addressed = addressComments(task, deps);
  if (amending) {
    recordDecision(task, `Plan amended${addressed > 0 ? ` for ${addressed} user comment${addressed === 1 ? "" : "s"}` : ""}.`);
    return `Plan amended.${commentsNote(addressed)} Next: continue with action=implement for the next open step (or action=qa when the work is complete).`;
  }
  return `Plan recorded.${commentsNote(addressed)} Next: call action=implement with domain and task for the first step.`;
}

/** Record approvals a worker asked for; auto-approve when config allows it. */
function recordWorkerApprovals(task: Task, outcome: WorkerOutcome, config: BotLobbyConfig, auto = false): Approval[] {
  const created: Approval[] = [];
  const kinds: Array<[ApprovalKind, string, string[], boolean]> = [
    ["dependency", "dependencies", outcome.result.dependencyNeeds, config.workflow.requireApprovalForDependencies],
    ["architecture", "architecture changes", outcome.result.architectureChanges, config.workflow.requireApprovalForArchitectureChanges],
  ];
  for (const [kind, label, items, required] of kinds) {
    for (const detail of items) {
      // Auto mode has nobody to ask: the request is approved and recorded where the user can review it.
      if (required && auto) recordDecision(task, `Auto-approved ${label} (auto mode): ${detail}`, outcome.result.domain);
      else if (required) {
        created.push(requestApproval(task, kind, outcome.result.domain, detail));
        pingApproval(outcome.result.domain, detail);
      } else recordDecision(task, `Auto-approved ${label}: ${detail}`, outcome.result.domain);
    }
  }
  return created;
}

/** One line naming a pushback for a report, or "" when there is none. */
function pushbackLine(pushback: Pushback | undefined, who: string): string {
  if (!pushback) return "";
  const alternative = pushback.alternative ? ` (alternative: ${truncate(pushback.alternative, 160)})` : "";
  return `${who} pushed back on ${truncate(pushback.request, 160)}: ${truncate(pushback.reason, 240)}${alternative}`;
}

/** Record a worker pushback as a pending approval that blocks its domain until the oracle resolves it. */
function recordPushback(task: Task, outcome: WorkerOutcome): Approval | undefined {
  const pushback = outcome.result.pushback;
  if (!pushback) return undefined;
  const detail = `${truncate(pushback.request, 160)} — ${truncate(pushback.reason, 240)}`;
  const approval = requestApproval(task, "pushback", outcome.result.domain, detail);
  pingApproval(outcome.result.domain, detail);
  recordDecision(task, pushbackLine(pushback, outcome.result.domain), outcome.result.domain);
  return approval;
}

/** Record advisory pushbacks from read-only roles; they inform the oracle but never gate work. */
function recordAdvisoryPushbacks(task: Task, entries: Array<{ pushback?: Pushback; who: string }>): void {
  for (const { pushback, who } of entries) {
    if (pushback) recordDecision(task, pushbackLine(pushback, who));
  }
}

function workerReport(outcome: WorkerOutcome, approvals: Approval[], pushback?: Approval): string {
  const { result, run, issues } = outcome;
  const objection = result.pushback;
  return [
    `Worker ${result.domain}: ${run.status}${run.error ? ` (${run.error})` : ""}`,
    result.completed ? `Completed: ${truncate(result.completed, 1200)}` : "",
    result.filesChanged.length > 0
      ? `Files changed:\n${result.filesChanged.map((file) => `- ${file.path} — ${file.change}`).join("\n")}`
      : "",
    result.verification ? `Verification: ${truncate(result.verification, 600)}` : "",
    result.blockers.length > 0
      ? `Blocked: ${result.blockers.map((blocker) => `${blocker.reason} (need: ${blocker.need})`).join("; ")}`
      : "",
    approvals.length > 0
      ? `Approvals required before more ${result.domain} work: ${approvals.map((a) => `${a.id} ${a.kind}: ${a.detail}`).join("; ")}. Resolve with action=resolve_approval.`
      : "",
    result.knowledgeProposals.length > 0
      ? `Knowledge proposals (accept with action=knowledge, or ignore): ${result.knowledgeProposals.map((proposal) => `${proposal.kind}: ${truncate(proposal.content, 160)}`).join("; ")}`
      : "",
    issues.length > 0 ? `Issues: ${issues.join("; ")}` : "",
    pushback && objection
      ? `Pushback recorded (${pushback.id}): ${truncate(objection.reason, 240)}. Resolve with action=resolve_approval before re-delegating ${result.domain}.`
      : "",
    "Next: inspect the diff, then run action=qa once this domain's work is complete.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function updateScratchpad(deps: WorkflowDeps, task: Task, outcome: WorkerOutcome): void {
  const dir = taskDirFor(deps.root, deps.configDir, task.id);
  const domain = outcome.result.domain;
  const existing = (readTaskArtifact(deps.root, deps.configDir, task.id, `${domain}.md`) ?? "").replace(/^#\s.*\n/, "").trim();
  const entry = [
    `### ${outcome.run.finishedAt ?? outcome.run.startedAt}`,
    outcome.result.completed || outcome.run.error || "no summary",
    ...outcome.result.filesChanged.map((file) => `- ${file.path}: ${file.change}`),
  ].join("\n");
  writeScratchpad(dir, domain, [existing, entry].filter(Boolean).join("\n\n"), deps.config.knowledge);
}

/** Plan sections a reader must never lose to a cut: what the work is for, and how it is judged. */
const KEEP_PLAN_SECTIONS = /objective|goal|acceptance|criteria|testing|tests?\b/i;

/**
 * The plan within `budget` characters: whole when it fits; otherwise the
 * objective, acceptance criteria and testing sections whole (a head cut used
 * to drop them, as they come last), then the others in order while they fit,
 * naming any left out.
 */
export function planWithin(plan: string, budget: number): string {
  if (plan.length <= budget) return plan;
  const sections = plan.split(/\n(?=#{1,4}\s)/);
  const keep = sections.map((section) => KEEP_PLAN_SECTIONS.test(section.split("\n")[0] ?? ""));
  let used = sections.reduce((total, section, index) => total + (keep[index] ? section.length + 1 : 0), 0);
  const chosen = sections.map((section, index) => {
    if (keep[index]) return true;
    if (used + section.length + 1 > budget) return false;
    used += section.length + 1;
    return true;
  });
  const left = sections.filter((_, index) => !chosen[index]).map((section) => (section.split("\n")[0] ?? "").replace(/^#+\s*/, "").trim() || "preamble");
  const text = sections.filter((_, index) => chosen[index]).join("\n");
  const note = left.length > 0 ? `\n\n[Left out for length: ${left.join(", ")}. The whole plan is plan.md in the task folder.]` : "";
  return `${truncate(text, budget)}${note}`;
}

function workerTaskText(task: Task, planBudget = 6000): string {
  return [
    `Requirements: ${taskRequest(task)}`,
    task.proposal ? `Approved objective: ${task.proposal}` : "",
    task.plan ? `Approved plan:\n${planWithin(task.plan, planBudget)}` : "",
    task.amendments.length > 0 ? `User amendments:\n${task.amendments.map((entry) => `- ${entry}`).join("\n")}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function workerRequest(deps: WorkflowDeps, task: Task, domain: Domain, instruction: string, time?: AgentTime): WorkerRequest {
  return {
    ...(time ? { time } : {}),
    taskId: task.id,
    domain,
    instruction,
    taskText: workerTaskText(task),
    scoutOutcomes: loadScoutResults(taskReadDirs(deps.root, deps.configDir, task.id), [domain]),
    cwd: deps.cwd,
    dataRoots: readDataRoots(deps.root, deps.configDir),
    config: deps.config,
    profile: deps.profile,
    signal: deps.signal,
    onUpdate: deps.onUpdate,
    ...(deps.hints ? { hints: deps.hints } : {}),
    ...(deps.effort ? { effort: deps.effort } : {}),
  };
}

/** Remember a worker delegation so the checklist replays it after a reload. */
function recordWorkerRun(task: Task, run: AgentRun): void {
  const record: WorkerRunRecord = {
    runId: run.runId,
    domain: run.domain,
    instruction: run.instruction ?? "",
    status: run.status,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
  };
  task.workerRuns = [...(task.workerRuns ?? []), record].slice(-MAX_WORKER_RECORDS);
}

interface Assignment {
  domain: Domain;
  instruction: string;
  /** Minutes the oracle gave the step, under a time budget. */
  minutes?: number;
}

/** The delegation as a list: `assignments` for a parallel batch, otherwise the single domain/task. */
function parseAssignments(params: OrchestrateParams): Assignment[] {
  if (params.assignments && params.assignments.length > 0) {
    const list = params.assignments.map((entry) => {
      const instruction = entry.task?.trim();
      if (!instruction) throw new Error("every assignment needs a task (what to implement)");
      return { domain: parseDomain(entry.domain, "implement"), instruction, ...(entry.minutes ? { minutes: entry.minutes } : {}) };
    });
    const domains = list.map((entry) => entry.domain);
    if (new Set(domains).size !== domains.length) throw new Error("parallel assignments need distinct domains (one worker per domain)");
    return list;
  }
  const domain = parseDomain(params.domain, "implement");
  const instruction = params.task?.trim();
  if (!instruction) throw new Error("implement requires task (what to implement)");
  return [{ domain, instruction, ...(params.minutes ? { minutes: params.minutes } : {}) }];
}

/**
 * What the working tree held when this task's agents started: the QA gate
 * reads those files as pre-existing. Taken before the first worker only, so
 * a task already under way when provenance arrived is not misread.
 */
async function takeBaseline(task: Task, deps: WorkflowDeps): Promise<void> {
  if (task.baseline || (task.workerRuns?.length ?? 0) > 0) return;
  const [tree, head] = await Promise.all([treeChanges(deps), headCommit(deps.cwd)]);
  task.baseline = { at: new Date().toISOString(), files: tree?.files ?? [], ...(head ? { head } : {}) };
}

/**
 * The commit the task's work is measured from: HEAD when its first worker
 * started, or, for a task begun before that was recorded, the newest commit
 * before the task was created. Work committed since then is still the task's
 * to review; a diff against HEAD alone showed it as nothing.
 */
async function reviewBase(task: Task, deps: WorkflowDeps): Promise<string | undefined> {
  return task.baseline?.head ?? (await commitBefore(deps.cwd, task.createdAt));
}

/** bot-lobby's own records, relative to the working folder, when they sit inside it. */
function ownRecords(deps: WorkflowDeps): string[] {
  const own = relative(deps.cwd, dataRoot(deps.root, deps.configDir));
  return own && !own.startsWith("..") && !isAbsolute(own) ? [own.split("\\").join("/")] : [];
}

/** The working tree's changed files, without bot-lobby's own records (its data folder may sit untracked in the project). */
async function treeChanges(deps: WorkflowDeps, base?: string): Promise<{ top: string; files: string[] } | undefined> {
  const tree = await changedFiles(deps.cwd, base);
  if (!tree) return undefined;
  let data = dataRoot(deps.root, deps.configDir);
  try {
    data = realpathSync(data);
  } catch {
    // Not created yet: nothing of it can be in the tree.
  }
  const own = relative(tree.top, data);
  if (!own || own.startsWith("..") || isAbsolute(own)) return tree;
  const prefix = `${own.split("\\").join("/")}/`;
  return { top: tree.top, files: tree.files.filter((file) => !file.startsWith(prefix)) };
}

/** Every changed file of the working tree, explained for this task; undefined without a baseline or git. */
async function changeProvenance(deps: WorkflowDeps, task: Task, base?: string): Promise<FileProvenance[] | undefined> {
  if (!task.baseline) return undefined;
  const tree = await treeChanges(deps, base);
  if (!tree) return undefined;
  return explainChanges(task, tree.files, tree.top, readChanges(deps.root, deps.configDir, task.createdAt));
}

/** Who changed the tree, for the Master: counts, and what the changes that are not this task's mean for it. */
function provenanceNote(files: readonly FileProvenance[] | undefined): string {
  if (!files || files.length === 0) return "";
  const kinds = new Set(files.flatMap((file) => file.kinds));
  return [
    `Changed files: ${provenanceSummary(files)}.`,
    kinds.has("quickfix") ? "The user asked for the quick fixes directly: never revert them or send them back as fixes." : "",
    kinds.has("pre-existing") || kinds.has("other-task") ? "Pre-existing changes and other tasks' are not this task's to review or revert." : "",
    kinds.has("unattributed") ? "No agent recorded the unattributed edits: ask the user before counting them in or reverting them." : "",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

/** Record one worker's outcome on the task and return its report for the Master. */
function absorbWorkerOutcome(task: Task, deps: WorkflowDeps, outcome: WorkerOutcome, time?: WorkerTime): string {
  const domain = outcome.result.domain;
  recordWorkerRun(task, outcome.run);
  if (time) settleAllotment(task, deps, time.id, stoppedForTime(outcome) ? "out of time" : outcome.run.status === "success" ? "finished" : "stopped");
  appendChange(deps.root, deps.configDir, {
    source: "worker",
    id: outcome.run.runId,
    taskId: task.id,
    domain,
    what: (outcome.run.instruction ?? "").split("\n").find((line) => line.trim())?.trim() ?? domain,
    files: outcome.run.edited ?? [],
    startedAt: outcome.run.startedAt,
    finishedAt: outcome.run.finishedAt ?? new Date().toISOString(),
    status: outcome.run.status,
  });
  const approvals = recordWorkerApprovals(task, outcome, deps.config, isAutoMode(deps.root, deps.configDir, task.id));
  const pushback = recordPushback(task, outcome);
  task.blockers = [...task.blockers.filter((blocker) => blocker.domain !== domain), ...outcome.result.blockers];
  updateScratchpad(deps, task, outcome);
  const spent = timeReport(outcome);
  return spent ? `${workerReport(outcome, approvals, pushback)}\n${spent}` : workerReport(outcome, approvals, pushback);
}

async function handleImplement(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["planning", "implementing", "reviewing"]);
  const assignments = parseAssignments(params);
  for (const { domain } of assignments) assertNoPendingApprovals(task, domain);
  for (const { domain } of assignments) if (!task.domains.includes(domain)) task.domains.push(domain);
  // Under a time budget every step is given its share before any starts; a spent budget starts none.
  const times = workerTimes(task, deps, assignments);
  if (task.state !== "implementing") transition(task, "implementing");
  await takeBaseline(task, deps);
  let report: string;
  try {
    if (assignments.length === 1) {
      const { domain, instruction } = assignments[0]!;
      const outcome = await runWorker(workerRequest(deps, task, domain, instruction, times.get(domain)), deps.runProcess ?? spawnPiProcess);
      report = absorbWorkerOutcome(task, deps, outcome, times.get(domain));
    } else report = await runParallelWorkers(task, deps, assignments, times);
  } finally {
    // A step that never reported (the call failed) does not stay "running" in the budget.
    for (const time of times.values()) settleAllotment(task, deps, time.id, "stopped");
  }
  const note = provenanceNote(await changeProvenance(deps, task, task.baseline?.head));
  return note ? `${report}\n\n${note}` : report;
}

/**
 * Several domains at once. The workers share one file desk: each claims a file
 * before editing it, queues for a busy one, and hands it over with a note; a
 * worker that finishes hands over whatever it still holds automatically.
 */
async function runParallelWorkers(task: Task, deps: WorkflowDeps, assignments: Assignment[], times: ReadonlyMap<Domain, WorkerTime>): Promise<string> {
  const session = new DeskSession({ cwd: deps.cwd });
  await session.open();
  let outcomes: WorkerOutcome[];
  let unenforced: Domain[];
  try {
    outcomes = await mapConcurrent(assignments, deps.config.workflow.maxParallelWorkers, ({ domain, instruction }) => {
      const request = workerRequest(deps, task, domain, instruction, times.get(domain));
      request.agent = {
        env: session.env(domain),
        extraTools: DESK_TOOLS,
        onStart: (handle) => session.attach(domain, handle),
        onAttemptEnd: (run) => {
          const result = parseWorkerResult(domain, run.output);
          session.release(domain, (path, next) => autoNote(domain, path, next, result.filesChanged, result.completed));
        },
      };
      return runWorker(request, deps.runProcess ?? spawnPiProcess);
    });
    unenforced = assignments.map((entry) => entry.domain).filter((domain) => !session.greetedBy(domain));
  } finally {
    await session.close();
  }
  const reports = outcomes.map((outcome) => absorbWorkerOutcome(task, deps, outcome, times.get(outcome.result.domain)));
  return [
    `Parallel batch: ${assignments.map((entry) => entry.domain).join(", ")}.`,
    ...reports,
    handoverLog(session.handovers()),
    unenforced.length > 0
      ? `File checkout was not enforced for ${unenforced.join(", ")} (bot-lobby did not load in those workers); inspect the diff for overlapping edits.`
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function handoverLog(handovers: readonly Handover[]): string {
  if (handovers.length === 0) return "";
  const lines = handovers.map((entry) => `- ${entry.path}: ${entry.from} → ${entry.to}${entry.auto ? " (on finish)" : ""} — ${truncate(entry.note, 200)}`);
  return `File handovers:\n${lines.join("\n")}`;
}

function handleResolveApproval(task: Task, params: OrchestrateParams): string {
  const id = params.approvalId?.trim();
  const decision = params.decision;
  if (!id || (decision !== "approved" && decision !== "rejected")) {
    throw new Error("resolve_approval requires approvalId and decision (approved|rejected)");
  }
  const pending = pendingApprovals(task).find((entry) => entry.id === id);
  if (!pending) throw new Error(`no pending approval "${id}"`);
  const note = params.note?.trim();
  if (pending.kind === "pushback" && decision === "rejected" && !note) {
    throw new Error("overruling a pushback requires note (the counter-argument)");
  }
  const approval = resolveApproval(task, id, decision, note)!;
  recordDecision(task, `${decision} ${approval.kind} for ${approval.domain}: ${approval.detail}${note ? ` — ${note}` : ""}`);
  if (approval.kind === "pushback") {
    return decision === "approved"
      ? `${id} pushback accepted (${approval.detail}). Re-delegate without that change.`
      : `${id} pushback overruled. Counter-argument: ${note}. Re-delegate the original change to ${approval.domain}.`;
  }
  return decision === "approved"
    ? `${id} approved. The ${approval.domain} worker may now proceed with: ${approval.detail}`
    : `${id} rejected. Instruct the ${approval.domain} worker to achieve the goal without that change.`;
}

function scratchpadSummary(deps: WorkflowDeps, task: Task, domain: Domain): string {
  return readTaskArtifact(deps.root, deps.configDir, task.id, `${domain}.md`) ?? "";
}
function recordReview(task: Task, domain: Domain, result: ReviewResult): void {
  task.reviewRecords.push({
    domain,
    verdict: result.verdict,
    findings: result.findings.map((finding) => ({ severity: finding.severity, text: finding.text })),
    requiredChanges: result.requiredChanges,
    createdAt: new Date().toISOString(),
  });
}
/** Each domain's scratchpad, its newest entries kept when it is long (the latest fix round matters most). */
function allScratchpads(deps: WorkflowDeps, task: Task, perDomain = 1500): string {
  return (["designer", "backend", "qa"] as Domain[])
    .map((domain) => tail(scratchpadSummary(deps, task, domain).trim(), perDomain))
    .filter((text) => text.length > 0)
    .join("\n\n---\n\n");
}

/**
 * What the last QA round asked for, so the next one verifies it instead of
 * reviewing everything from scratch (and finding new things each time).
 */
function previousRound(task: Task): string {
  const rounds = task.reviewRecords.filter((record) => record.domain === "qa");
  const last = rounds.at(-1);
  if (!last || last.verdict === "pass") return "";
  const asks = [
    ...last.findings.filter((finding) => finding.severity === "critical" || finding.severity === "major").map((finding) => `[${finding.severity}] ${finding.text}`),
    ...last.requiredChanges,
  ];
  if (asks.length === 0) return "";
  return [
    `This is QA round ${rounds.length + 1}. Round ${rounds.length} (${last.verdict.toUpperCase()}) asked for:`,
    ...asks.slice(0, 20).map((ask) => `- ${truncate(ask, 300)}`),
    "Verify each of these first and say which are addressed. Do not start the review over: a new blocking finding must be critical or major (a problem the fixes introduced, or an unmet acceptance criterion); anything else goes under Optional Improvements.",
  ].join("\n");
}

const QA_INSTRUCTION = [
  "Run the QA quality gate for the completed feature.",
  "Verify requirements, acceptance criteria, regression risk, edge cases, security, accessibility,",
  "UX, reliability, and tests. Passing automated tests alone is not acceptance.",
].join(" ");

/** The QA gate looks at every domain's work, not just one worker's diff, knowing who changed each file. */
function qaRequest(deps: WorkflowDeps, task: Task, diff: string, instruction?: string, provenance?: readonly FileProvenance[]): ReviewerRequest {
  const rounds = previousRound(task);
  return {
    taskId: task.id,
    domain: "qa",
    taskText: workerTaskText(task, 9000),
    workerSummary: allScratchpads(deps, task),
    ...(rounds ? { previousRound: rounds } : {}),
    scoutOutcomes: loadScoutResults(taskReadDirs(deps.root, deps.configDir, task.id), [...new Set<Domain>(["qa", ...task.domains])]),
    diff,
    ...(provenance && provenance.length > 0 ? { provenance: provenanceLines(provenance) } : {}),
    instruction: instruction?.trim() || QA_INSTRUCTION,
    cwd: deps.cwd,
    dataRoots: readDataRoots(deps.root, deps.configDir),
    config: deps.config,
    profile: deps.profile,
    signal: deps.signal,
    onUpdate: deps.onUpdate,
  };
}

/** What the loop does after a QA round: finish, fix and review again, stop, or (the user's call) accept the work as it is. */
type LoopDecision = "accept" | "iterate" | "blocked" | "waived";

function qaReport(outcome: ReviewerOutcome, decision: LoopDecision, provenance?: readonly FileProvenance[]): string {
  const { result, run, issues } = outcome;
  const passed = result.verdict === "pass";
  return [
    `QA gate: ${result.verdict.toUpperCase()} (run ${run.status}${run.error ? `: ${run.error}` : ""})${result.relaxed ? " — only minor findings, which never hold the gate" : ""}`,
    result.findings.length > 0
      ? `Findings:\n${result.findings.map((finding) => `- [${finding.severity}] ${truncate(finding.text, 300)}`).join("\n")}`
      : "",
    result.requiredChanges.length > 0
      ? `${passed ? "Follow-ups (not blocking; mention them to the user, do not start a fix round for them)" : "Required changes"}:\n${result.requiredChanges.map((change) => `- ${truncate(change, 300)}`).join("\n")}`
      : "",
    decision === "accept"
      ? "The QA gate passed. Record any distilled knowledge, then call action=complete."
      : decision === "waived"
        ? "The user accepted the work as it is, without a QA pass. Call action=complete now with a short summary that names what QA still asked for."
        : decision === "iterate"
          ? "The QA gate did not pass: delegate the required changes to the owning domain, then re-run action=qa."
          : "The review limit is reached and the user did not accept the work: mark the task blocked and tell the user what QA still asks for. They can accept it with /bot-lobby accept.",
    result.pushback ? pushbackLine(result.pushback, "qa") : "",
    issues.length > 0 ? `Issues: ${issues.join("; ")}` : "",
    provenanceNote(provenance),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

async function handleQa(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["implementing", "reviewing"]);
  if (task.state !== "reviewing") transition(task, "reviewing");
  const iterations = (task.reviewIterations?.qa ?? 0) + 1;
  task.reviewIterations = { qa: iterations };
  const time = qaTime(task, deps);
  const base = await reviewBase(task, deps);
  const [diff, provenance] = await Promise.all([
    readRepositoryDiff(deps.cwd, { ...(base ? { base } : {}), exclude: ownRecords(deps) }),
    changeProvenance(deps, task, base),
  ]);
  const outcome = await runReviewer({ ...qaRequest(deps, task, diff, params.task, provenance), ...(time ? { time } : {}) }, deps.runProcess ?? spawnPiProcess);
  if (time) settleAllotment(task, deps, time.id, "finished");
  task.qaVerdict = outcome.result.verdict;
  recordReview(task, "qa", outcome.result);
  recordAdvisoryPushbacks(task, [{ pushback: outcome.result.pushback, who: "qa" }]);
  if (outcome.result.relaxed) recordDecision(task, `QA round ${iterations} passed: ${outcome.result.relaxed}.`, "qa");
  let decision: LoopDecision = decideReviewLoop(outcome.result.verdict, iterations, reviewLimit(task, deps));
  if (decision === "blocked") decision = await askAtReviewLimit(task, outcome.result, iterations, deps);
  if (decision === "accept") task.blockers = task.blockers.filter((blocker) => blocker.domain !== "qa");
  return qaReport(outcome, decision, provenance);
}

/** Review rounds allowed: the configured limit plus any the user granted. */
function reviewLimit(task: Task, deps: WorkflowDeps): number {
  return deps.config.workflow.maxReviewIterations + (task.extraReviewRounds ?? 0);
}

/** What QA still asks for, one line each: its blocking findings and required changes. */
function openAsks(result: Pick<ReviewResult, "findings" | "requiredChanges">): string[] {
  return [
    ...result.findings.filter((finding) => finding.severity === "critical" || finding.severity === "major").map((finding) => `[${finding.severity}] ${finding.text}`),
    ...result.requiredChanges,
  ];
}

const ACCEPT_WORK = "Accept the work as it is and complete the task";
const ONE_MORE_ROUND = "Run one more fix round";

/**
 * The review limit is reached (or QA says BLOCKED): the user decides, not the
 * loop. They can accept the work as it is, grant one more fix round, or leave
 * the task blocked. Nobody is asked in auto mode or without a UI: it blocks.
 */
async function askAtReviewLimit(task: Task, result: ReviewResult, iterations: number, deps: WorkflowDeps): Promise<LoopDecision> {
  if (isAutoMode(deps.root, deps.configDir, task.id)) return "blocked";
  const asks = openAsks(result);
  const checks = result.verification.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("-")).slice(0, 4);
  const choice = await deps.choose(
    [
      `QA has not passed ${task.id} after ${iterations} round${iterations === 1 ? "" : "s"} (this one: ${result.verdict.toUpperCase()}).`,
      asks.length > 0 ? `It still asks for:\n${asks.slice(0, 8).map((ask) => `- ${truncate(ask, 200)}`).join("\n")}` : "",
      checks.length > 0 ? `Its checks:\n${checks.map((line) => truncate(line, 160)).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    [ACCEPT_WORK, ONE_MORE_ROUND, "Leave the task blocked"],
  );
  if (choice === ACCEPT_WORK) {
    waiveQa(task, asks, `after ${iterations} QA round${iterations === 1 ? "" : "s"}`);
    return "waived";
  }
  if (choice === ONE_MORE_ROUND) {
    task.extraReviewRounds = (task.extraReviewRounds ?? 0) + 1;
    recordDecision(task, `The user granted one more QA round after ${iterations}.`);
    return "iterate";
  }
  return "blocked";
}

/**
 * The user accepts the work as it stands: the QA gate is waived, blockers are
 * cleared, and a blocked task returns to review so it can complete. Only the
 * user's own choice (a dialog or /bot-lobby accept) ever gets here.
 */
export function waiveQa(task: Task, open: readonly string[], why: string): void {
  task.qaWaiver = { at: new Date().toISOString(), open: open.map((ask) => truncate(ask, 300)) };
  const cleared = task.blockers.map((blocker) => blocker.reason);
  task.blockers = [];
  if (task.state === "blocked") transition(task, "implementing");
  if (task.state === "implementing") transition(task, "reviewing");
  recordDecision(task, `The user accepted the work without a QA pass (${why}).${open.length > 0 ? ` QA still asked for: ${open.map((ask) => truncate(ask, 160)).join("; ")}.` : ""}${cleared.length > 0 ? ` Cleared blockers: ${cleared.join("; ")}.` : ""}`);
}

/** The last QA round's open asks, for a waiver made outside the loop. */
export function lastQaAsks(task: Task): string[] {
  const last = task.reviewRecords.filter((record) => record.domain === "qa").at(-1);
  return last && last.verdict !== "pass" ? openAsks(last) : [];
}

/**
 * §22: the only path into persistent knowledge, and it is Master-only because
 * domain agents never receive this tool. Proposals are accepted by calling this
 * with rewritten text, or silently dropped by not calling it.
 */
function handleKnowledge(task: Task, params: OrchestrateParams, deps: WorkflowDeps): string {
  const text = params.text?.trim();
  if (!text) throw new Error("knowledge requires text");
  const kind: KnowledgeKind = params.kind ?? "knowledge";
  const agent: KnowledgeAgent = params.domain && isDomain(params.domain) ? params.domain : "master";
  const outcome = applyKnowledge({ dataRoot: dataRoot(deps.root, deps.configDir), agent, kind, text });
  if (outcome.result === "empty") throw new Error("knowledge text is empty");
  if (outcome.result === "duplicate") return `Already recorded in ${outcome.path}; nothing changed.`;
  recordDecision(task, `Recorded ${kind} for ${agent}: ${truncate(text, 200)}`);
  return `Recorded ${kind} for ${agent} in ${outcome.path}.`;
}

/**
 * §24: the Master rewrites the file (asking the user about ambiguity), the
 * engine archives the previous version and writes the compacted text.
 */
function handleCompact(task: Task, params: OrchestrateParams, deps: WorkflowDeps): string {
  const agent: KnowledgeAgent = params.domain && isDomain(params.domain) ? params.domain : "master";
  const file = params.file?.trim();
  const content = params.text?.trim();
  if (!file) throw new Error("compact requires file");
  if (!content) throw new Error("compact requires text (the compacted content)");
  const outcome = compactKnowledgeFile({
    dataRoot: dataRoot(deps.root, deps.configDir),
    agent,
    file,
    content,
    backupCount: deps.config.knowledge.backupCount,
  });
  recordDecision(task, `Compacted ${agent}/${file} (${outcome.before} -> ${outcome.after} chars)`);
  return `Compacted ${agent}/${file}: ${outcome.before} -> ${outcome.after} chars. Previous version archived at ${outcome.archive}.`;
}

/** §63: record history, drop scratchpads, then mark the task completed. */
async function handleComplete(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["reviewing", "blocked"]);
  // Without a QA pass only the user can let the task finish: they are asked, never overruled.
  if (task.qaVerdict !== "pass" && !task.qaWaiver) await offerAcceptance(task, deps);
  if (task.state === "blocked") throw new Error("cannot complete: the task is blocked, and the user did not accept its work as it is");
  const blockers = completionBlockers(task, pendingApprovals(task).length);
  if (blockers.length > 0) throw new Error(`cannot complete: ${blockers.join("; ")}`);
  const summary = params.text?.trim() || task.proposal || task.title;
  flushDecisions(deps, task);
  recordCompletion(deps, task, summary);
  removeTaskScratchpads(deps.root, deps.configDir, task.id);
  task.blockers = [];
  transition(task, "completed");
  const oversized = overThreshold(readDataRoots(deps.root, deps.configDir), deps.config.knowledge.compactionThreshold);
  const advice =
    oversized.length > 0
      ? `\nKnowledge files over the compaction threshold: ${oversized.map((entry) => `${entry.agent}/${entry.file} (${entry.chars})`).join(", ")}. Compact them with action=compact when convenient.`
      : "";
  return `Task ${task.id} completed. History recorded and temporary scratchpads removed.${advice}`;
}

/** Asked when the oracle completes a task QA has not passed (the user told it to finish, say). */
async function offerAcceptance(task: Task, deps: WorkflowDeps): Promise<void> {
  if (isAutoMode(deps.root, deps.configDir, task.id)) return;
  const asks = lastQaAsks(task);
  const rounds = task.reviewIterations.qa;
  const choice = await deps.choose(
    [
      `Complete ${task.id} without a QA pass? ${rounds > 0 ? `QA ran ${rounds} round${rounds === 1 ? "" : "s"}; the last said ${(task.qaVerdict ?? "nothing").toUpperCase()}.` : "QA has not run."}`,
      asks.length > 0 ? `It still asks for:\n${asks.slice(0, 8).map((ask) => `- ${truncate(ask, 200)}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    ["Complete it anyway", "Not yet"],
  );
  if (choice === "Complete it anyway") waiveQa(task, asks, "when the oracle completed it");
}

function flushDecisions(deps: WorkflowDeps, task: Task): void {
  const root = dataRoot(deps.root, deps.configDir);
  for (const decision of task.decisions) {
    appendDecision(knowledgeDir(root, decision.domain), `${task.id} ${decision.text}`);
  }
}

function recordCompletion(deps: WorkflowDeps, task: Task, summary: string): void {
  const line = `${task.id}: ${truncate(summary.replace(/\s+/g, " "), 200)}`;
  const agents: KnowledgeAgent[] = ["master", ...new Set(task.domains)];
  for (const agent of agents) {
    appendCompletedTask(knowledgeDir(dataRoot(deps.root, deps.configDir), agent), line);
  }
}

function handleBlock(task: Task, params: OrchestrateParams): string {
  const reason = params.reason?.trim() ?? params.text?.trim();
  if (!reason) throw new Error("block requires reason");
  const domain = params.domain && isDomain(params.domain) ? params.domain : task.domains[0] ?? "qa";
  task.blockers.push({ domain, reason, tried: [], need: "a decision or input from the user", createdAt: new Date().toISOString() });
  transition(task, "blocked");
  return `Task blocked: ${reason}. Tell the user what is needed, then call action=resume once resolved.`;
}

function handleResume(task: Task, params: OrchestrateParams): string {
  requireState(task, ["blocked"]);
  if (params.domain && isDomain(params.domain)) {
    task.blockers = task.blockers.filter((blocker) => blocker.domain !== params.domain);
  }
  transition(task, "implementing");
  return "Task resumed. Continue with action=implement.";
}

function handleDecide(task: Task, params: OrchestrateParams): string {
  const text = params.text?.trim();
  if (!text) throw new Error("decide requires text");
  const domain = params.domain && isDomain(params.domain) ? params.domain : "master";
  recordDecision(task, text, domain);
  return `Decision recorded (${domain}).`;
}

function handleCancel(task: Task): string {
  transition(task, "abandoned");
  return `Task ${task.id} abandoned. Its scratchpad is kept until the task is formally resolved.`;
}

/* ------------------------------------------------------------ time budget */

/** Shares of what is left that a scout batch and the researcher are given (within their configured limits). */
const SCOUT_SHARE = 0.1;
const RESEARCH_SHARE = 0.15;
/** Minutes a worker out of time is taken to ask for when its report names none. */
const DEFAULT_MORE_MINUTES = 10;

/** A delegation's time, with the allotment it is recorded under. */
type WorkerTime = AgentTime & { id: string };

/** The task's budget and where it stands, when it has one. */
function budgetFor(task: Task, deps: WorkflowDeps): { budget: TaskBudget; state: BudgetState } | undefined {
  const budget = readBudget(deps.root, deps.configDir, task.id);
  return budget ? { budget, state: budgetState(task.id, budget, task.qaVerdict === "pass") } : undefined;
}

/** No new work starts once the budget is spent: the oracle asks the user for more, or wraps up. */
function budgetSpent(state: BudgetState, what: string): Error {
  const reserve = state.reserveMs > 0 ? `, ${formatMinutes(state.reserveMs)} of it kept for the QA gate` : "";
  const wrap = state.reserveMs >= MIN_READ_MS ? "run action=qa on what is done" : "complete or block with what is done";
  return new Error(`the task's time budget has no room for ${what}: ${formatMinutes(state.usedMs)} of ${formatMinutes(state.totalMs)} used, ${formatMinutes(state.leftMs)} left${reserve}. Ask the user for more time with action=budget (minutes and reason), or wrap up: ${wrap}.`);
}

/** What an agent is told about its time. */
function timeNote(allotMs: number, state: BudgetState, worker: boolean): string {
  return [
    "## Time",
    `You have ${formatMinutes(allotMs)} for this ${worker ? "step" : "work"}; the task has ${formatMinutes(state.leftMs)} of its ${formatMinutes(state.totalMs)} left.`,
    worker
      ? "At about 75% you get a heads-up. When the time is up you are asked to stop and report where you left off (`## Left Off`) and how much more you need (`## More Time`); the user decides whether you get it. Land the most important part first, and keep every file consistent as you go."
      : "When the time is up you are asked to stop and report what you have, so cover the most important questions first.",
  ].join("\n");
}

function recordAllotment(task: Task, deps: WorkflowDeps, entry: Omit<Allotment, "startedAt" | "granted">): void {
  updateBudget(deps.root, deps.configDir, task.id, (budget) => {
    budget.allotments.push({ ...entry, granted: 0, startedAt: new Date().toISOString() });
  });
}

function settleAllotment(task: Task, deps: WorkflowDeps, id: string, outcome: NonNullable<Allotment["outcome"]>): void {
  updateBudget(deps.root, deps.configDir, task.id, (budget) => {
    const entry = budget.allotments.find((allotment) => allotment.id === id);
    if (entry && !entry.endedAt) Object.assign(entry, { endedAt: new Date().toISOString(), outcome });
  });
}

function oneLine(text: string, max: number): string {
  return truncate(text.replace(/\s+/g, " ").trim(), max).replace(/\n\[\.\.\.\d+ characters omitted\]$/, "…");
}

/** A read-only batch's time (scouts, the researcher): a share of what is left, within its configured limit. */
function readerTime(task: Task, deps: WorkflowDeps, who: string, what: string, share: number, limitMs: number, label: string): WorkerTime | undefined {
  const now = budgetFor(task, deps);
  if (!now) return undefined;
  const ms = readerAllotment(now.state, share, limitMs);
  if (ms === undefined) throw budgetSpent(now.state, label);
  const id = `${who.toLowerCase()}-${Date.now().toString(36)}`;
  recordAllotment(task, deps, { id, who, what: oneLine(what, 120), minutes: Math.round(ms / 60_000) });
  return { id, endsAt: Date.now() + ms, allotMs: ms, note: timeNote(ms, now.state, false) };
}

/** The QA gate's time: its reserve at least, never more than is left. */
function qaTime(task: Task, deps: WorkflowDeps): WorkerTime | undefined {
  const now = budgetFor(task, deps);
  if (!now) return undefined;
  const ms = qaAllotment(now.state, deps.config.agents.qa.timeoutMs ?? deps.config.workflow.agentTimeoutMs);
  if (ms === undefined) throw budgetSpent(now.state, "the QA gate");
  const id = `qa-${Date.now().toString(36)}`;
  recordAllotment(task, deps, { id, who: "QA gate", what: "review the task's work", minutes: Math.round(ms / 60_000) });
  return { id, endsAt: Date.now() + ms, allotMs: ms, note: timeNote(ms, now.state, false) };
}

/** Plan domains still to build, the batch counted once: what is left before the QA reserve is split across them by default. */
function openSlots(task: Task, batch: readonly Domain[]): number {
  const built = new Set((task.workerRuns ?? []).filter((run) => run.status === "success").map((run) => run.domain));
  return task.domains.filter((domain) => !built.has(domain) && !batch.includes(domain)).length + 1;
}

/**
 * Each step's time, given before any starts: the minutes the oracle asked
 * for (it divides by scope) or an even share, never past what is left before
 * the QA gate's reserve. A spent budget starts nothing.
 */
function workerTimes(task: Task, deps: WorkflowDeps, assignments: readonly Assignment[]): Map<Domain, WorkerTime> {
  const times = new Map<Domain, WorkerTime>();
  const now = budgetFor(task, deps);
  if (!now) return times;
  const slots = openSlots(task, assignments.map((entry) => entry.domain));
  for (const { domain, instruction, minutes } of assignments) {
    const given = workerAllotment(now.state, minutes, slots);
    if (!given) throw budgetSpent(now.state, `the ${domain} step`);
    const id = `${domain}-${Date.now().toString(36)}`;
    recordAllotment(task, deps, { id, who: AGENT_LABELS[domain], what: oneLine(instruction, 120), minutes: Math.round(given.ms / 60_000) });
    if (given.note) recordDecision(task, `${AGENT_LABELS[domain]}'s step: ${given.note}.`);
    times.set(domain, { id, endsAt: Date.now() + given.ms, allotMs: given.ms, note: timeNote(given.ms, now.state, true), onTimeUp: moreTimeFor(task, deps, domain, instruction, id) });
  }
  return times;
}

const AGENT_LABELS: Record<Domain, string> = { backend: "DEV", designer: "DESIGN", qa: "QA" };

/** Out-of-time questions one at a time, even when parallel workers run out together. */
let asking: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(ask: () => Promise<T>): Promise<T> {
  const next = asking.then(ask, ask);
  asking = next.catch(() => undefined);
  return next;
}

/**
 * A worker out of time has reported what it did, where it left off and how
 * much more it needs. The user decides (auto mode: once, and only from what
 * is left before the QA gate's reserve); a grant past that grows the budget,
 * and the same agent carries on. Resolves with the ms granted, 0 to stop it.
 */
function moreTimeFor(task: Task, deps: WorkflowDeps, domain: Domain, instruction: string, id: string): NonNullable<AgentTime["onTimeUp"]> {
  let asked = 0;
  return (run, report) => oneAtATime(async () => {
    const result = parseWorkerResult(domain, report);
    // A report with nothing left to do finished in time.
    if (!result.leftOff && !result.moreTime) return 0;
    asked += 1;
    const label = AGENT_LABELS[domain];
    const wanted = result.moreTime?.minutes ?? DEFAULT_MORE_MINUTES;
    const now = budgetFor(task, deps);
    if (!now) return 0;
    const minutes = await decideMoreTime(task, deps, { label, instruction, result, wanted, run, asked, state: now.state });
    if (minutes <= 0) return 0;
    const over = Math.max(0, Math.ceil((minutes * 60_000 - now.state.windowMs) / 60_000));
    updateBudget(deps.root, deps.configDir, task.id, (budget) => {
      budget.granted += over;
      const entry = budget.allotments.find((allotment) => allotment.id === id);
      if (entry) Object.assign(entry, { minutes: entry.minutes + minutes, granted: entry.granted + minutes });
    });
    recordDecision(task, `${label} ran out of time; ${isAutoMode(deps.root, deps.configDir, task.id) ? "auto mode gave it" : "the user gave it"} ${minutes} more minutes${over > 0 ? `, ${over} of them added to the task's budget` : ""}. Left off: ${oneLine(result.leftOff ?? result.moreTime?.reason ?? "", 200)}`);
    return minutes * 60_000;
  });
}

interface MoreTimeAsk {
  label: string;
  instruction: string;
  result: WorkerResult;
  wanted: number;
  run: AgentRun;
  asked: number;
  state: BudgetState;
}

const MORE_TIME = "Give it the time it asks for";
const OTHER_TIME = "Give a different amount";

async function decideMoreTime(task: Task, deps: WorkflowDeps, ask: MoreTimeAsk): Promise<number> {
  const { label, instruction, result, wanted, run, asked, state } = ask;
  if (isAutoMode(deps.root, deps.configDir, task.id)) {
    // Nobody to ask: once, and only from time the task still has before the QA gate's reserve.
    if (asked === 1 && wanted * 60_000 <= state.windowMs) return wanted;
    recordDecision(task, `Auto mode: ${label} ran out of time and was not given more (${asked > 1 ? "it already had more once" : `it asked for ${wanted} minutes, ${formatMinutes(state.windowMs)} were left`}).`);
    return 0;
  }
  const over = Math.max(0, Math.ceil((wanted * 60_000 - state.windowMs) / 60_000));
  const had = run.allotMs ?? 0;
  const choice = await deps.choose(
    [
      `${label} is out of time: it had ${formatMinutes(had + (run.extendedMs ?? 0))} for "${oneLine(instruction, 160)}".`,
      result.completed ? `Done so far: ${oneLine(result.completed, 400)}` : "",
      result.leftOff ? `Left to do: ${oneLine(result.leftOff, 400)}` : "",
      `It needs about ${wanted} more minutes${result.moreTime?.reason ? `: ${oneLine(result.moreTime.reason, 200)}` : ""}.`,
      `The task has used ${formatMinutes(state.usedMs)} of ${formatMinutes(state.totalMs)} (${formatMinutes(state.leftMs)} left)${over > 0 ? `; ${wanted} more minutes adds ${over} to its budget` : ""}.`,
      `Give ${label} ${wanted} more minutes to finish?`,
    ].filter(Boolean).join("\n\n"),
    [MORE_TIME, OTHER_TIME, `Stop ${label} here`],
  );
  if (choice === MORE_TIME) return wanted;
  if (choice === OTHER_TIME) return parseMinutes((await deps.ask(`How many more minutes for ${label}?`)) ?? "") ?? 0;
  recordDecision(task, `The user stopped ${label} at its time limit. Left off: ${oneLine(result.leftOff ?? "", 200)}`);
  return 0;
}

/** Stopped at its time with work left: a report that finished everything as time ran out is not. */
function stoppedForTime(outcome: WorkerOutcome): boolean {
  return Boolean(outcome.run.timeUp && (outcome.result.leftOff || outcome.result.moreTime));
}

/** How a step's time went, for the oracle: out of time and stopped, or given more. */
function timeReport(outcome: WorkerOutcome): string {
  const { run, result } = outcome;
  const label = AGENT_LABELS[result.domain];
  if (stoppedForTime(outcome)) {
    return [
      `${label} ran out of its time and was not given more: this step is unfinished.`,
      result.leftOff ? `Left off: ${oneLine(result.leftOff, 600)}` : "",
      result.moreTime ? `It asked for ${result.moreTime.minutes ?? "more"} minutes${result.moreTime.reason ? `: ${oneLine(result.moreTime.reason, 300)}` : ""}.` : "",
      "Decide with the user: trim the scope, ask for task time with action=budget, or wrap up with what is done.",
    ].filter(Boolean).join("\n");
  }
  return run.extendedMs ? `${label} ran out of its ${formatMinutes(run.allotMs ?? 0)} and was given ${formatMinutes(run.extendedMs)} more.` : "";
}

/**
 * `action=budget`: with no minutes, where the budget stands; with minutes and
 * a reason, the oracle asks the user for more task time. Only the user can
 * grant it; in auto mode nobody can, and the task wraps up.
 */
async function handleBudget(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  const now = budgetFor(task, deps);
  if (!now) return "This task has no time budget. The user sets one with /bot-lobby budget <minutes>.";
  const minutes = params.minutes;
  if (!minutes || minutes <= 0) return allotmentReport(now.budget);
  const reason = params.reason?.trim() || params.text?.trim();
  if (!reason) throw new Error("budget requires reason: why the task needs more time");
  if (isAutoMode(deps.root, deps.configDir, task.id)) {
    recordDecision(task, `Auto mode: asked for ${minutes} more minutes (${oneLine(reason, 160)}), which only the user can give.`);
    return "Auto mode: nobody can give the task more time. Wrap up with what is done: finish or drop the step in hand, run the QA gate if there is room, and tell the user what is left.";
  }
  const choice = await deps.choose(
    [`The oracle asks for ${minutes} more minutes on ${task.id}: ${oneLine(reason, 400)}`, budgetLine(now.budget, now.state)].join("\n\n"),
    [`Give ${minutes} more minutes`, OTHER_TIME, "No"],
  );
  const granted = choice === `Give ${minutes} more minutes` ? minutes : choice === OTHER_TIME ? parseMinutes((await deps.ask(`How many more minutes for ${task.id}?`)) ?? "") ?? 0 : 0;
  if (granted <= 0) {
    recordDecision(task, `The user did not give ${minutes} more minutes: ${oneLine(reason, 200)}`);
    return "The user did not give more time. Wrap up with what is done and tell them what is left.";
  }
  updateBudget(deps.root, deps.configDir, task.id, (budget) => {
    budget.granted += granted;
  });
  recordDecision(task, `The user gave the task ${granted} more minutes: ${oneLine(reason, 200)}`);
  return `The user gave the task ${granted} more minutes.`;
}

/** What each delegation was given, newest last. */
function allotmentReport(budget: TaskBudget): string {
  const rows = budget.allotments.slice(-8).map((entry) => `- ${entry.who}: ${entry.minutes}m${entry.granted > 0 ? ` (${entry.granted} granted)` : ""} — ${entry.what}${entry.outcome ? ` · ${entry.outcome}` : entry.endedAt ? "" : " · running"}`);
  return rows.length > 0 ? `Allotted so far:\n${rows.join("\n")}` : "Nothing allotted yet.";
}

/** Every orchestrate result ends with where the budget stands, when the task has one. */
function budgetFooter(task: Task, deps: WorkflowDeps): string {
  const now = budgetFor(task, deps);
  return now ? `\n\n${budgetLine(now.budget, now.state)}` : "";
}

const HANDLERS: Record<OrchestrateAction, (task: Task, params: OrchestrateParams, deps: WorkflowDeps) => Promise<string> | string> = {
  clarify: handleClarify,
  scout: handleScout,
  research: handleResearch,
  propose: handlePropose,
  plan: handlePlan,
  implement: handleImplement,
  resolve_approval: handleResolveApproval,
  qa: handleQa,
  knowledge: handleKnowledge,
  compact: handleCompact,
  complete: handleComplete,
  block: handleBlock,
  resume: handleResume,
  decide: handleDecide,
  budget: handleBudget,
  status: (task) => describeTask(task),
  cancel: handleCancel,
};

/**
 * Single entry point for every orchestration step. The engine — not the
 * calling agent — decides whether an action is legal in the current state.
 */
export async function runWorkflowAction(params: OrchestrateParams, deps: WorkflowDeps): Promise<WorkflowResult> {
  const selected = selectTask(deps.root, deps.configDir, params.taskId, deps.sessionId);
  const task = selected ?? (params.taskId ? undefined : ownerlessTask(deps.root, deps.configDir));
  if (params.action !== "status" && task?.ownerSessionId && deps.sessionId && task.ownerSessionId !== deps.sessionId) {
    return { ok: false, taskId: task.id, state: task.state, message: `Task ${task.id} is owned by another pi session. Take it over with /bot-lobby claim ${task.id}.` };
  }
  if (task && !task.ownerSessionId && deps.sessionId && CLAIM_ACTIONS.has(params.action)) task.ownerSessionId = deps.sessionId;
  if (!task) {
    return { ok: false, taskId: params.taskId ?? "", state: "created", message: "No bot-lobby task found. Start one with /bot-lobby <request>." };
  }
  if (TERMINAL_STATES.includes(task.state) && params.action !== "status") {
    return { ok: false, taskId: task.id, state: task.state, message: `Task ${task.id} is already ${task.state}; no further actions are possible.` };
  }
  if (task.paused && params.action !== "status" && params.action !== "decide") {
    return { ok: false, taskId: task.id, state: task.state, message: `Task ${task.id} is paused. Resume it before continuing.` };
  }
  const handler = HANDLERS[params.action];
  if (!handler) {
    return { ok: false, taskId: task.id, state: task.state, message: `Unknown action "${params.action}".` };
  }
  const finished = new Map<string, AgentRun>();
  const tracked: WorkflowDeps = {
    ...deps,
    onUpdate: (run) => {
      if (run.status !== "running") finished.set(run.runId, run);
      deps.onUpdate?.(run);
    },
  };
  try {
    const message = await handler(task, params, tracked);
    const runs = recordRunLog(task, finished, deps);
    saveTask(deps.root, deps.configDir, task);
    return { ok: true, taskId: task.id, state: task.state, message: `${message}${runsFooter(runs)}${budgetFooter(task, deps)}`, runs };
  } catch (error) {
    const runs = recordRunLog(task, finished, deps);
    saveTask(deps.root, deps.configDir, task);
    return { ok: false, taskId: task.id, state: task.state, message: `Rejected: ${(error as Error).message}${budgetFooter(task, deps)}`, runs };
  }
}

/** Append this action's finished runs to the task's bounded run log and the project's metrics log. */
function recordRunLog(task: Task, finished: ReadonlyMap<string, AgentRun>, deps: WorkflowDeps): AgentRun[] {
  const runs = [...finished.values()];
  if (runs.length > 0) {
    task.runLog = [...(task.runLog ?? []), ...runs.map(runLogEntry)].slice(-MAX_RUN_LOG);
    appendMetrics(deps.root, deps.configDir, runs.map(metricFromRun));
  }
  return runs;
}

/** One line per run so the Master sees timing, model and any partial-report flag. */
function runsFooter(runs: readonly AgentRun[]): string {
  if (runs.length === 0) return "";
  return `\n\nRuns:\n${runs.map((run) => `- ${describeRun(run)}`).join("\n")}`;
}
