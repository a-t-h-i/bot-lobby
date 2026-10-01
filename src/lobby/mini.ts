/**
 * The one-line status shown under pi's editor while the lobby is hidden: a
 * small graphic of where the work stands — the task's plan steps (or its stage
 * before there is a plan), the planning rounds, the quick fix in hand — or a
 * quiet "idle". Pure: everything it shows arrives as input.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentRun } from "../schemas/findings.ts";
import type { Task, TaskState } from "../schemas/task.ts";
import { planChecklist } from "../pi/plan-checklist.ts";
import { agentName } from "../pi/run-summary.ts";
import { paint, type LobbyTheme } from "./layout.ts";

export interface MiniPlanning {
  /** A round is running. */
  busy: boolean;
  /** The round in hand, and the limit (0 = unlimited). */
  round: number;
  limit: number;
  /** Questions waiting for the user. */
  questions: number;
  /** The oracle's draft is ready to save. */
  ready: boolean;
  /** The plan was saved as a pending task. */
  saved: boolean;
}

export interface MiniQuickFix {
  title: string;
  running: boolean;
  queued: number;
}

export interface MiniInput {
  task?: Task;
  runs: readonly AgentRun[];
  planning?: MiniPlanning;
  quickfix?: MiniQuickFix;
  /** The loopback web UI's link, while its server runs. */
  webLink?: string;
  /** The key that opens the lobby, as shown. */
  key: string;
}

/** A full-workflow task's stages, in order, for the strip shown before its plan has steps. */
const STAGES: readonly TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"];

/** Widest step bar; longer plans share its cells. */
const MAX_CELLS = 12;

/** `■■◐□□`: the plan's steps done, current and to do, squeezed into at most `MAX_CELLS` cells. */
export function stepBar(statuses: readonly ("done" | "current" | "pending")[]): string {
  if (statuses.length === 0) return "";
  const cells = Math.min(statuses.length, MAX_CELLS);
  const out: string[] = [];
  for (let cell = 0; cell < cells; cell += 1) {
    const from = Math.floor((cell * statuses.length) / cells);
    const to = Math.max(from + 1, Math.floor(((cell + 1) * statuses.length) / cells));
    const slice = statuses.slice(from, to);
    out.push(slice.every((status) => status === "done") ? "■" : slice.some((status) => status === "current") ? "◐" : slice.some((status) => status === "done") ? "◐" : "□");
  }
  return out.join("");
}

/** `●●◐○○○○`: how far along the workflow a task without a plan yet is. */
export function stageBar(state: TaskState): string {
  const at = STAGES.indexOf(state);
  if (at < 0) return "";
  return STAGES.map((_stage, index) => (index < at ? "●" : index === at ? "◐" : "○")).join("");
}

/** `■■□□□` for `round` of `limit`, or empty without a limit. */
function roundBar(round: number, limit: number): string {
  if (limit <= 0) return "";
  const done = Math.min(limit, Math.max(0, round));
  return "■".repeat(done) + "□".repeat(limit - done);
}

const STATE_WORDS: Partial<Record<TaskState, string>> = {
  awaiting_approval: "awaiting your approval",
};

function taskSegment(input: MiniInput, theme?: LobbyTheme): string | undefined {
  const task = input.task;
  if (!task || task.state === "completed" || task.state === "abandoned") return undefined;
  const steps = task.plan ? planChecklist(task.plan, input.runs) : [];
  const done = steps.filter((step) => step.status === "done").length;
  const bar = steps.length > 0 ? `${stepBar(steps.map((step) => step.status))} ${done}/${steps.length}` : stageBar(task.state);
  const state = task.paused ? `${task.state} (paused)` : STATE_WORDS[task.state] ?? task.state;
  const running = [...input.runs].reverse().find((run) => run.status === "running");
  const doing = running ? ` · ${agentName(running)}${running.activity ? ` ${running.activity}` : ""}` : "";
  const alert = task.state === "awaiting_approval" || task.paused;
  return `${paint(theme, "accent", task.id)} ${paint(theme, "success", bar)} ${paint(theme, alert ? "warning" : "muted", state)}${paint(theme, "dim", doing)}`;
}

