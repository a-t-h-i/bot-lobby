import { join } from "node:path";
import type { DevHouseConfig } from "../schemas/configuration.ts";
import type { AgentRun } from "../schemas/findings.ts";
import { TERMINAL_STATES, type Task, type TaskState } from "../schemas/task.ts";
import { isDomain } from "../schemas/agent.ts";
import { transition } from "../state/task-state.ts";
import { activeTask, loadTask, saveTask, taskDirFor } from "../state/persistence.ts";
import { dataRoot } from "../state/project.ts";
import { writeFileEnsured } from "../knowledge/store.ts";
import { spawnPiProcess, type ProcessRunner } from "../execution/pi-runner.ts";
import { runScouts, type ScoutOutcome } from "../master/master.ts";
import { assessReconnaissance, recordDecision } from "../master/decisions.ts";
import { detectSharedFiles, summarizeOutcomes } from "../master/synthesis.ts";
import { truncate } from "../text.ts";
import { pendingApprovals } from "./approvals.ts";
import { nextStates } from "./transitions.ts";

export const ORCHESTRATE_ACTIONS = ["clarify", "scout", "propose", "plan", "decide", "status", "cancel"] as const;
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
  text?: string;
  domain?: string;
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


function deriveDomains(values: string[] | undefined): string[] {
  const domains = (values ?? []).map((value) => value.trim().toLowerCase()).filter((value) => isDomain(value));
  if (domains.length === 0) throw new Error("scout requires at least one of: designer, backend, qa");
  return [...new Set(domains)];
}

export function describeTask(task: Task): string {
  const lines = [
    `${task.id} — state: ${task.state}${task.paused ? " (paused)" : ""}`,
    `Request: ${truncate(task.title, 200)}`,
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
      : "Next: synthesize these findings, target-verify anything important (repeat action=scout with a focused instruction), then call action=propose.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

async function handleClarify(task: Task, params: OrchestrateParams, deps: WorkflowDeps): Promise<string> {
  requireState(task, ["created", "clarifying"]);
  const question = params.question?.trim();
  if (!question) throw new Error("clarify requires a question");
  transition(task, "clarifying");
  const answer = params.options?.length
    ? await deps.choose(question, params.options)
    : await deps.ask(question);
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
      taskText: task.title,
      instruction: params.instruction?.trim() || "Investigate this request and report findings the Master needs.",
      domains: domains as ScoutOutcome["result"]["domain"][],
      cwd: deps.cwd,
      dataRoot: dataRoot(deps.root, deps.configDir),
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
  if (!deps.config.workflow.requireApprovalForFeatures) {
    return applyApprovalChoice(task, "approve");
  }
  const choice = await deps.choose(`Approve this proposal?\n\n${truncate(proposal, 2000)}`, APPROVAL_OPTIONS);
  if (!choice) return `Awaiting approval. Present the proposal to the user and continue after they respond.\n\n${proposal}`;
  const kind: ApprovalChoice = choice.toLowerCase().startsWith("approve")
    ? "approve"
    : choice.toLowerCase().startsWith("decline")
      ? "decline"
      : "amend";
  if (kind !== "amend") return applyApprovalChoice(task, kind);
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
  return "Plan recorded. Next: pick the first domain and call action=implement with domain and task.";
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
  propose: handlePropose,
  plan: handlePlan,
  decide: handleDecide,
  status: (task) => describeTask(task),
  cancel: handleCancel,
};

function resolveTask(taskId: string | undefined, deps: WorkflowDeps): Task | undefined {
  return taskId ? loadTask(deps.root, deps.configDir, taskId) : activeTask(deps.root, deps.configDir);
}

/**
 * Single entry point for every orchestration step. The engine — not the
 * calling agent — decides whether an action is legal in the current state.
 */
export async function runWorkflowAction(params: OrchestrateParams, deps: WorkflowDeps): Promise<WorkflowResult> {
  const task = resolveTask(params.taskId, deps);
  if (!task) {
    return { ok: false, taskId: params.taskId ?? "", state: "created", message: "No dev-house task found. Start one with /dev-house <request>." };
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
