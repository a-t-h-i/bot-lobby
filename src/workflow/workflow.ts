import { validateAssignment, type WorkerAssignment, type AssignmentExpansionRequest } from "../execution/assignment.ts";
import { verifyEvidenceHint } from "../master/evidence-freshness.ts";
import { approveAssignmentDiscovery, prepareAssignmentDiscovery, readAssignmentDiscovery } from "../execution/assignment-discovery.ts";
import { cleanupTaskAssignedSessions } from "../execution/assigned-session.ts";
import { checkWorkerAssignments, recordWorkerAssignments } from "../state/persistence.ts";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { checkpointSummary, settledDecisions } from "../state/checkpoint.ts";
import { draftAssignments, draftAssignmentsNote } from "./draft-assignments.ts";
import { prefetchDomains, startScoutPrefetch, stopScoutPrefetch, takeScoutPrefetch } from "../master/scout-prefetch.ts";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { profileFor, type BotLobbyConfig, type ProfileResolver } from "../schemas/configuration.ts";
import type { AgentRun, Pushback, ResearchResult, ReviewResult } from "../schemas/findings.ts";
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
  type WorkerAssignmentRecord,
} from "../schemas/task.ts";
import { isDomain, type Domain } from "../schemas/agent.ts";
import { transition } from "../state/task-state.ts";
import { loadTask, ownerlessTask, readTaskArtifact, removeTaskScratchpads, saveTask, selectTask, taskDirFor, taskReadDirs } from "../state/persistence.ts";
import { dataRoot, readDataRoots } from "../state/project.ts";
import { appendCompletedTask, appendDecision, applyKnowledge, readFileOr, writeFileEnsured, type KnowledgeKind } from "../knowledge/store.ts";
import { compactKnowledgeFile, overThreshold } from "../knowledge/compactor.ts";
import { oracleBookmarkOp, retireBookmarks, type OracleBookmarkOp } from "../knowledge/bookmarks.ts";
import { knowledgeDir, type KnowledgeAgent } from "../knowledge/paths.ts";
import { lobbyTopics } from "../lobby/topics.ts";
import { writeScratchpad } from "../state/persistence.ts";
import { saveScript } from "../scripts/library.ts";
import { spawnPiProcess, type ProcessRunner, type RelayAsk } from "../execution/pi-runner.ts";
import { previewDir } from "../ask/relay.ts";
import type { AskQuestion, AskResult } from "../ask/types.ts";
import { mapConcurrent } from "../execution/agent-runner.ts";
import { taskExecution } from "../execution/task-cancellation.ts";
import { parseWorkerResult } from "../roles/worker.ts";
import { autoNote, DeskSession } from "../desk/session.ts";
import type { Handover } from "../desk/desk.ts";
import { treeState, changedFiles, commitBefore, commitFiles, commitMessage, headCommit, readRepositoryDiff, uncommitted } from "../execution/git.ts";
import { appendChange, explainChanges, provenanceLines, provenanceSummary, readChanges, type FileProvenance } from "../state/changes.ts";
import {
  loadScoutResults,
  runReviewer,
  runScouts,
  runWorker,
  type ReviewerRequest,
  type ScoutOutcome,
  type ScoutRequest,
  type WorkerOutcome,
  type WorkerRequest,
} from "../master/master.ts";
import { researchResultPath, runResearch, type ResearchOutcome, type ResearchRequest } from "../master/research.ts";
import { assessReconnaissance, completionBlockers, decideReviewLoop, recordDecision } from "../master/decisions.ts";
import { detectSharedFiles, summarizeOutcomes } from "../master/synthesis.ts";
import { assignmentId, boardContext, boardPath, filterPosts, formatPosts, readBoard, roleOf } from "../desk/board.ts";
import { seedDelivery } from "../desk/delivery.ts";
import { tail, truncate } from "../text.ts";
import { isAutoMode } from "../state/auto.ts";
import { briefRejection } from "./brief.ts";
import { assertNoPendingApprovals, pendingApprovals, requestApproval, resolveApproval } from "./approvals.ts";
import { withBlockingRequest } from "../state/blocking-requests.ts";
import { pingApproval } from "../pi/notify.ts";
import { describeRun, runLogEntry } from "../pi/run-summary.ts";
import { skippedStepsNote } from "../pi/plan-checklist.ts";
import { noteWorkerRun } from "../state/work-time.ts";
import { nextStates } from "./transitions.ts";
import type { FileHinter } from "../classifier/files.ts";
import type { KnowledgePicker } from "../classifier/knowledge.ts";
import type { Classifier } from "../classifier/classifier.ts";
import type { EffortRouter } from "../classifier/effort.ts";
import { answerClarify } from "../classifier/triage.ts";
import { appendMetrics, metricFromRun } from "../state/metrics.ts";
import { markCommentsAddressed, pendingComments, readPlanComments } from "../state/comments.ts";
import { builtSomething, fastNext, onFastTrack, parseRoster, PLANNED_NEXT, qaRequired, qaTookPart, readRequest, rosterWords, satOut, trackSummary } from "./track.ts";
import { requestBesidePlan } from "../state/backlog.ts";
import { missingWorktree, taskCwd } from "../execution/workspace.ts";
import { completionReview, deferReview, refreshReview } from "../delivery/review.ts";
import { deliver } from "../delivery/operations.ts";
import { deliveryStore } from "../delivery/store.ts";
import { execCommand, type Exec } from "../lobby/exec.ts";
import type { LintExec } from "../execution/lint.ts";
import type { LintReport } from "../schemas/lint.ts";
import { lintBrief, lintContext, lintHolds, lintRefusal, lintSummary, runLintGate } from "./lint.ts";
import { assessQaRisk, DEPTHS, qaRiskBrief, qaRiskLine, unreadRisk } from "../classifier/qa-risk.ts";
import type { QaRiskAssessment, TrackMember } from "../schemas/task.ts";

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
  "bookmark",
  "compact",
  "script",
  "complete",
  "block",
  "resume",
  "decide",
  "track",
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
  workerAssignment?: WorkerAssignment;
  assignments?: Array<{ domain: string; task?: string; workerAssignment?: WorkerAssignment }>;
  discoveryAllowance?: { assignmentId: string; revision: number; decisionId: string; reason: string; limit: number };
  /** knowledge: which persistent file the text belongs to. */
  kind?: KnowledgeKind;
  /** bookmark: the operation on the task's bookmark list. */
  op?: "add" | "remove" | "pin" | "unpin" | "exclude";
  /** bookmark: the reference ids, exactly as search_knowledge returned them. */
  refs?: string[];
  /** compact: the knowledge file being rewritten; script: a drafted script to take instead of `text`. */
  file?: string;
  /** script: the script's file name (`seed_public_holidays.py`). */
  name?: string;
  /** script: one line on what the script does. */
  purpose?: string;
  /** script: how to run it, with its arguments. */
  usage?: string;
  approvalId?: string;
  decision?: "approved" | "rejected";
  note?: string;
  reason?: string;
  text?: string;
  /** complete: the commit message for the agents' changes. */
  message?: string;
  /** track: the path the task takes. */
  track?: "fast" | "full";
  /** track: who takes part (designer, backend, qa, researcher). */
  roster?: string[];
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
  /** Puts an agent's questions to the user (the questionnaire, `from` naming the agent); absent without a UI. */
  askQuestions?: (questions: AskQuestion[], from: string, signal?: AbortSignal) => Promise<AskResult>;
  notify: (message: string, level?: "info" | "warning" | "error") => void;
  runProcess?: ProcessRunner;
  /** Command seam for completion's bounded git/gh calls. */
  exec?: Exec;
  /** Likely files for scouts and workers, while the classifier's file hints are on. */
  hints?: FileHinter;
  /** Picks the relevant sections of long knowledge files for scouts, workers and the QA gate, while the classifier's knowledge picks are on. */
  knowledge?: KnowledgePicker;
  /** Answers a clarify question whose recommended option is clearly right, when it is on. */
  classifier?: Classifier;
  /** Re-reads a request after an amendment (the task's triage), when the classifier is on. */
  triage?: (request: string, signal?: AbortSignal) => Promise<Task["triage"]>;
  /** Lowers thinking or the model for scouts and workers on steps the classifier judges simple or trivial. */
  effort?: EffortRouter;
  /** Runs a linter for the lint gate (tests); the real one otherwise. */
  lintExec?: LintExec;
  /** Told each new lint report on a task's touched files (the lobby's activity log). */
  onLint?: (taskId: string, report: LintReport) => void;
  /** Told each QA risk read of a task's change (the lobby's activity log). */
  onQaRisk?: (taskId: string, assessment: QaRiskAssessment) => void;
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
    task.track ? trackSummary(task.track) : "",
    task.qaRisk ? `${qaRiskLine(task.qaRisk)} — ${task.qaRisk.reasoning}` : "",
    task.domains.length > 0 ? `Domains: ${task.domains.join(", ")}` : "",
    `Review iterations: ${Object.entries(task.reviewIterations).map(([d, n]) => `${d}=${n}`).join(", ")}`,
    pendingApprovals(task).length > 0
      ? `Pending approvals: ${pendingApprovals(task).map((a) => `${a.id} ${a.kind} for ${a.domain}: ${truncate(a.detail, 120)}`).join("; ")}`
      : "",
    task.blockers.length > 0 ? `Blockers: ${task.blockers.map((b) => b.reason).join("; ")}` : "",
    ...(task.workerAssignments ?? []).map(assignmentStatus),
    skippedStepsNote(task.plan, task.skippedSteps),
    settledDecisions(task),
    checkpointSummary(task),
    `Next legal states: ${nextStates(task.state).join(", ")}`,
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

