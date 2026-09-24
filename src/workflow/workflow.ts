import { join } from "node:path";
import type { DevHouseConfig } from "../schemas/configuration.ts";
import type { AgentRun, ResearchResult, ReviewResult } from "../schemas/findings.ts";
import { TASK_STATES, TERMINAL_STATES, taskRequest, type Approval, type ApprovalKind, type Task, type TaskState } from "../schemas/task.ts";
import { isDomain, type Domain } from "../schemas/agent.ts";
import { transition } from "../state/task-state.ts";
import { removeTaskScratchpads, saveTask, selectTask, taskDirFor } from "../state/persistence.ts";
import { dataRoot, readDataRoots } from "../state/project.ts";
import { appendCompletedTask, appendDecision, applyKnowledge, readFileOr, writeFileEnsured, type KnowledgeKind } from "../knowledge/store.ts";
import { compactKnowledgeFile, overThreshold } from "../knowledge/compactor.ts";
import { knowledgeDir, scratchpadPath, type KnowledgeAgent } from "../knowledge/paths.ts";
import { writeScratchpad } from "../state/persistence.ts";
import { spawnPiProcess, type ProcessRunner } from "../execution/pi-runner.ts";
import { readRepositoryDiff } from "../execution/git.ts";
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
import { truncate } from "../text.ts";
import { assertNoPendingApprovals, pendingApprovals, requestApproval, resolveApproval } from "./approvals.ts";
import { pingApproval } from "../pi/notify.ts";
import { nextStates } from "./transitions.ts";

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
  "status",
  "cancel",
] as const;
export type OrchestrateAction = (typeof ORCHESTRATE_ACTIONS)[number];

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
  config: DevHouseConfig;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
  ask: (question: string) => Promise<string | undefined>;
  choose: (title: string, options: string[]) => Promise<string | undefined>;
  notify: (message: string, level?: "info" | "warning" | "error") => void;
  runProcess?: ProcessRunner;
}

export interface WorkflowResult {
  ok: boolean;
  taskId: string;
  state: TaskState;
  message: string;
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
  const answer = params.options?.length ? await deps.choose(question, params.options) : await deps.ask(question);
  if (answer === undefined) {
    return `No answer captured. Ask the user this in your reply, then continue.\n\nQuestion: ${question}`;
  }
  return `User answered: ${answer}`;
}

async function handleScout(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["created", "clarifying", "scouting", "synthesizing"]);
  const domains = deriveDomains(params.domains);
  if (task.state === "created") transition(task, "clarifying");
  if (task.state === "clarifying") transition(task, "scouting");
  const verifying = task.state === "synthesizing";
  const outcomes = await runScouts(
    {
      taskId: task.id,
      taskText: taskRequest(task),
      instruction: params.instruction?.trim() || "Investigate this request and report findings the Master needs.",
      domains,
      cwd: deps.cwd,
      dataRoots: readDataRoots(deps.root, deps.configDir),
      taskDir: taskDirFor(deps.root, deps.configDir, task.id),
      config: deps.config,
      signal: deps.signal,
      onUpdate: deps.onUpdate,
    },
    deps.runProcess ?? spawnPiProcess,
  );
  if (!verifying) transition(task, "synthesizing");
  const involved = outcomes.filter((outcome) => outcome.usable).map((outcome) => outcome.result.domain);
  task.domains = [...new Set([...task.domains, ...involved])];
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
): ResearchRequest {
  return {
    taskId: task.id,
    domain,
    instruction,
    config: deps.config,
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
  const outcome = await runResearch(researchRequestFor(deps, task, domain, instruction, taskDir), deps.runProcess ?? spawnPiProcess);
  appendResearchLog(taskDir, domain, outcome);
  return researchReport(outcome, researchResultPath(taskDir, domain));
}

async function handlePropose(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["created", "clarifying", "synthesizing", "awaiting_approval"]);
  const proposal = params.proposal?.trim();
  if (!proposal) throw new Error("propose requires a proposal");
  if (task.state === "created") transition(task, "clarifying");
  if (task.state === "clarifying") transition(task, "synthesizing");
  task.proposal = proposal;
  writeFileEnsured(join(taskDirFor(deps.root, deps.configDir, task.id), "proposal.md"), proposal);
  for (const concern of params.concerns ?? []) recordDecision(task, `Concern: ${concern}`);
  transition(task, "awaiting_approval");
  if (!deps.config.workflow.requireApprovalForFeatures) return applyApprovalChoice(task, "approve");
  const choice = await deps.choose(`Approve this proposal?\n\n${truncate(proposal, 2000)}`, APPROVAL_OPTIONS);
  if (!choice) return `Awaiting approval. Present the proposal to the user and continue after they respond.\n\n${proposal}`;
  const lower = choice.toLowerCase();
  if (lower.startsWith("approve")) return applyApprovalChoice(task, "approve");
  if (lower.startsWith("decline")) return applyApprovalChoice(task, "decline");
  return applyApprovalChoice(task, "amend", await deps.ask("What should change?"));
}