function planningSegment(planning: MiniPlanning | undefined, theme?: LobbyTheme): string | undefined {
  if (!planning || planning.saved) return undefined;
  const rounds = roundBar(planning.round, planning.limit);
  const head = `${paint(theme, "accent", "planning")} ${paint(theme, "success", rounds || `round ${planning.round}`)}${rounds ? paint(theme, "muted", ` ${planning.round}/${planning.limit}`) : ""}`;
  if (planning.questions > 0) return `${head} ${paint(theme, "warning", `● ${planning.questions} question${planning.questions === 1 ? "" : "s"} for you`)}`;
  if (planning.busy) return `${head} ${paint(theme, "muted", "the panel is thinking")}`;
  if (planning.ready) return `${head} ${paint(theme, "success", "plan ready to save")}`;
  return head;
}

function quickFixSegment(quickfix: MiniQuickFix | undefined, theme?: LobbyTheme): string | undefined {
  if (!quickfix) return undefined;
  const queued = quickfix.queued > 0 ? ` +${quickfix.queued} queued` : "";
  return `${paint(theme, "accent", "quick fix")} ${paint(theme, "success", quickfix.running ? "◐" : "○")} ${paint(theme, "muted", quickfix.title)}${paint(theme, "dim", queued)}`;
}

/** The web link, while the server runs; pure: the link arrives as input. */
function webSegment(link: string | undefined, theme?: LobbyTheme): string | undefined {
  if (!link) return undefined;
  return paint(theme, "dim", link);
}

/** The status line, at most `width` columns. */
export function miniLine(input: MiniInput, width: number, theme?: LobbyTheme): string {
  if (width < 12) return "";
  const segments = [taskSegment(input, theme), planningSegment(input.planning, theme), quickFixSegment(input.quickfix, theme), webSegment(input.webLink, theme)].filter((segment): segment is string => Boolean(segment));
  const body = segments.length > 0 ? segments.join(paint(theme, "dim", "  │  ")) : paint(theme, "dim", "idle");
  const hint = paint(theme, "dim", `  ${input.key} opens`);
  const line = ` ${paint(theme, "accent", "◆ bot-lobby")}  ${body}`;
  return truncateToWidth(`${line}${hint}`, width, "…");
}

/** An agent at work right now, for the lobby's bottom-line indicator. */
export interface WorkingAgent {
  name: string;
  activity?: string;
  /** Epoch ms it started, for its elapsed time. */
  since?: number;
}

/** The subagents running now: task runs still going, and the quick fix in hand. */
export function workingAgents(runs: readonly AgentRun[], quickFix?: { startedAt?: number }): WorkingAgent[] {
  const agents: WorkingAgent[] = [];
  for (const run of runs) {
    if (run.status !== "running") continue;
    const since = Date.parse(run.startedAt);
    agents.push({ name: agentName(run), ...(run.activity ? { activity: run.activity } : {}), ...(Number.isFinite(since) ? { since } : {}) });
  }
  if (quickFix) agents.push({ name: "QUICK FIX", ...(quickFix.startedAt ? { since: quickFix.startedAt } : {}) });
  return agents;
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

/**
 * `◐ DESIGN editing 2m · DEV running 40s`, at most `width` columns: it gives up
 * the activity and time, then the names, then shows only a count, and nothing
 * when even that does not fit or nothing is working. `spin` is the spinner glyph.
 */
export function agentsIndicator(agents: readonly WorkingAgent[], now: number, spin: string, width: number, theme?: LobbyTheme): string {
  if (agents.length === 0) return "";
  const full = agents.map((agent) => `${agent.name}${agent.activity ? ` ${agent.activity}` : ""}${agent.since ? ` ${elapsed(now - agent.since)}` : ""}`).join(" · ");
  const names = [...new Set(agents.map((agent) => agent.name))].join(" · ");
  const count = `${agents.length} agent${agents.length === 1 ? "" : "s"} working`;
  for (const text of [full, names, count]) {
    if (text.length + 2 <= width) return `${paint(theme, "accent", spin)} ${paint(theme, "muted", text)}`;
  }
  return "";
}