function assignmentStatus(entry: WorkerAssignmentRecord): string {
  const outcome = entry.outcomes.filter((outcome) => outcome.revision === entry.brief.revision).at(-1);
  return `Assignment ${entry.brief.id} r${entry.brief.revision} (${entry.domain}): ${outcome?.status ?? "prepared"}; freshness=${outcome?.freshness?.status ?? "unverified hints"}; issues=${JSON.stringify(outcome?.issues ?? [])}; verification=${JSON.stringify(outcome?.verification ?? "")}; completedWork=${JSON.stringify(outcome?.completedWork ?? entry.brief.completedWork)}; needs=${JSON.stringify(outcome?.needs ?? entry.brief.needs)}`;
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
    return `The user did not answer. Do not assume an answer or pick the recommended option: ask the user this again in your reply, end your turn, and continue only once they have answered.\n\nQuestion: ${question}`;
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

/** The scout request for a task, as the oracle's scout action and the task's opening scout both make it. */
function scoutRequestFor(task: Task, deps: WorkflowDeps, instruction: string, domains: Domain[], signal = deps.signal): ScoutRequest {
  return {
    taskId: task.id,
    taskText: taskRequest(task),
    instruction,
    domains,
    cwd: deps.cwd,
    dataRoots: readDataRoots(deps.root, deps.configDir),
    taskDir: taskDirFor(deps.root, deps.configDir, task.id),
    config: deps.config,
    profile: deps.profile,
    signal,
    onUpdate: deps.onUpdate,
    ...(deps.hints ? { hints: deps.hints } : {}),
    ...(deps.knowledge ? { knowledge: deps.knowledge } : {}),
    ...(deps.effort ? { effort: deps.effort } : {}),
  };
}

const DEFAULT_SCOUT_INSTRUCTION = "Investigate this request and report findings the Master needs.";

/**
 * Start the task's opening scout while the oracle reads the request: the full
 * workflow only (the fast track and an agreed plan skip scouting), over the
 * domains the triage names. Returns the domains it scouts; none when it did not start.
 */
export function prefetchScouts(task: Task, config: BotLobbyConfig, makeDeps: () => WorkflowDeps): Domain[] {
  if (!config.workflow.prefetchScout || task.approvedPlan || task.track?.path === "fast") return [];
  const domains = prefetchDomains(task.triage);
  if (domains.length === 0) return [];
  const deps = makeDeps();
  const cwd = taskCwd(task, deps.cwd);
  const started = startScoutPrefetch(task.id, domains, (signal, onRun) => runScouts({ ...scoutRequestFor(task, { ...deps, cwd }, DEFAULT_SCOUT_INSTRUCTION, domains, signal), onUpdate: onRun }, deps.runProcess ?? spawnPiProcess));
  return started ? domains : [];
}

async function handleScout(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["created", "clarifying", "scouting", "synthesizing"]);
  const domains = deriveDomains(params.domains);
  if (task.state === "created") transition(task, "clarifying");
  if (task.state === "clarifying") transition(task, "scouting");
  const verifying = task.state === "synthesizing";
  const instruction = params.instruction?.trim() || DEFAULT_SCOUT_INSTRUCTION;
  // The scout that started with the task answers the first ask it covers; a pointed follow-up runs on its own.
  const prefetch = verifying ? await stopScoutPrefetch(task.id) : await takeScoutPrefetch(task.id, domains);
  // Its runs are this action's too, used or not, so the task's run log and costs count them once.
  for (const run of prefetch?.runs ?? []) deps.onUpdate?.(run);
  const early = prefetch?.outcomes;
  const outcomes = early ?? await runScouts(scoutRequestFor(task, deps, instruction, domains), deps.runProcess ?? spawnPiProcess);
  if (!verifying) transition(task, "synthesizing");
  const involved = outcomes.filter((outcome) => outcome.usable).map((outcome) => outcome.result.domain);
  task.domains = [...new Set([...task.domains, ...involved])];
  recordAdvisoryPushbacks(task, outcomes.map((outcome) => ({ pushback: outcome.result.pushback, who: outcome.result.domain })));
  const report = scoutReport(outcomes, verifying);
  return early ? `${report}\n\nThese findings come from the scout that started with the task (it investigated the request as a whole). For a specific gap, scout again with a pointed instruction.` : report;
}

/** Research is evidence gathering, so it is legal in every non-terminal state. */
const RESEARCH_STATES: TaskState[] = TASK_STATES.filter((state) => !TERMINAL_STATES.includes(state));