function handlePlan(task: Task, params: OrchestrateParams, deps: WorkflowDeps): string {
  requireState(task, ["planning"]);
  const plan = params.plan?.trim();
  if (!plan) throw new Error("plan requires the plan text");
  const missing = validatePlan(plan);
  if (missing.length > 0) throw new Error(`plan is missing: ${missing.join(", ")}`);
  task.plan = plan;
  writeFileEnsured(join(taskDirFor(deps.root, deps.configDir, task.id), "plan.md"), plan);
  return "Plan recorded. Next: call action=implement with domain and task for the first step.";
}

/** Record approvals a worker asked for; auto-approve when config allows it. */
function recordWorkerApprovals(task: Task, outcome: WorkerOutcome, config: DevHouseConfig): Approval[] {
  const created: Approval[] = [];
  const kinds: Array<[ApprovalKind, string, string[], boolean]> = [
    ["dependency", "dependencies", outcome.result.dependencyNeeds, config.workflow.requireApprovalForDependencies],
    ["architecture", "architecture changes", outcome.result.architectureChanges, config.workflow.requireApprovalForArchitectureChanges],
  ];
  for (const [kind, label, items, required] of kinds) {
    for (const detail of items) {
      if (required) {
        created.push(requestApproval(task, kind, outcome.result.domain, detail));
        pingApproval(outcome.result.domain, detail);
      } else recordDecision(task, `Auto-approved ${label}: ${detail}`, outcome.result.domain);
    }
  }
  return created;
}