const RESEARCH_DEGRADED =
  "The researcher is spawned with read-only repository tools plus bot-lobby's web tools (web_search, fetch_content, source_check, get_search_content). A run without sources usually means the web could not be reached or the search was refused: its tool errors say which (DuckDuckGo, the default, throttles automated searches; BRAVE_API_KEY, TAVILY_API_KEY, EXA_API_KEY or SEARXNG_URL gives a dependable search).";

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
): ResearchRequest {
  return {
    taskId: task.id,
    domain,
    instruction,
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
  const benched = benchedRefusal(task, "researcher");
  if (benched) throw new Error(benched);
  const domain = parseDomain(params.domain, "research");
  const instruction = params.instruction?.trim();
  if (!instruction) throw new Error("research requires instruction (the question to investigate)");
  const taskDir = taskDirFor(deps.root, deps.configDir, task.id);
  const outcome = await runResearch(researchRequestFor(deps, task, domain, instruction, taskDir), deps.runProcess ?? spawnPiProcess);
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
  // The request already says what the user wants: a proposal goes straight on. Only new dependencies and architecture changes stop for the user.
  return applyApprovalChoice(task, "approve");
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
  // The fast track keeps a short plan, and a planned task's is the one the panel agreed: the required areas are for a plan the oracle writes.
  const missing = onFastTrack(task) || task.approvedPlan ? [] : validatePlan(plan);
  if (missing.length > 0) throw new Error(`plan is missing: ${missing.join(", ")}`);
  const amending = AMEND_PLAN_STATES.includes(task.state);
  task.plan = plan;
  if (task.track?.autoPlan) delete task.track.autoPlan;
  writeFileEnsured(join(taskDirFor(deps.root, deps.configDir, task.id), "plan.md"), plan);
  const addressed = addressComments(task, deps);
  if (amending) {
    recordDecision(task, `Plan amended${addressed > 0 ? ` for ${addressed} user comment${addressed === 1 ? "" : "s"}` : ""}.`);
    return `Plan amended.${commentsNote(addressed)} Next: continue with action=implement for the next open step (or action=qa when the work is complete).`;
  }
  const drafts = draftAssignmentsNote(draftAssignments(plan, deps.cwd));
  return [`Plan recorded.${commentsNote(addressed)} Next: call action=implement with domain and workerAssignment for the first step.`, drafts].filter(Boolean).join("\n\n");
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

const FULL_NEXT = "Next: inspect the diff, then run action=qa once this domain's work is complete.";

function workerReport(outcome: WorkerOutcome, approvals: Approval[], pushback?: Approval, next = FULL_NEXT, fullReport = ""): string {
  const { result, run, issues } = outcome;
  const objection = result.pushback;
  return [
    `Worker ${result.domain}: ${run.status}${run.error ? ` (${run.error})` : ""}`,
    fullReport ? `Full report: ${fullReport} (read it for detail the lines below shorten)` : "",
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
    result.scriptProposals?.length
      ? `Script proposals (save with action=script name purpose usage file=<draft>, when the job will come back; or ignore): ${result.scriptProposals.map((proposal) => `${proposal.name}${proposal.purpose ? ` — ${truncate(proposal.purpose, 120)}` : ""}${proposal.draft ? ` (draft: ${proposal.draft})` : ""}`).join("; ")}`
      : "",
    workerNeeds(outcome).length > 0 ? `Expansion requests: ${JSON.stringify(workerNeeds(outcome))}` : "",
    issues.length > 0 ? `Issues: ${issues.join("; ")}` : "",
    pushback && objection
      ? `Pushback recorded (${pushback.id}): ${truncate(objection.reason, 240)}. Resolve with action=resolve_approval before re-delegating ${result.domain}.`
      : "",
    next,
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
    // A planned task's request is its plan: it is sent once, as the plan.
    `Requirements: ${task.approvedPlan && task.plan ? requestBesidePlan(taskRequest(task)) : taskRequest(task)}`,
    task.proposal ? `Approved objective: ${task.proposal}` : "",
    task.plan ? `Approved plan:\n${planWithin(task.plan, planBudget)}` : "",
    settledDecisions(task),
    task.amendments.length > 0 ? `User amendments:\n${task.amendments.map((entry) => `- ${entry}`).join("\n")}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

/** The task's board: one file in its directory that every agent of the task posts to and reads. */
function taskBoard(deps: WorkflowDeps, task: Task): string {
  return boardPath(taskDirFor(deps.root, deps.configDir, task.id));
}

/** The board lines a starting agent is shown, recorded as a delivery so pushes never re-send or skip them. */
function seedAndReadBoard(path: string, reader: string): string {
  seedDelivery(path, reader);
  return boardContext(path, reader);
}

/** What the agents posted to the board during this action, for the oracle. */
function boardNews(deps: WorkflowDeps, task: Task, after: number): string {
  const posts = filterPosts(readBoard(taskBoard(deps, task)), { after, limit: 40 });
  return posts.length > 0 ? `Task board, new posts:\n${formatPosts(posts)}` : "";
}

function workerRequest(deps: WorkflowDeps, task: Task, domain: Domain, instruction: string, alongside?: readonly Domain[], boardFrom?: string, assignment?: WorkerAssignment): WorkerRequest {
  const ask = askRelay(task, deps, domain);
  return {
    ...(assignment ? {
      assignment,
      onFreshness: (freshness) => {
        deps.notify(`Assignment ${freshness.assignmentId} r${freshness.revision}: ${freshness.status}${freshness.pause ? "; pause dependent work and recheck it" : ""}.`, freshness.pause ? "warning" : "info");
      },
    } : {}),
    board: taskBoard(deps, task),
    boardFrom: boardFrom ?? assignmentId(domain),
    ...(alongside && alongside.length > 1 ? { alongside } : {}),
    ...(ask ? { ask } : {}),
    // QA writing tests works to the same budget as the gate: the risk of what is built so far.
    ...(domain === "qa" && task.qaRisk ? { risk: qaRiskBrief(task.qaRisk) } : {}),
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
    ...(deps.knowledge ? { knowledge: deps.knowledge } : {}),
    ...(deps.effort ? { effort: deps.effort } : {}),
  };
}

const ANSWER_NOW = "Answer the questions now";
/** Times an agent's abandoned questions are put to the user again before it decides. */
const MAX_NUDGES = 5;

/** Agents that may ask the user themselves: the designer, whose choices are the user's to see. */
const ASKING_DOMAINS: ReadonlySet<Domain> = new Set(["designer"]);

/**
 * The relay for a worker allowed to ask the user: its questions wait their
 * turn behind any other dialog, go to the user with every clock stopped, and
 * the answers become task decisions. Never in auto mode (nobody to ask), and
 * never without a UI.
 */
function askRelay(task: Task, deps: WorkflowDeps, domain: Domain): { onAsk: RelayAsk; previews: string } | undefined {
  if (!ASKING_DOMAINS.has(domain) || !deps.askQuestions || isAutoMode(deps.root, deps.configDir, task.id)) return undefined;
  const askQuestions = deps.askQuestions;
  const label = AGENT_LABELS[domain];
  const previews = previewDir(task.id, deps.root);
  try {
    mkdirSync(previews, { recursive: true });
  } catch {
    // Without the folder it can still ask with Markdown previews.
  }
  const onAsk: RelayAsk = (questions, signal) =>
    oneAtATime(async () => {
      if (signal.aborted) return { answers: [], cancelled: true };
      if (isAutoMode(deps.root, deps.configDir, task.id)) {
        return { answers: [], cancelled: true, globalNote: "Auto mode is on, so nobody can answer: decide with the options you recommend and say in your report what you chose and why." };
      }
      let result = await askQuestions(questions, label, signal);
      // Leaving the questions must not quietly hand the choice to the agent: ask whether it may decide.
      for (let nudges = 0; result.answers.length === 0 && result.cancelled && !signal.aborted && nudges < MAX_NUDGES; nudges++) {
        const choice = await deps.choose(`${label} is waiting for your answer${questions.length === 1 ? "" : "s"} (${questions.map((question) => question.header).join(", ")}).`, [ANSWER_NOW, `Let ${label} decide with its recommendation`]);
        if (choice !== ANSWER_NOW && choice !== undefined) break;
        result = await askQuestions(questions, label, signal);
      }
      recordDecision(task, askedDecision(label, questions, result), domain);
      return result;
    });
  return { onAsk, previews };
}

/** An agent's questions and the user's answers, as the task's decision record keeps them. */
export function askedDecision(label: string, questions: readonly AskQuestion[], result: AskResult): string {
  if (result.answers.length === 0) return `${label} asked the user about ${questions.map((question) => question.header).join(", ")}; they did not answer, so ${label} decides.`;
  const lines = questions.map((question, index) => {
    const answer = result.answers.find((entry) => entry.questionIndex === index);
    const text = !answer ? "not answered" : answer.kind === "multi" ? (answer.selected ?? []).join(", ") : `${answer.answer ?? ""}${answer.kind === "custom" ? " (in their words)" : ""}`;
    return `[${question.header}] ${oneLine(question.question, 120)} → ${oneLine(text, 200)}`;
  });
  return `${label} asked the user: ${lines.join("; ")}`;
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
  assignment?: WorkerAssignment;
}

/** The delegation as a list: `assignments` for a parallel batch, otherwise the single domain/task. */
async function parseAssignments(params: OrchestrateParams, cwd: string): Promise<Assignment[]> {
  if (params.assignments !== undefined && (params.workerAssignment !== undefined || params.domain !== undefined || params.task !== undefined)) throw new Error("Use either assignments or a single domain/workerAssignment, not both");
  const entries = params.assignments ?? [{ domain: params.domain, task: params.task, workerAssignment: params.workerAssignment }];
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("implement assignments must not be empty");
  const list: Assignment[] = [];
  for (const entry of entries) {
    const domain = parseDomain(entry.domain, "implement");
    if (entry.workerAssignment === undefined) {
      if (!entry.task?.trim()) throw new Error("implement requires task or workerAssignment");
      list.push({ domain, instruction: entry.task.trim() });
    } else {
      const assignment = await validateAssignment(entry.workerAssignment, cwd);
      list.push({ domain, instruction: entry.task?.trim() || assignment.objective, assignment });
    }
  }
  if (new Set(list.map((entry) => entry.domain)).size !== list.length) throw new Error("parallel assignments need distinct domains (one worker per domain)");
  return list;
}

async function checkDiscoveryAllowances(task: Task, batch: { assignment: WorkerAssignment }[], deps: WorkflowDeps): Promise<void> {
  for (const { assignment } of batch) {
    if ((assignment.discoveryLimit ?? 2) <= 2) continue;
    const prior = task.workerAssignments?.find((entry) => entry.brief.id === assignment.id);
    if (!prior) throw new Error(`Assignment ${assignment.id}: persist a brief with the default discovery allowance before requesting a master decision`);
    const ledger = await readAssignmentDiscovery(taskDirFor(deps.root, deps.configDir, task.id), assignment.id, prior.brief.revision);
    if ((assignment.discoveryLimit ?? 2) > ledger.limit) throw new Error(`Assignment ${assignment.id}: discovery limit requires an explicit master allowance decision`);
  }
}

async function decideDiscoveryAllowance(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  if (params.domain !== undefined && params.domain !== "master") throw new Error("discoveryAllowance is master-only");
  const allowance = params.discoveryAllowance!;
  const keys = ["assignmentId", "revision", "decisionId", "reason", "limit"];
  if (!allowance || Object.keys(allowance).some((key) => !keys.includes(key)) || typeof allowance.assignmentId !== "string" || typeof allowance.decisionId !== "string" || !allowance.decisionId.trim() || typeof allowance.reason !== "string" || !allowance.reason.trim() || !Number.isSafeInteger(allowance.limit) || allowance.limit < 0) throw new Error("discoveryAllowance requires exactly assignmentId, revision, decisionId, reason and a non-negative integer limit");
  const record = task.workerAssignments?.find((entry) => entry.brief.id === allowance.assignmentId);
  if (!record || record.brief.revision !== allowance.revision) throw new Error("discoveryAllowance must identify the current persisted assignment revision");
  const dir = taskDirFor(deps.root, deps.configDir, task.id);
  let ledger;
  try {
    ledger = await readAssignmentDiscovery(dir, allowance.assignmentId, allowance.revision);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ledger missing;") && !message.includes("is not prepared; current revision is")) throw error;
    ledger = await prepareAssignmentDiscovery(dir, allowance.assignmentId, allowance.revision, Math.min(record.brief.discoveryLimit ?? 2, 2));
  }
  const existing = ledger.decisions.find((entry) => entry.decisionId === allowance.decisionId);
  if (existing && (existing.reason !== allowance.reason || existing.limit !== allowance.limit)) throw new Error("discoveryAllowance decisionId already records different content");
  if (!existing && allowance.limit <= ledger.limit) throw new Error("discoveryAllowance must increase the approved total");
  // Durable audit first: a crash may leave a decision awaiting application, never an unaudited increase.
  const text = `Discovery allowance: ${JSON.stringify(allowance)}`;
  if (!task.decisions.some((entry) => entry.domain === "master" && entry.text === text)) {
    recordDecision(task, text, "master");
    task.decisions.at(-1)!.discoveryAllowance = structuredClone(allowance);
  }
  saveTask(deps.root, deps.configDir, task);
  await approveAssignmentDiscovery(dir, allowance.assignmentId, allowance.revision, allowance);
  return `Discovery allowance recorded (${allowance.assignmentId} r${allowance.revision}, limit ${allowance.limit}). Revise the brief to use the approved limit.`;
}

async function refreshAssignmentEvidence(task: Task, deps: WorkflowDeps): Promise<void> {
  for (const entry of task.workerAssignments ?? []) {
    const outcome = entry.outcomes.filter((item) => item.revision === entry.brief.revision).at(-1);
    const freshness = outcome?.freshness;
    if (!freshness || freshness.status !== "verified") continue;
    // Legacy metadata without source snapshots cannot establish current evidence.
    const checks = await Promise.all((freshness.hints ?? []).map((hint) => verifyEvidenceHint(deps.cwd, hint, () => treeState(deps.cwd, readDataRoots(deps.root, deps.configDir)))));
    if (freshness.hints && checks.every(Boolean)) continue;
    freshness.status = "invalidated";
    freshness.pause = true;
    freshness.recheckCompletedWork = true;
    outcome!.issues = [...(outcome!.issues ?? []), "Evidence changed or source snapshots are missing; recheck dependent work in a new assignment revision"];
    deps.notify(`Assignment ${entry.brief.id} r${entry.brief.revision}: evidence invalidated; recheck dependent work.`, "warning");
  }
}

export function workerAssignmentHolds(task: Task): string[] {
  return (task.workerAssignments ?? []).flatMap(({ brief, outcomes }) => {
    const latest = outcomes.filter((outcome) => outcome.revision === brief.revision).at(-1);
    const fresh = latest?.freshness;
    const verified = latest?.verification?.trim();
    if (latest?.status === "success" && Array.isArray(latest.issues) && latest.issues.length === 0 && latest.needs.length === 0 && fresh?.assignmentId === brief.id && fresh.revision === brief.revision && fresh.status === "verified" && (brief.files.every((file) => file.access === "reference") || verified)) return [];
    return [`Assignment ${brief.id} r${brief.revision} needs a successful issue-free latest outcome, resolved needs, current verified evidence and verification for edits`];
  });
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

/** Every changed file of the working tree, explained for this task, with the repository's top; undefined without a baseline or git. */
async function changeState(deps: WorkflowDeps, task: Task, base?: string): Promise<{ top: string; files: FileProvenance[] } | undefined> {
  if (!task.baseline) return undefined;
  const tree = await treeChanges(deps, base);
  if (!tree) return undefined;
  return { top: tree.top, files: explainChanges(task, tree.files, tree.top, readChanges(deps.root, deps.configDir, task.createdAt)) };
}

/**
 * The lint gate (see lint.ts): lint the files this task's agents touched, as
 * they stand, record the report on the task and tell the lobby when it is
 * new. `tree` is the change state measured from the task's baseline, when the
 * caller already has it. Nothing runs with lint off or before any worker.
 */
async function lintTask(task: Task, deps: WorkflowDeps, tree?: { top: string; files: FileProvenance[] }): Promise<LintReport | undefined> {
  if (deps.config.lint.mode === "off" || !task.baseline) return undefined;
  const state = tree ?? (await changeState(deps, task, task.baseline.head));
  if (!state) return undefined;
  const files = state.files.filter((file) => file.kinds.includes("planned") && existsSync(join(state.top, file.path))).map((file) => file.path);
  const before = task.lint;
  const report = await runLintGate({
    top: state.top,
    files,
    ...(task.baseline.head ? { base: task.baseline.head } : {}),
    config: deps.config.lint,
    ...(before ? { previous: before } : {}),
    ...(deps.lintExec ? { exec: deps.lintExec } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  task.lint = report;
  if (report !== before && report.state !== "skipped") deps.onLint?.(task.id, report);
  return report;
}

/** Who changed the tree, for the Master: counts, and what the changes that are not this task's mean for it. */
function provenanceNote(files: readonly FileProvenance[] | undefined): string {
  if (!files || files.length === 0) return "";
  const kinds = new Set(files.flatMap((file) => file.kinds));
  return [
    `Changed files: ${provenanceSummary(files)}.`,
    kinds.has("chat") ? "The user asked for the lobby chat's changes directly: never revert them or send them back as fixes." : "",
    kinds.has("pre-existing") || kinds.has("other-task") ? "Pre-existing changes and other tasks' are not this task's to review or revert." : "",
    kinds.has("unattributed") ? "No agent recorded the unattributed edits: ask the user before counting them in or reverting them." : "",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

/** Record one worker's outcome on the task and return its report for the Master. */
function absorbWorkerOutcome(task: Task, deps: WorkflowDeps, outcome: WorkerOutcome, assignment?: WorkerAssignment): string {
  if (assignment) recordAssignmentOutcome(task, outcome, assignment);
  const domain = outcome.result.domain;
  recordWorkerRun(task, outcome.run);
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
  const grown = qaJoinsGrownFastTask(task, outcome);
  const full = saveFullReport(deps, task, outcome);
  const report = workerReport(outcome, approvals, pushback, onFastTrack(task) ? fastNext(task) : qaRequired(task) ? FULL_NEXT : PLANNED_NEXT, full);
  return [report, grown].filter(Boolean).join("\n");
}

function recordAssignmentOutcome(task: Task, outcome: WorkerOutcome, assignment: WorkerAssignment): void {
  const record = task.workerAssignments?.find((entry) => entry.brief.id === assignment.id);
  if (!record) throw new Error(`Missing persisted worker assignment ${assignment.id}`);
  record.outcomes.push({
    revision: assignment.revision,
    runId: outcome.run.runId,
    status: outcome.run.status,
    issues: [...outcome.issues],
    verification: outcome.result.verification,
    ...(outcome.freshness ? { freshness: structuredClone(outcome.freshness) } : {}),
    completedWork: [...new Set([...assignment.completedWork, ...(outcome.result.completed ? [outcome.result.completed] : [])])],
    needs: structuredClone([...assignment.needs, ...workerNeeds(outcome)]),
    ...(outcome.run.finishedAt ? { finishedAt: outcome.run.finishedAt } : {}),
  });
}

function workerNeeds(outcome: WorkerOutcome): AssignmentExpansionRequest[] {
  return (outcome.result as typeof outcome.result & { needs?: AssignmentExpansionRequest[] }).needs ?? [];
}

/** Reports longer than this are kept whole in a file and the oracle gets the path. */
const LONG_REPORT = 2400;

/**
 * Keep a long worker report whole in the task's `reports/` folder, so the
 * oracle reads what it needs from the file instead of getting a shortened
 * copy relayed through its own context. Returns the path, or "".
 */
function saveFullReport(deps: WorkflowDeps, task: Task, outcome: WorkerOutcome): string {
  const output = outcome.run.output?.trim() ?? "";
  if (output.length <= LONG_REPORT) return "";
  const stamp = (outcome.run.finishedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  const path = join(taskDirFor(deps.root, deps.configDir, task.id), "reports", `${outcome.result.domain}-${stamp}.md`);
  try {
    writeFileEnsured(path, `${output}\n`);
    return path;
  } catch {
    return "";
  }
}

/**
 * A fast task whose worker asks for a new dependency or an architecture
 * change is not the small change it read as: QA joins, so it is checked
 * before it completes. Returns the line for the oracle, or "".
 */
function qaJoinsGrownFastTask(task: Task, outcome: WorkerOutcome): string {
  const track = task.track;
  if (!track || track.path !== "fast" || track.roster.includes("qa")) return "";
  const asks = [...outcome.result.dependencyNeeds, ...outcome.result.architectureChanges];
  if (asks.length === 0) return "";
  track.roster = parseRoster([...track.roster, "qa"]);
  track.reasons = [...track.reasons, `tests: ${AGENT_LABELS[outcome.result.domain]} asked for a dependency or an architecture change`];
  recordDecision(task, `QA joined the fast track: ${AGENT_LABELS[outcome.result.domain]} asked for ${truncate(asks.join("; "), 200)}.`);
  return "QA now takes part: a fast-track change that needs a new dependency or an architecture change is checked before it completes.";
}

/** Read the risk of what the task has built so far, from its diff: the gate's way in, for a QA step or completion. */
async function assessBuilt(task: Task, deps: WorkflowDeps): Promise<QaRiskAssessment | undefined> {
  const base = await reviewBase(task, deps);
  const [diff, tree] = await Promise.all([
    readRepositoryDiff(deps.cwd, { ...(base ? { base } : {}), exclude: ownRecords(deps) }),
    changeState(deps, task, base),
  ]);
  const read = await readTaskRisk(task, deps, diff, tree, base);
  if (read) {
    task.qaRisk = read;
    deps.onQaRisk?.(task.id, read);
  }
  return read;
}

/**
 * The fast track left QA out because the request read small and safe; the
 * change it built is what counts. One Jev reads as MEDIUM or HIGH risk gets
 * QA before it completes. Returns the refusal for the oracle, or "".
 */
async function qaJoinsRiskyFastTask(task: Task, deps: WorkflowDeps): Promise<string> {
  const track = task.track;
  if (!track || track.path !== "fast" || track.roster.includes("qa") || task.qaWaiver || !builtSomething(task)) return "";
  const risk = await assessBuilt(task, deps);
  if (!risk || (risk.risk !== "medium" && risk.risk !== "high")) return "";
  track.roster = parseRoster([...track.roster, "qa"]);
  track.reasons = [...track.reasons, `tests: the change reads ${risk.risk} risk`];
  recordDecision(task, `QA joined the fast track: the change reads ${risk.risk.toUpperCase()} risk (${truncate(risk.riskFactors.join("; "), 200)}).`);
  return `QA joins before completion: ${qaRiskLine(risk)}. Run action=qa, then complete.`;
}

/** States a fast task starts its work from: before anything is planned, and never while the user decides on a proposal. */
const FAST_START_STATES: readonly TaskState[] = ["created", "clarifying", "scouting", "synthesizing"];

async function handleImplement(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  const starting = onFastTrack(task) && FAST_START_STATES.includes(task.state);
  if (!starting && FAST_START_STATES.includes(task.state)) {
    throw new Error(`action not allowed in state "${task.state}": on the full workflow the user approves a proposal first (a small, clear change can take the fast track: action=track track=fast)`);
  }
  if (!starting) requireState(task, ["planning", "implementing", "reviewing"]);
  const assignments = await parseAssignments(params, deps.cwd);
  const structured = assignments.flatMap(({ domain, assignment }) => assignment ? [{ domain, assignment }] : []);
  checkWorkerAssignments(task, structured);
  // A harness cannot keep a sanitized conversation or attest its tools: refuse here, before anything is recorded.
  const harnessed = structured.filter(({ domain }) => profileFor(deps.config, deps.profile, domain, "worker").harness).map(({ domain }) => domain);
  if (harnessed.length > 0) throw new Error(`${harnessed.join(", ")} runs on a third-party harness, which cannot run a structured workerAssignment; send that step as a prose task instead.`);
  await checkDiscoveryAllowances(task, structured, deps);
  const benched = assignments.map((entry) => benchedRefusal(task, entry.domain)).filter(Boolean);
  if (benched.length > 0) throw new Error(benched.join("\n"));
  const short = !deps.config.workflow.briefCheck ? [] : assignments.filter((entry) => !entry.assignment).map((entry) => briefRejection(task.id, entry.domain, entry.instruction)).filter(Boolean);
  if (short.length > 0) throw new Error(short.join("\n"));
  for (const { domain } of assignments) assertNoPendingApprovals(task, domain);
  if (structured.length) recordWorkerAssignments(task, structured);
  saveTask(deps.root, deps.configDir, task);
  checkWorkerAssignments(task, structured);
  for (const { domain } of assignments) if (!task.domains.includes(domain)) task.domains.push(domain);
  if (task.track && onFastTrack(task)) task.track.roster = parseRoster([...task.track.roster, ...assignments.map((entry) => entry.domain)]);
  if (starting) startFast(task);
  if (task.track?.autoPlan) addFastSteps(task, deps, assignments);
  if (task.state !== "implementing") transition(task, "implementing");
  await takeBaseline(task, deps);
  // A QA step after work is in verifies it at its risk: read the change first.
  if (assignments.some((entry) => entry.domain === "qa") && builtSomething(task)) await assessBuilt(task, deps);
  const boardBefore = readBoard(taskBoard(deps, task)).at(-1)?.seq ?? 0;
  let report: string;
  if (assignments.length === 1) {
    const { domain, instruction, assignment } = assignments[0]!;
    const outcome = await runWorker(workerRequest(deps, task, domain, instruction, undefined, undefined, assignment), deps.runProcess ?? spawnPiProcess);
    report = absorbWorkerOutcome(task, deps, outcome, assignment);
  } else report = await runParallelWorkers(task, deps, assignments);
  const tree = await changeState(deps, task, task.baseline?.head);
  // Lint runs once the work is in: before QA and at completion, not after every step.
  return [report, boardNews(deps, task, boardBefore), provenanceNote(tree?.files)].filter(Boolean).join("\n\n");
}

/**
 * The fast track's start: the request is small and clear, so it goes from
 * shaping straight to planning without a proposal round (the engine walks the
 * same states, so every transition stays legal), and the engine keeps a short
 * plan whose steps are the delegations themselves.
 */
function startFast(task: Task): void {
  const walk: Partial<Record<TaskState, TaskState[]>> = {
    created: ["clarifying", "awaiting_approval", "planning"],
    clarifying: ["awaiting_approval", "planning"],
    scouting: ["synthesizing", "awaiting_approval", "planning"],
    synthesizing: ["awaiting_approval", "planning"],
  };
  for (const state of walk[task.state] ?? []) transition(task, state);
  const track = task.track!;
  if (!task.plan) {
    // The steps come first, a line each, so the plan reads at a glance; the rest is for whoever wants more.
    task.plan = [
      "## Steps",
      "",
      "## Objective",
      oneLine(taskRequest(task), 600),
      "",
      "## Track",
      `Fast track (${track.size}): ${rosterWords(track.roster)}. No scouts, proposal round or plan review; ${qaRequired(task) ? "QA takes part before completion (the QA gate, sized to the change)" : "no QA gate unless the change turns out riskier than it read"}.`,
    ].join("\n");
    track.autoPlan = true;
  }
  recordDecision(task, `Fast track: started without a proposal round (${track.size}; ${rosterWords(track.roster)}).`);
}

/**
 * A task from a plan agreed in the planning panel starts with that plan as
 * its own: the panel already asked the questions, read the code and agreed
 * the steps, so there is no clarifying, scouting, proposal or plan to write.
 * The engine walks the same states (every transition stays legal) to
 * planning, where the oracle delegates the first step.
 */
export function startFromAgreedPlan(task: Task, plan: string, taskDir: string): void {
  for (const state of ["clarifying", "awaiting_approval", "planning"] as const) if (task.state !== state) transition(task, state);
  task.plan = plan;
  writeFileEnsured(join(taskDir, "plan.md"), plan);
  const out = task.track?.satOut ?? [];
  const benched = out.length > 0 ? ` ${rosterWords(out)} sat out the panel, so ${out.length === 1 ? "it does" : "they do"} not work on the task${out.includes("qa") ? " and there is no QA gate" : ""}.` : "";
  recordDecision(task, `Started from the plan agreed in the planning panel (${task.approvedPlan}): no clarifying, scouting or proposal round.${benched}`);
}

/** The refusal for work given to a member who sat out the task's planning panel, or "" when it took part. */
function benchedRefusal(task: Task, member: TrackMember): string {
  if (!satOut(task, member)) return "";
  return `${rosterWords([member])} sat out the planning panel for this plan (${task.approvedPlan}), so it does not work on this task. Give the step to a member who took part (${rosterWords(task.track?.roster ?? [])}); if it truly needs ${rosterWords([member])}, ask the user to let it join with action=track (roster with it, and the reason).`;
}

/** `Step 3: …`, `Steps 2-4 — …` at the start of a delegation. */
const STEP_PREFIX = /^\s*(?:\*\*)?steps?\s*#?\s*(\d+)(?:\s*(?:-|\u2013|\u2014|to|and|&)\s*#?\s*(\d+))?(?:\*\*)?\s*[:.)\u2013\u2014-]?\s*/i;

/**
 * The fast track's plan grows with its delegations: a delegation that does
 * not name a step already in the plan adds one, so the lobby's checklist
 * follows the work without a plan document.
 */
function addFastSteps(task: Task, deps: WorkflowDeps, assignments: readonly Assignment[]): void {
  const lines = (task.plan ?? "").split("\n");
  let heading = lines.findIndex((line) => /^##\s+steps\s*$/i.test(line));
  if (heading < 0) {
    lines.unshift("## Steps", "");
    heading = 0;
  }
  // The section runs to the next heading; new steps go after its last numbered line.
  const end = lines.findIndex((line, index) => index > heading && /^#{1,6}\s/.test(line));
  const section = lines.slice(heading + 1, end < 0 ? lines.length : end);
  let count = section.filter((line) => /^\d+\.\s/.test(line)).length;
  const last = section.reduce((at, line, index) => (/^\d+\.\s/.test(line) ? index : at), -1);
  const added: string[] = [];
  for (const { domain, instruction } of assignments) {
    const named = STEP_PREFIX.exec(instruction);
    if (named && Number(named[2] ?? named[1]) <= count) continue;
    count += 1;
    added.push(`${count}. ${AGENT_LABELS[domain]}: ${stepLine(instruction)}`);
  }
  if (added.length === 0) return;
  lines.splice(heading + 1 + last + 1, 0, ...added);
  task.plan = lines.join("\n");
  writeFileEnsured(join(taskDirFor(deps.root, deps.configDir, task.id), "plan.md"), task.plan);
}

/** A delegation as a line of the steps list: its first line or sentence, short enough to skim. */
function stepLine(instruction: string): string {
  const first = instruction.replace(STEP_PREFIX, "").split("\n").find((line) => line.trim()) ?? "";
  const sentence = first.replace(/^[#*\s-]+/, "").split(/(?<=[.!?])\s/)[0] ?? "";
  return oneLine(sentence.replace(/[.!?]$/, ""), 80) || "its part of the request";
}

/**
 * Several domains at once. The workers share one file desk: each claims a file
 * before editing it, queues for a busy one, and hands it over with a note; a
 * worker that finishes hands over whatever it still holds automatically.
 * The desk also carries the task board to them.
 */
async function runParallelWorkers(task: Task, deps: WorkflowDeps, assignments: Assignment[]): Promise<string> {
  const batch = assignments.map((entry) => entry.domain);
  const runs = assignments.map((entry) => ({ ...entry, worker: assignmentId(entry.domain) }));
  const session = new DeskSession({ cwd: deps.cwd, boardPath: taskBoard(deps, task) });
  await session.open();
  let outcomes: WorkerOutcome[];
  let unenforced: Domain[];
  try {
    outcomes = await mapConcurrent(runs, deps.config.workflow.maxParallelWorkers, ({ domain, instruction, worker, assignment }) => {
      const request = workerRequest(deps, task, domain, instruction, batch, worker, assignment);
      request.agent = {
        env: session.env(worker),
        extraTools: session.tools(),
        onStart: (handle) => session.attach(worker, handle),
        onAttemptEnd: (run) => {
          const result = parseWorkerResult(domain, run.output);
          session.release(worker, (path, next) => autoNote(domain, path, next, result.filesChanged, result.completed));
        },
      };
      return runWorker(request, deps.runProcess ?? spawnPiProcess);
    });
    unenforced = runs.filter((run) => !session.greetedBy(run.worker)).map((run) => run.domain);
  } finally {
    await session.close();
  }
  const reports = outcomes.map((outcome) => absorbWorkerOutcome(task, deps, outcome, assignments.find((entry) => entry.domain === outcome.result.domain)!.assignment));
  return [
    `Parallel batch: ${batch.join(", ")}.`,
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
  const lines = handovers.map((entry) => `- ${entry.path}: ${workerLabel(entry.from)} → ${workerLabel(entry.to)}${entry.auto ? " (on finish)" : ""} — ${truncate(entry.note, 200)}`);
  return `File handovers:\n${lines.join("\n")}`;
}

export function handleResolveApproval(task: Task, params: OrchestrateParams): string {
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
function recordReview(task: Task, domain: Domain, result: ReviewResult, checksOnly = false): void {
  task.reviewRecords.push({
    domain,
    verdict: result.verdict,
    findings: result.findings.map((finding) => ({ severity: finding.severity, text: finding.text })),
    requiredChanges: result.requiredChanges,
    createdAt: new Date().toISOString(),
    ...(checksOnly ? { checksOnly: true } : {}),
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

/** The gate's brief at the change's risk: the depth and budget come from Jev's read, the levels from qa.md. */
function qaInstruction(risk: QaRiskAssessment): string {
  return [
    `Run the QA gate on the completed work at ${risk.risk.toUpperCase()} risk: ${DEPTHS[risk.risk]} verification, as "QA risk" in your context sets it.`,
    "Check the acceptance criteria and the focus areas; run the existing tests that cover them before writing any; stay within the test budget, a ceiling and never a quota;",
    "and stop as soon as more checking would add little confidence. Report an implementation defect as a finding for its owner to fix; do not fix production code yourself.",
  ].join(" ");
}

/** The QA gate looks at every domain's work, not just one worker's diff, knowing who changed each file. */
function qaRequest(deps: WorkflowDeps, task: Task, diff: string, risk: QaRiskAssessment, instruction?: string, provenance?: readonly FileProvenance[], lint?: LintReport): ReviewerRequest {
  const rounds = previousRound(task);
  return {
    taskId: task.id,
    domain: "qa",
    taskText: workerTaskText(task, 9000),
    // A clean review sees what was built, not how the builders describe it.
    workerSummary: deps.config.workflow.cleanReview ? "" : allScratchpads(deps, task),
    ...(deps.config.workflow.cleanReview ? { clean: true } : {}),
    ...(rounds ? { previousRound: rounds } : {}),
    scoutOutcomes: deps.config.workflow.cleanReview ? [] : loadScoutResults(taskReadDirs(deps.root, deps.configDir, task.id), [...new Set<Domain>(["qa", ...task.domains])]),
    diff,
    risk: qaRiskBrief(risk),
    // The gate's board lines are a delivery to the qa reader; record them before the agent starts.
    board: seedAndReadBoard(taskBoard(deps, task), "qa"),
    ...(provenance && provenance.length > 0 ? { provenance: provenanceLines(provenance) } : {}),
    ...(lint ? { lint: lintContext(lint, deps.config.lint.mode) } : {}),
    ...(assignmentChecks(task, deps.config.workflow.cleanReview) ? { assignmentChecks: assignmentChecks(task, deps.config.workflow.cleanReview) } : {}),
    instruction: instruction?.trim() || qaInstruction(risk),
    cwd: deps.cwd,
    dataRoots: readDataRoots(deps.root, deps.configDir),
    config: deps.config,
    profile: deps.profile,
    signal: deps.signal,
    onUpdate: deps.onUpdate,
    ...(deps.knowledge ? { knowledge: deps.knowledge } : {}),
  };
}

/**
 * What the assignments already settle for QA: the files each one was allowed to
 * change, and the verification it was briefed with (and, outside a clean review,
 * what the worker reported). QA starts there,
 * runs those commands first and widens only where the diff reaches further.
 */
export function assignmentChecks(task: Task, clean = false): string {
  const lines = (task.workerAssignments ?? []).flatMap(({ domain, brief, outcomes }) => {
    const latest = outcomes.filter((outcome) => outcome.revision === brief.revision).at(-1);
    if (!latest || latest.status !== "success") return [];
    const changed = brief.files.filter((file) => file.access !== "reference").map((file) => file.path);
    return [`- ${brief.id} r${brief.revision} (${domain}): ${changed.length ? `may change ${changed.join(", ")}` : "read only"}; verify with ${brief.verification.map((entry) => JSON.stringify(entry)).join(", ")}${!clean && latest.verification?.trim() ? `; the worker reported: ${truncate(latest.verification.trim().replace(/\s+/g, " "), 300)}` : ""}`];
  });
  return lines.length ? ["Assignments behind this change. Check these files first and run these verification commands before anything broader; widen only where the diff or a failure reaches other code:", ...lines].join("\n") : "";
}

/** What the loop does after a QA round: finish, fix and review again, stop, or (the user's call) accept the work as it is. */
type LoopDecision = "accept" | "iterate" | "blocked" | "waived";

function qaReport(header: string, result: ReviewResult, decision: LoopDecision, provenance?: readonly FileProvenance[], lint = "", issues: readonly string[] = []): string {
  const passed = result.verdict === "pass";
  return [
    header,
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
          ? result.unread
            ? "QA returned no readable verdict, so nothing is known about the work yet: re-run action=qa; there is nothing to fix first."
            : "The QA gate did not pass: delegate the required changes to the owning domain, then re-run action=qa."
          : "The review limit is reached and the user did not accept the work: mark the task blocked and tell the user what QA still asks for. They can accept it with /bot-lobby accept.",
    result.pushback ? pushbackLine(result.pushback, "qa") : "",
    issues.length > 0 ? `Issues: ${issues.join("; ")}` : "",
    provenanceNote(provenance),
    lint,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Changes of this task's own: its agents' (or nobody's on record), not the lobby chat's, other tasks' or what was there before. */
const TASKS_OWN = new Set(["planned", "unattributed"]);

/**
 * Jev's read of what the task built, from its diff (the engine's rules when
 * Jev is off), saved on the task and told to the lobby; undefined when git
 * cannot say what changed or nothing of the task's has.
 */
async function readTaskRisk(task: Task, deps: WorkflowDeps, diff: string, tree: { files: FileProvenance[] } | undefined, base: string | undefined): Promise<QaRiskAssessment | undefined> {
  const files = tree ? tree.files.filter((file) => file.kinds.some((kind) => TASKS_OWN.has(kind))).map((file) => file.path) : (await treeChanges(deps, base))?.files;
  if (!files || files.length === 0) return undefined;
  const reasons = readRequest(taskRequest(task)).reasons;
  const bugfix = task.triage?.kind === "bugfix" || reasons.some((reason) => reason.startsWith("tests: a bug fix"));
  return assessQaRisk({ files, diff, request: taskRequest(task), bugfix }, deps.classifier, deps.signal);
}

/** The QA risk the gate works to: the read, or a full review when the change could not be read. */
async function assessTask(task: Task, deps: WorkflowDeps, diff: string, tree: { files: FileProvenance[] } | undefined, base: string | undefined): Promise<QaRiskAssessment> {
  const read = await readTaskRisk(task, deps, diff, tree, base);
  let risk = read ?? unreadRisk(/^Unable to read git state/.test(diff) ? "git could not say what changed" : "no change of this task's is in the working tree");
  const still = qaStillNeeded(task);
  if (!risk.qaRequired && still) risk = { ...risk, qaRequired: true, reasoning: `${risk.reasoning} QA runs anyway: ${still}.` };
  task.qaRisk = risk;
  deps.onQaRisk?.(task.id, risk);
  return risk;
}

/** Why a change with nothing that runs still gets a QA agent: the user asked for tests, or QA asked for changes it must see made. */
function qaStillNeeded(task: Task): string | undefined {
  const last = task.reviewRecords.filter((record) => record.domain === "qa").at(-1);
  if (last && last.verdict !== "pass" && !last.checksOnly) return "the last QA round asked for changes, and QA checks they are made";
  if (readRequest(taskRequest(task)).reasons.some((reason) => reason.startsWith("tests: asked for"))) return "the request asks for tests";
  return undefined;
}

/**
 * The verdict of the engine's deterministic checks on a change with nothing
 * that runs: new lint errors on its lines hold it in block mode, as they hold
 * completion; anything else passes without a QA agent.
 */
function checksVerdict(lint: LintReport | undefined, deps: WorkflowDeps, waived: boolean): ReviewResult {
  const holds = lintHolds(lint, deps.config.lint.mode, waived);
  const ran = lint && lint.state !== "skipped" && deps.config.lint.mode !== "off";
  return {
    domain: "qa",
    role: "reviewer",
    verdict: holds ? "changes_required" : "pass",
    findings: holds && lint ? [{ severity: "major", text: `new lint errors on lines the task changed: ${lintSummary(lint)}` }] : [],
    verification: ran ? `- engine lint on the touched files — ${lintSummary(lint)}` : "- engine lint — nothing to lint, or lint is off",
    requiredChanges: holds ? ["Fix the new lint errors at their cause (never silence the rule), then re-run action=qa."] : [],
    optionalImprovements: [],
    raw: "",
  };
}

async function handleQa(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["implementing", "reviewing"]);
  if (satOut(task, "qa")) throw new Error(`${benchedRefusal(task, "qa")} There is no QA gate: complete once every step is done.`);
  if (task.state !== "reviewing") transition(task, "reviewing");
  const iterations = (task.reviewIterations?.qa ?? 0) + 1;
  task.reviewIterations = { qa: iterations };
  const base = await reviewBase(task, deps);
  const [diff, tree] = await Promise.all([
    readRepositoryDiff(deps.cwd, { ...(base ? { base } : {}), exclude: ownRecords(deps) }),
    changeState(deps, task, base),
  ]);
  const provenance = tree?.files;
  // The gate's base is the task's own; a legacy task measured from an older commit lints from a fresh look.
  // Before any QA agent runs, Jev reads what was built: the gate's depth and test budget follow its risk. Neither waits for the other.
  const [lint, risk] = await Promise.all([
    lintTask(task, deps, base === task.baseline?.head ? tree : undefined),
    assessTask(task, deps, diff, tree, base),
  ]);
  const lintLine = lintBrief(lint, deps.config.lint.mode, Boolean(task.lintWaiver));
  if (!risk.qaRequired) {
    const result = checksVerdict(lint, deps, Boolean(task.lintWaiver));
    const decision = await settleQaRound(task, result, iterations, deps, true);
    const header = `QA gate: ${result.verdict.toUpperCase()} on the engine's checks; no QA agent ran. ${qaRiskLine(risk)}.\nWhy: ${risk.reasoning}\nChecks:\n${result.verification}`;
    return qaReport(header, result, decision, provenance, lintLine);
  }
  const outcome = await runReviewer({ ...qaRequest(deps, task, diff, risk, params.task, provenance, lint), effort: deps.effort }, deps.runProcess ?? spawnPiProcess);
  const { result, run } = outcome;
  recordAdvisoryPushbacks(task, [{ pushback: result.pushback, who: "qa" }]);
  if (result.relaxed) recordDecision(task, `QA round ${iterations} passed: ${result.relaxed}.`, "qa");
  const decision = await settleQaRound(task, result, iterations, deps);
  const header = `QA gate: ${result.verdict.toUpperCase()} (run ${run.status}${run.error ? `: ${run.error}` : ""})${result.relaxed ? " — only minor findings, which never hold the gate" : ""}\n${qaRiskLine(risk)}`;
  return qaReport(header, result, decision, provenance, lintLine, outcome.issues);
}

/** A QA round's verdict, recorded on the task; then the loop decides, and at its limit the user. */
async function settleQaRound(task: Task, result: ReviewResult, iterations: number, deps: WorkflowDeps, checksOnly = false): Promise<LoopDecision> {
  task.qaVerdict = result.verdict;
  recordReview(task, "qa", result, checksOnly);
  let decision: LoopDecision = decideReviewLoop(result.verdict, iterations, reviewLimit(task, deps));
  if (decision === "blocked") decision = await askAtReviewLimit(task, result, iterations, deps);
  if (decision === "accept") task.blockers = task.blockers.filter((blocker) => blocker.domain !== "qa");
  return decision;
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
  // Accepting the work as it stands accepts its lint errors too.
  if (task.lint?.state === "failing") waiveLint(task, why);
  const cleared = task.blockers.map((blocker) => blocker.reason);
  task.blockers = [];
  if (task.state === "blocked") transition(task, "implementing");
  if (task.state === "implementing") transition(task, "reviewing");
  recordDecision(task, `The user accepted the work without a QA pass (${why}).${open.length > 0 ? ` QA still asked for: ${open.map((ask) => truncate(ask, 160)).join("; ")}.` : ""}${cleared.length > 0 ? ` Cleared blockers: ${cleared.join("; ")}.` : ""}`);
}

/** The user accepts the work with the lint errors it has: the lint gate no longer holds completion. */
export function waiveLint(task: Task, why: string): void {
  if (task.lintWaiver) return;
  task.lintWaiver = { at: new Date().toISOString() };
  recordDecision(task, `The user accepted the work with its lint errors (${why})${task.lint ? `: ${lintSummary(task.lint)}` : "."}`);
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
function handleKnowledge(task: Task | undefined, params: OrchestrateParams, deps: WorkflowDeps): string {
  const text = params.text?.trim();
  if (!text) throw new Error("knowledge requires text");
  const kind: KnowledgeKind = params.kind ?? "knowledge";
  const agent: KnowledgeAgent = params.domain && isDomain(params.domain) ? params.domain : "master";
  const outcome = applyKnowledge({ dataRoot: dataRoot(deps.root, deps.configDir), agent, kind, text });
  if (outcome.result === "empty") throw new Error("knowledge text is empty");
  if (outcome.result === "duplicate") return `Already recorded in ${outcome.path}; nothing changed.`;
  if (task) recordDecision(task, `Recorded ${kind} for ${agent}: ${truncate(text, 200)}`);
  lobbyTopics.bump("knowledge");
  return `Recorded ${kind} for ${agent} in ${outcome.path}.`;
}

/**
 * The oracle manages the task's assignment bookmarks through its own tool:
 * add, remove, pin, unpin or exclude catalogue references for a recipient
 * (a domain, or everyone when no domain is given). No approval gate: this is
 * the existing planning and delegation flow. Pins and exclusions survive
 * every later automatic selection.
 */
function handleBookmark(task: Task | undefined, params: OrchestrateParams, deps: WorkflowDeps): string {
  if (!task) throw new Error("bookmark requires a task");
  if (!params.op) throw new Error("bookmark requires op: add, remove, pin, unpin or exclude");
  const refs = (params.refs ?? []).map((ref) => ref.trim()).filter(Boolean);
  if (refs.length === 0) throw new Error("bookmark requires refs (reference ids exactly as search_knowledge returned them)");
  const outcome = oracleBookmarkOp(dataRoot(deps.root, deps.configDir), task.id, params.op as OracleBookmarkOp, refs, {
    ...(params.domain && isDomain(params.domain) ? { recipient: params.domain } : {}),
    ...(params.note?.trim() ? { reason: params.note.trim() } : {}),
  });
  lobbyTopics.bump("knowledge");
  return `${outcome.message} Deliveries revalidate every reference; pins and exclusions survive automatic refresh.`;
}

/**
 * The oracle adds a script to the shared library, or replaces one, so every
 * agent can run it the next time the job comes up. Its body is `text`, or a
 * file a worker drafted (`file`, inside the project or the task's directory).
 */
function handleScript(task: Task | undefined, params: OrchestrateParams, deps: WorkflowDeps): string {
  const name = params.name?.trim();
  if (!name) throw new Error("script requires name: what it does in snake_case, with its extension (seed_public_holidays.py)");
  const purpose = params.purpose?.trim();
  if (!purpose) throw new Error("script requires purpose: one line on what it does");
  const body = params.file?.trim() ? readDraft(params.file.trim(), task, deps) : params.text;
  if (!body?.trim()) throw new Error("script requires text (the script) or file (a drafted script)");
  const saved = saveScript({ dataRoot: dataRoot(deps.root, deps.configDir), name, purpose, body, ...(params.usage?.trim() ? { usage: params.usage.trim() } : {}) });
  const { entry } = saved;
  if (task) recordDecision(task, `${saved.archived ? "Replaced" : "Saved"} the shared script ${entry.name}: ${truncate(entry.purpose, 160)}`);
  lobbyTopics.bump("knowledge");
  return [`${saved.archived ? "Replaced" : "Saved"} ${entry.name} in the shared scripts library (${entry.path}); run: ${entry.usage}.`, saved.archived ? `The previous version is kept at ${saved.archived}.` : "", "Agents whose steps it fits are told to run it."].filter(Boolean).join(" ");
}

/** A drafted script, read only from inside the project, its worktree or the task's directory. */
function readDraft(file: string, task: Task | undefined, deps: WorkflowDeps): string {
  const roots = [deps.cwd, deps.root, ...(task ? [taskDirFor(deps.root, deps.configDir, task.id)] : [])].map((dir) => resolve(dir));
  const path = isAbsolute(file) ? resolve(file) : resolve(deps.cwd, file);
  if (!roots.some((root) => path === root || path.startsWith(`${root}${sep}`))) throw new Error(`the drafted script must be inside the project: ${file}`);
  if (!existsSync(path)) throw new Error(`no drafted script at ${file}`);
  return readFileSync(path, "utf8");
}

/**
 * §24: the Master rewrites the file (asking the user about ambiguity), the
 * engine archives the previous version and writes the compacted text.
 */
function handleCompact(task: Task | undefined, params: OrchestrateParams, deps: WorkflowDeps): string {
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
  if (task) recordDecision(task, `Compacted ${agent}/${file} (${outcome.before} -> ${outcome.after} chars)`);
  lobbyTopics.bump("knowledge");
  return `Compacted ${agent}/${file}: ${outcome.before} -> ${outcome.after} chars. Previous version archived at ${outcome.archive}.`;
}

/** §63: record history, drop scratchpads, then mark the task completed. */
async function handleComplete(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  // The fast track (and a plan QA sat out) completes straight from its work; the full workflow from review.
  requireState(task, onFastTrack(task) || !qaRequired(task) ? ["implementing", "reviewing", "blocked"] : ["reviewing", "blocked"]);
  await refreshAssignmentEvidence(task, deps);
  const assignmentHolds = workerAssignmentHolds(task);
  if (assignmentHolds.length) throw new Error(`cannot complete: ${assignmentHolds.join("; ")}`);
  const joined = await qaJoinsRiskyFastTask(task, deps);
  if (joined) throw new Error(joined);
  // Without QA's part (where the track asks for it) only the user can let the task finish: they are asked, never overruled.
  if (qaRequired(task) && !qaTookPart(task) && !task.qaWaiver) await offerAcceptance(task, deps);
  if (task.state === "blocked") throw new Error("cannot complete: the task is blocked, and the user did not accept its work as it is");
  const blockers = completionBlockers(task, pendingApprovals(task).length);
  if (blockers.length > 0) throw new Error(`cannot complete: ${blockers.join("; ")}`);
  // New lint errors in what the task touched hold it in block mode, unless the user accepted the work as it is.
  const lint = await lintTask(task, deps);
  if (lint && lintHolds(lint, deps.config.lint.mode, Boolean(task.lintWaiver))) throw new Error(`cannot complete: ${lintRefusal(lint)}`);
  // The gate refuses before any side effect, so a refusal leaves the task untouched.
  const oversized = overThreshold(readDataRoots(deps.root, deps.configDir), deps.config.knowledge.compactionThreshold);
  if (oversized.length > 0) throw new Error(`cannot complete: knowledge files over the compaction threshold: ${oversized.map((entry) => `${entry.agent}/${entry.file} (${entry.chars})`).join(", ")}. First record domain-relevant facts where they belong with action=knowledge (domain=designer|backend|qa), then rewrite each oversized file with action=compact, then call complete again.`);
  deps.signal?.throwIfAborted();
  const committed = await commitTaskWork(task, params, deps);
  deps.signal?.throwIfAborted();
  const summary = params.text?.trim() || task.proposal || task.title;
  recordCompletion(deps, task, summary);
  removeTaskScratchpads(deps.root, deps.configDir, task.id);
  task.blockers = [];
  if (task.state === "implementing") transition(task, "reviewing");
  transition(task, "completed");
  try {
    retireBookmarks(dataRoot(deps.root, deps.configDir), task.id);
  } catch {
    // A busy bookmark list is not worth failing completion over; it stays revalidated either way.
  }
  task.delivery = await completionReview(task, deps.root, { cwd: deps.root, exec: deps.exec ?? execCommand });
  deps.notify(`Task ${task.id} is completed. Delivery review is available; publishing requires your approval.`, "info");
  flushDecisions(deps, task);
  const delivery = await offerDelivery(task, deps);
  const left = lint?.state === "failing" ? ` ${task.lintWaiver ? "Accepted by the user with lint errors" : "Lint (advisory)"}: ${lintSummary(lint)} Tell the user.` : "";
  return `Task ${task.id} completed.${committed} History recorded and temporary scratchpads removed. ${delivery}${left}`;
}

/** The files a task's own workers changed: not one that held changes before they started, nor another task's. */
function agentsWork(files: readonly FileProvenance[]): string[] {
  return files.filter((file) => file.kinds.includes("planned") && !file.kinds.includes("pre-existing") && !file.kinds.includes("other-task")).map((file) => file.path);
}

/**
 * The oracle commits what its agents changed before the task is called done,
 * with its own short message (`message`); nothing else in the tree is
 * staged or committed. "" when git is not in use or nothing is left to commit.
 */
async function commitTaskWork(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  const state = await changeState(deps, task, await reviewBase(task, deps));
  if (!state) return "";
  const ours = agentsWork(state.files);
  const dirty = await uncommitted(state.top, ours).catch(() => []);
  if (dirty.length === 0) return "";
  const listed = dirty.slice(0, 20).join(", ") + (dirty.length > 20 ? ` and ${dirty.length - 20} more` : "");
  if (!params.message?.trim()) throw new Error(`cannot complete: commit the agents' changes first. Call complete again with message: a concise commit message for them (a first line of 72 characters or fewer saying what changed, at most three short lines below it). The engine commits only these files: ${listed}`);
  let message: string;
  try {
    message = commitMessage(params.message);
  } catch (error) {
    throw new Error(`cannot complete: ${(error as Error).message}`);
  }
  let result: Awaited<ReturnType<typeof commitFiles>>;
  try {
    deps.signal?.throwIfAborted();
    result = await commitFiles(state.top, dirty, message);
  } catch (error) {
    throw new Error(`cannot complete: git refused the commit: ${(error as Error).message}`);
  }
  if (!result) return "";
  const others = await uncommitted(state.top, state.files.map((file) => file.path).filter((path) => !ours.includes(path))).catch(() => []);
  const left = others.length > 0 ? ` Left uncommitted, not this task's agents' work: ${others.slice(0, 10).join(", ")}${others.length > 10 ? ` and ${others.length - 10} more` : ""}.` : "";
  return ` Committed ${result.files.length} file${result.files.length === 1 ? "" : "s"} as ${result.commit.slice(0, 7)}: "${message.split("\n")[0]}".${left}`;
}

/** Completion always offers delivery to the user, including in auto mode. */
async function offerDelivery(task: Task, deps: WorkflowDeps): Promise<string> {
  const pending = "Delivery review is available; nothing was published.";
  if (!task.git || task.delivery!.blocked.create_pr) return pending;
  const ctx = { cwd: deps.root, exec: deps.exec ?? execCommand };
  try {
    const review = await refreshReview(task, ctx);
    saveTask(deps.root, deps.configDir, task);
    if (review.blocked.merge_main) return `${pending} Merge is blocked: ${review.blocked.merge_main}`;
    const baseline = JSON.stringify(review);
    const store = deliveryStore(deps.root, deps.configDir, task.id);
    const confirm = "Merge and push main";
    const choice = await deps.choose([
      `Merge completed task ${task.id}: ${task.title}?`,
      `Project: ${review.project}\nRepository: ${review.remote}\nSource: ${review.sourceBranch} · ${review.sourceCommit}\nTarget: main · ${review.targetCommit}`,
      review.verification!.summary,
      `This updates and pushes main.${task.git.mode === "worktree" ? ` After the merge is verified, remove the task worktree ${task.git.path}. Its branch is kept.` : ""}`,
    ].join("\n\n"), [confirm, "Not now"]);
    const latest = store.load();
    if (JSON.stringify(latest.delivery) !== baseline) return "Delivery changed while waiting; inspect the current delivery review in Tasks.";
    if (choice !== confirm || deps.signal?.aborted) {
      if (choice === "Not now") { deferReview(latest, review.reviewId); store.save(latest); }
      return pending;
    }
    task.delivery = await deliver({ reviewId: review.reviewId, action: "merge_main", confirmMain: true }, ctx, store);
    if (task.delivery.status !== "successful") return `Delivery needs attention: ${task.delivery.error ?? task.delivery.blocked.merge_main ?? "refresh the delivery review and approve again"}.`;
    return `Merged and pushed main.${task.delivery.operation?.worktreeRemoved ? " Task worktree removed." : ""}${task.delivery.cleanupError ? ` ${task.delivery.cleanupError}` : ""}`;
  } catch (error) {
    return `Delivery needs attention: ${(error as Error).message}. Completed work is retained.`;
  } finally {
    const latest = loadTask(deps.root, deps.configDir, task.id);
    if (latest?.delivery) task.delivery = latest.delivery;
  }
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

/**
 * `action=track`: with neither `track` nor `roster`, the task's track; with
 * them, the oracle corrects the engine's read of the request. The fast track
 * is taken only before the work is planned, never against the user's --full
 * or the settings; once work is under way a track only gets stricter (the
 * full workflow, more members, QA never dropped).
 */
/** Let members who sat out the plan's panel join the task: only the user can, and nobody is asked in auto mode. */
async function letJoin(task: Task, joining: readonly TrackMember[], reason: string, deps: WorkflowDeps): Promise<void> {
  const words = rosterWords(joining);
  const them = joining.length === 1 ? "it" : "them";
  if (isAutoMode(deps.root, deps.configDir, task.id)) throw new Error(`${words} sat out the planning panel for this plan, and only the user can let ${them} work on the task (auto mode is on: nobody can be asked)`);
  const yes = `Let ${them} join`;
  const choice = await deps.choose(`${words} sat out the planning panel for ${task.id}. The oracle asks to add ${them}: ${reason}`, [yes, `Keep ${them} out`]);
  if (choice !== yes) throw new Error(`the user kept ${words} out of this task: give the work to the members who took part in the plan`);
  recordDecision(task, `The user let ${words} join the task, though ${joining.length === 1 ? "it" : "they"} sat out the planning panel: ${reason}`);
}

async function handleTrack(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  const current = task.track;
  if (!params.track && !params.roster) return current ? trackSummary(current) : "This task began before tracks: it takes the full workflow.";
  const reason = oneLine(params.reason?.trim() || params.text?.trim() || "", 240);
  if (!reason) throw new Error("track requires reason: why the task takes that path, or needs those members");
  const path = params.track ?? current?.path ?? "full";
  const shaping = FAST_START_STATES.includes(task.state);
  if (path === "fast" && current?.path !== "fast") {
    if (!deps.config.workflow.fastTrack) throw new Error("the fast track is off in settings (workflow.fastTrack): this task takes the full workflow");
    if (current?.userChoice === "full") throw new Error("the user asked for the full workflow on this task (--full)");
    if (!shaping) throw new Error(`a task takes the fast track before its work is planned; this one is ${task.state}`);
  }
  const asked = params.roster ? parseRoster(params.roster) : [...(current?.roster ?? [])];
  // A member who sat out the plan's panel joins only when the user says so.
  const joining = (current?.satOut ?? []).filter((member) => asked.includes(member));
  if (joining.length > 0) await letJoin(task, joining, reason, deps);
  const benched = (current?.satOut ?? []).filter((member) => !joining.includes(member));
  // The full workflow ends with the QA gate, unless QA sat out the planning panel.
  const roster = path === "full" && !benched.includes("qa") ? parseRoster([...asked, "qa"]) : asked;
  if (!shaping && current?.roster.includes("qa") && !roster.includes("qa")) throw new Error("QA stays on the roster once the work is under way");
  const grew = current?.path === "fast" && path === "full";
  task.track = {
    path,
    size: current?.size ?? "small",
    roster,
    reasons: [`oracle: ${reason}`, ...(current?.reasons ?? [])].slice(0, 8),
    source: "oracle",
    ...(current?.userChoice ? { userChoice: current.userChoice } : {}),
    ...(current?.autoPlan ? { autoPlan: true } : {}),
    ...(benched.length > 0 ? { satOut: benched } : {}),
    at: new Date().toISOString(),
  };
  recordDecision(task, `Track: ${path === "fast" ? "fast track" : "full workflow"}; ${rosterWords(roster)} — ${reason}`);
  if (path === "fast") {
    return `Fast track: ${rosterWords(roster)}. Delegate straight away with action=implement (open each task with "Step N:"); no scouts, proposal or plan. ${qaRequired(task) ? "QA takes part before completion: action=qa, sized to the change." : "No QA gate unless the change turns out riskier than it read."} Then action=complete.`;
  }
  if (!shaping) return `Full workflow from here: ${rosterWords(roster)}. ${qaRequired(task) ? "The QA gate runs before the task completes" : "No QA gate: QA sat out the planning panel"}${grew ? "; tell the user in one line why the task grew" : ""}.`;
  return `Full workflow: ${rosterWords(roster)}. Scout what the request touches, then propose a short bullet list for approval.`;
}

async function handleDecide(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  if (params.discoveryAllowance !== undefined) return decideDiscoveryAllowance(task, params, deps);
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

function oneLine(text: string, max: number): string {
  return truncate(text.replace(/\s+/g, " ").trim(), max).replace(/\n\[\.\.\.\d+ characters omitted\]$/, "…");
}

const AGENT_LABELS: Record<Domain, string> = { backend: "DEV", designer: "DESIGN", qa: "QA" };

/** A worker identity (domain or assignment id) named the way records read: its role when it has one, the id itself otherwise. */
function workerLabel(worker: string): string {
  return roleOf(worker) ?? worker;
}

/** Questions to the user one at a time, even when parallel workers ask together. */
let asking: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(ask: () => Promise<T>): Promise<T> {
  const next = asking.then(ask, ask);
  asking = next.catch(() => undefined);
  return next;
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
  bookmark: handleBookmark,
  script: handleScript,
  compact: handleCompact,
  complete: handleComplete,
  block: handleBlock,
  resume: handleResume,
  decide: handleDecide,
  track: handleTrack,
  status: (task) => describeTask(task),
  cancel: handleCancel,
};

/**
 * Single entry point for every orchestration step. The engine — not the
 * calling agent — decides whether an action is legal in the current state.
 */
export async function runWorkflowAction(params: OrchestrateParams, deps: WorkflowDeps): Promise<WorkflowResult> {
  // Project knowledge can be learned without starting or changing a task.
  if ((params.action === "knowledge" || params.action === "compact" || params.action === "script") && !params.taskId) {
    try {
      const message = params.action === "knowledge" ? handleKnowledge(undefined, params, deps) : params.action === "script" ? handleScript(undefined, params, deps) : handleCompact(undefined, params, deps);
      return { ok: true, taskId: "", state: "created", message };
    } catch (error) {
      return { ok: false, taskId: "", state: "created", message: `Rejected: ${(error as Error).message}` };
    }
  }
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
  const gone = missingWorktree(task);
  if (gone && params.action !== "status") return { ok: false, taskId: task.id, state: task.state, message: `Rejected: ${gone}` };
  const execution = taskExecution(deps.root, deps.configDir, task.id, deps.signal);
  const finished = new Map<string, AgentRun>();
  const identity = { root: deps.root, configDir: deps.configDir, taskId: task.id, sessionId: task.ownerSessionId };
  const wait = async <T>(run: () => Promise<T>) => {
    execution.signal.throwIfAborted();
    saveTask(deps.root, deps.configDir, task);
    const result = await withBlockingRequest(identity, run);
    execution.signal.throwIfAborted();
    return result;
  };
  const tracked: WorkflowDeps = {
    ...deps,
    signal: execution.signal,
    choose: (...args) => wait(() => deps.choose(...args)),
    ask: (...args) => wait(() => deps.ask(...args)),
    ...(deps.askQuestions ? { askQuestions: (...args: Parameters<NonNullable<WorkflowDeps["askQuestions"]>>) => wait(() => deps.askQuestions!(...args)) } : {}),
    // Every agent, diff and desk of a task with its own worktree works there.
    cwd: taskCwd(task, deps.cwd),
    // An agent can work for an hour: what the action has done so far (implementing, reviewing) is saved before it starts, so every window reads it.
    runProcess: (args, options) => {
      execution.signal.throwIfAborted();
      saveTask(deps.root, deps.configDir, task);
      return (deps.runProcess ?? spawnPiProcess)(args, options);
    },
    onUpdate: (run) => {
      if (run.status !== "running") {
        finished.set(run.runId, run);
        if (run.parentRunId) writeFileEnsured(join(taskDirFor(deps.root, deps.configDir, task.id), "children", `${run.runId}.json`), `${JSON.stringify(run)}\n`);
      }
      // Every window marks the steps a worker is on while it runs.
      if (run.role === "worker") {
        if (run.status === "running") working.add(run.runId);
        else working.delete(run.runId);
        noteWorkerRun(deps.root, deps.configDir, task.id, run);
      }
      deps.onUpdate?.(run);
    },
  };
  // The action waits for its workers, so once it is over none of them is still on a step (one that threw never said so).
  const working = new Set<string>();
  try {
    const message = await handler(task, params, tracked);
    execution.signal.throwIfAborted();
    const runs = recordRunLog(task, finished, deps);
    saveTask(deps.root, deps.configDir, task);
    if (TERMINAL_STATES.includes(task.state)) {
      cleanupTaskAssignedSessions(taskDirFor(deps.root, deps.configDir, task.id));
      void stopScoutPrefetch(task.id);
    }
    return { ok: true, taskId: task.id, state: task.state, message: `${message}${runsFooter(runs)}`, runs };
  } catch (error) {
    const runs = recordRunLog(task, finished, deps);
    saveTask(deps.root, deps.configDir, task);
    return { ok: false, taskId: task.id, state: task.state, message: `Rejected: ${(error as Error).message}`, runs };
  } finally {
    execution.release();
    for (const runId of working) noteWorkerRun(deps.root, deps.configDir, task.id, { runId, startedAt: "", status: "cancelled" });
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