function workerReport(outcome: WorkerOutcome, approvals: Approval[]): string {
  const { result, run, issues } = outcome;
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
    "Next: inspect the diff, then run action=qa once this domain's work is complete.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function updateScratchpad(deps: WorkflowDeps, task: Task, outcome: WorkerOutcome): void {
  const dir = taskDirFor(deps.root, deps.configDir, task.id);
  const domain = outcome.result.domain;
  const existing = readFileOr(scratchpadPath(dir, domain)).replace(/^#\s.*\n/, "").trim();
  const entry = [
    `### ${outcome.run.finishedAt ?? outcome.run.startedAt}`,
    outcome.result.completed || outcome.run.error || "no summary",
    ...outcome.result.filesChanged.map((file) => `- ${file.path}: ${file.change}`),
  ].join("\n");
  writeScratchpad(dir, domain, [existing, entry].filter(Boolean).join("\n\n"), deps.config.knowledge);
}

function workerTaskText(task: Task): string {
  return [
    `Requirements: ${taskRequest(task)}`,
    task.proposal ? `Approved objective: ${task.proposal}` : "",
    task.plan ? `Approved plan:\n${truncate(task.plan, 6000)}` : "",
    task.amendments.length > 0 ? `User amendments:\n${task.amendments.map((entry) => `- ${entry}`).join("\n")}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function workerRequest(deps: WorkflowDeps, task: Task, domain: Domain, instruction: string): WorkerRequest {
  return {
    taskId: task.id,
    domain,
    instruction,
    taskText: workerTaskText(task),
    scoutOutcomes: loadScoutResults(taskDirFor(deps.root, deps.configDir, task.id), [domain]),
    cwd: deps.cwd,
    dataRoots: readDataRoots(deps.root, deps.configDir),
    config: deps.config,
    signal: deps.signal,
    onUpdate: deps.onUpdate,
  };
}

async function handleImplement(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["planning", "implementing", "reviewing"]);
  const domain = parseDomain(params.domain, "implement");
  const instruction = params.task?.trim();
  if (!instruction) throw new Error("implement requires task (what to implement)");
  assertNoPendingApprovals(task, domain);
  if (!task.domains.includes(domain)) task.domains.push(domain);
  if (task.state !== "implementing") transition(task, "implementing");
  const outcome = await runWorker(workerRequest(deps, task, domain, instruction), deps.runProcess ?? spawnPiProcess);
  const approvals = recordWorkerApprovals(task, outcome, deps.config);
  task.blockers = [...task.blockers.filter((blocker) => blocker.domain !== domain), ...outcome.result.blockers];
  updateScratchpad(deps, task, outcome);
  return workerReport(outcome, approvals);
}

function handleResolveApproval(task: Task, params: OrchestrateParams): string {
  const id = params.approvalId?.trim();
  const decision = params.decision;
  if (!id || (decision !== "approved" && decision !== "rejected")) {
    throw new Error("resolve_approval requires approvalId and decision (approved|rejected)");
  }
  const approval = resolveApproval(task, id, decision, params.note);
  if (!approval) throw new Error(`no pending approval "${id}"`);
  recordDecision(task, `${decision} ${approval.kind} for ${approval.domain}: ${approval.detail}`);
  return decision === "approved"
    ? `${id} approved. The ${approval.domain} worker may now proceed with: ${approval.detail}`
    : `${id} rejected. Instruct the ${approval.domain} worker to achieve the goal without that change.`;
}

function scratchpadSummary(deps: WorkflowDeps, task: Task, domain: Domain): string {
  return readFileOr(scratchpadPath(taskDirFor(deps.root, deps.configDir, task.id), domain));
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
function allScratchpads(deps: WorkflowDeps, task: Task): string {
  return (["designer", "backend", "qa"] as Domain[])
    .map((domain) => scratchpadSummary(deps, task, domain).trim())
    .filter((text) => text.length > 0)
    .join("\n\n---\n\n");
}

const QA_INSTRUCTION = [
  "Run the QA quality gate for the completed feature.",
  "Verify requirements, acceptance criteria, regression risk, edge cases, security, accessibility,",
  "UX, reliability, and tests. Passing automated tests alone is not acceptance.",
].join(" ");

/** The QA gate looks at every domain's work, not just one worker's diff. */
function qaRequest(deps: WorkflowDeps, task: Task, diff: string, instruction?: string): ReviewerRequest {
  const taskDir = taskDirFor(deps.root, deps.configDir, task.id);
  return {
    taskId: task.id,
    domain: "qa",
    taskText: `${workerTaskText(task)}\n\nAcceptance criteria and plan:\n${truncate(task.plan ?? "", 5000)}`,
    workerSummary: allScratchpads(deps, task),
    scoutOutcomes: loadScoutResults(taskDir, [...new Set<Domain>(["qa", ...task.domains])]),
    diff,
    instruction: instruction?.trim() || QA_INSTRUCTION,
    cwd: deps.cwd,
    dataRoots: readDataRoots(deps.root, deps.configDir),
    config: deps.config,
    signal: deps.signal,
    onUpdate: deps.onUpdate,
  };
}

function qaReport(outcome: ReviewerOutcome, decision: "accept" | "iterate" | "blocked"): string {
  const { result, run, issues } = outcome;
  return [
    `QA gate: ${result.verdict.toUpperCase()} (run ${run.status}${run.error ? `: ${run.error}` : ""})`,
    result.findings.length > 0
      ? `Findings:\n${result.findings.map((finding) => `- [${finding.severity}] ${truncate(finding.text, 300)}`).join("\n")}`
      : "",
    result.requiredChanges.length > 0
      ? `Required changes:\n${result.requiredChanges.map((change) => `- ${truncate(change, 300)}`).join("\n")}`
      : "",
    decision === "accept"
      ? "The QA gate passed. Record any distilled knowledge, then call action=complete."
      : "The QA gate did not pass: delegate the required changes to the owning domain, then re-run action=qa.",
    decision === "blocked" ? "The review limit is reached: mark the task blocked and tell the user." : "",
    issues.length > 0 ? `Issues: ${issues.join("; ")}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

async function handleQa(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["implementing", "reviewing"]);
  if (task.state !== "reviewing") transition(task, "reviewing");
  const iterations = (task.reviewIterations?.qa ?? 0) + 1;
  task.reviewIterations = { qa: iterations };
  const diff = await readRepositoryDiff(deps.cwd);
  const outcome = await runReviewer(qaRequest(deps, task, diff, params.task), deps.runProcess ?? spawnPiProcess);
  task.qaVerdict = outcome.result.verdict;
  recordReview(task, "qa", outcome.result);
  const decision = decideReviewLoop(outcome.result.verdict, iterations, deps.config.workflow.maxReviewIterations);
  if (decision === "accept") task.blockers = task.blockers.filter((blocker) => blocker.domain !== "qa");
  return qaReport(outcome, decision);
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
function handleComplete(task: Task, params: OrchestrateParams, deps: WorkflowDeps): string {
  requireState(task, ["reviewing"]);
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
  status: (task) => describeTask(task),
  cancel: handleCancel,
};

/**
 * Single entry point for every orchestration step. The engine — not the
 * calling agent — decides whether an action is legal in the current state.
 */
export async function runWorkflowAction(params: OrchestrateParams, deps: WorkflowDeps): Promise<WorkflowResult> {
  const task = selectTask(deps.root, deps.configDir, params.taskId);
  if (!task) {
    return { ok: false, taskId: params.taskId ?? "", state: "created", message: "No dev-lobby task found. Start one with /dev-lobby <request>." };
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
  try {
    const message = await handler(task, params, deps);
    saveTask(deps.root, deps.configDir, task);
    return { ok: true, taskId: task.id, state: task.state, message };
  } catch (error) {
    saveTask(deps.root, deps.configDir, task);
    return { ok: false, taskId: task.id, state: task.state, message: `Rejected: ${(error as Error).message}` };
  }
}
