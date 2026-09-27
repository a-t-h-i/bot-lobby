/**
 * The Tasks tab: every task in the project — this session's, those other pi
 * sessions are driving, plans saved from the planner and recently finished
 * ones — with a detail pane showing the approved plan and its progress, the
 * user's comments on it, amendments, what the task waits on and recent runs.
 */
import { TERMINAL_STATES, taskRequest, type Task } from "../../schemas/task.ts";
import type { PlannedTask } from "../../state/backlog.ts";
import type { PlanComment } from "../../state/comments.ts";
import { planChecklist } from "../../pi/zen.ts";
import { persistedRuns } from "../../pi/ui.ts";
import { describeRun, runFromLog } from "../../pi/run-summary.ts";
import { pendingApprovals } from "../../workflow/approvals.ts";
import { ago, beside, bold, box, detailWindow, fill, markdownLines, notePane, paint, position, rule, selectRow, since, windowStart, wrap, wrapHanging, type LobbyTheme, type PaneLayout } from "../layout.ts";

export type TaskSection = "mine" | "others" | "pending" | "recent";

export interface TaskRow {
  kind: "task" | "plan";
  id: string;
  title: string;
  section: TaskSection;
  /** Task state, or `pending` for a saved plan. */
  status: string;
  /** Right-hand note: progress, owner or issue. */
  meta: string;
  /** Auto mode is on: the oracle drives it without asking. */
  auto?: boolean;
}

/** What the lobby knows about sessions beyond this one: background sessions' names, tasks in auto mode. */
export interface RowContext {
  /** Background sessions this window started, by pi session id. */
  names?: ReadonlyMap<string, string>;
  /** Tasks with auto mode on. */
  auto?: ReadonlySet<string>;
}

export const SECTION_TITLES: Record<TaskSection, string> = {
  mine: "THIS SESSION",
  others: "OTHER SESSIONS",
  pending: "PENDING (planned)",
  recent: "RECENT",
};

/** Finished tasks listed under RECENT. */
export const RECENT_LIMIT = 8;

/** Checklist progress as `3/7`, or undefined before a plan exists. */
export function taskProgress(task: Task): { done: number; total: number } | undefined {
  if (!task.plan) return undefined;
  const steps = planChecklist(task.plan, persistedRuns(task));
  if (steps.length === 0) return undefined;
  return { done: steps.filter((step) => step.status === "done").length, total: steps.length };
}

function ownerLabel(task: Task, sessionId: string | undefined, names?: ReadonlyMap<string, string>): string {
  if (!task.ownerSessionId) return "no owner";
  if (task.ownerSessionId === sessionId) return "this session";
  const name = names?.get(task.ownerSessionId);
  // A background session is named after its task, so the row's title already says which one.
  if (name) return name === task.title ? "background" : `background · ${name}`;
  return `session ${task.ownerSessionId.slice(0, 8)}`;
}

/** Rows in display order: this session's task, other sessions', pending plans, then recent finished tasks. */
export function taskRows(tasks: readonly Task[], plans: readonly PlannedTask[], sessionId: string | undefined, now: number, context: RowContext = {}): TaskRow[] {
  const active = tasks.filter((task) => !TERMINAL_STATES.includes(task.state));
  const row = (task: Task, section: TaskSection): TaskRow => {
    const progress = taskProgress(task);
    const owner = section === "others" ? ownerLabel(task, sessionId, context.names) : "";
    const meta = section === "recent" ? ago(now - Date.parse(task.updatedAt)) : [progress ? `${progress.done}/${progress.total}` : "", owner].filter(Boolean).join(" · ");
    const auto = section !== "recent" && context.auto?.has(task.id);
    return { kind: "task", id: task.id, title: task.title, section, status: task.paused ? `${task.state} (paused)` : task.state, meta, ...(auto ? { auto: true } : {}) };
  };
  return [
    ...active.filter((task) => sessionId && task.ownerSessionId === sessionId).map((task) => row(task, "mine")),
    ...active.filter((task) => !sessionId || task.ownerSessionId !== sessionId).map((task) => row(task, "others")),
    ...plans.filter((plan) => plan.status === "pending").map((plan): TaskRow => ({
      kind: "plan", id: plan.id, title: plan.title, section: "pending", status: "pending", meta: plan.issue ? `#${plan.issue.number}` : "",
    })),
    ...tasks.filter((task) => TERMINAL_STATES.includes(task.state)).slice(0, RECENT_LIMIT).map((task) => row(task, "recent")),
  ];
}

const STATE_COLORS: Record<string, "success" | "warning" | "error" | "accent" | "muted" | "dim"> = {
  completed: "success",
  abandoned: "dim",
  blocked: "error",
  awaiting_approval: "warning",
  implementing: "accent",
  reviewing: "accent",
  pending: "muted",
};

function statusColor(status: string): "success" | "warning" | "error" | "accent" | "muted" | "dim" {
  return STATE_COLORS[status.replace(/ \(paused\)$/, "")] ?? "muted";
}

/** List lines with section headers, plus which line holds the selected row. */
export function listLines(rows: readonly TaskRow[], selected: number, width: number, focused: boolean, theme?: LobbyTheme): { lines: string[]; selectedLine: number } {
  const lines: string[] = [];
  let selectedLine = 0;
  let section: TaskSection | undefined;
  rows.forEach((row, index) => {
    if (row.section !== section) {
      section = row.section;
      if (lines.length > 0) lines.push("");
      lines.push(paint(theme, "dim", SECTION_TITLES[section]));
    }
    const marker = index === selected ? paint(theme, "accent", "▸ ") : "  ";
    const status = paint(theme, statusColor(row.status), row.status.replace(/_/g, " "));
    const meta = row.meta ? ` ${paint(theme, "dim", row.meta)}` : "";
    const auto = row.auto ? ` ${paint(theme, "success", "⟳ auto")}` : "";
    const title = index === selected ? bold(theme, row.title) : row.title;
    if (index === selected) selectedLine = lines.length;
    lines.push(selectRow(theme, `${marker}${title} ${paint(theme, "dim", "·")} ${status}${auto}${meta}`, width, index === selected, focused));
  });
  return { lines, selectedLine };
}

const COMMENT_MARKS: Record<PlanComment["status"], string> = { open: "○", delivered: "◐", addressed: "✓" };
const COMMENT_WORDS: Record<PlanComment["status"], string> = { open: "waiting for the owning session", delivered: "sent to the oracle", addressed: "plan amended" };

function section(title: string, width: number, theme?: LobbyTheme, right = ""): string[] {
  return ["", rule(width, title, theme, right)];
}

/** Detail lines for a task: header, plan with progress, comments, amendments, waits and runs. */
export function taskDetailLines(task: Task, comments: readonly PlanComment[], sessionId: string | undefined, width: number, now: number, theme?: LobbyTheme): string[] {
  const lines: string[] = [];
  lines.push(...wrap(bold(theme, `${task.title}`), width));
  const facts = [
    paint(theme, statusColor(task.state), `${task.state.replace(/_/g, " ")}${task.paused ? " (paused)" : ""}`),
    ownerLabel(task, sessionId),
    `started ${since(now - Date.parse(task.createdAt))}`,
    task.domains.length > 0 ? task.domains.join(", ") : "",
  ].filter(Boolean);
  lines.push(paint(theme, "dim", task.id), facts.join(paint(theme, "dim", " · ")));
  const request = taskRequest(task);
  if (request && request !== task.title) lines.push(...section("Request", width, theme), ...wrap(paint(theme, "muted", request), width));
  if (task.plan) {
    const steps = planChecklist(task.plan, persistedRuns(task));
    const done = steps.filter((step) => step.status === "done").length;
    lines.push(...section("Approved plan", width, theme, steps.length > 0 ? `${done}/${steps.length} steps` : ""));
    for (const [index, step] of steps.entries()) {
      const mark = step.status === "done" ? paint(theme, "success", "✓") : step.status === "current" ? paint(theme, "accent", "▸") : paint(theme, "dim", "○");
      const text = step.status === "pending" ? paint(theme, "muted", step.text) : step.text;
      lines.push(...wrapHanging(`${mark} ${index + 1}. `, text, width));
    }
    if (steps.length > 0) lines.push("");
    lines.push(...markdownLines(task.plan, width, theme));
  } else if (task.proposal) {
    lines.push(...section("Proposal (no plan yet)", width, theme), ...markdownLines(task.proposal, width, theme));
  } else {
    lines.push(...section("Plan", width, theme), paint(theme, "dim", "No proposal or plan yet — the oracle is still clarifying or scouting."));
  }
  const open = comments.filter((comment) => comment.status !== "addressed").length;
  lines.push(...section("Comments", width, theme, open > 0 ? `${open} open` : ""));
  if (comments.length === 0) lines.push(paint(theme, "dim", TERMINAL_STATES.includes(task.state) ? "No comments." : "No comments yet — press c to comment on the plan; the oracle amends it."));
  for (const comment of comments) {
    const color = comment.status === "addressed" ? "success" : comment.status === "delivered" ? "accent" : "warning";
    lines.push(...wrapHanging(`${paint(theme, color, COMMENT_MARKS[comment.status])} `, `${comment.text} ${paint(theme, "dim", `— ${COMMENT_WORDS[comment.status]}, ${since(now - Date.parse(comment.createdAt))}`)}`, width));
  }
  if (task.amendments.length > 0) {
    lines.push(...section("Amendments", width, theme));
    for (const amendment of task.amendments) lines.push(...wrapHanging("- ", amendment, width));
  }
  const approvals = pendingApprovals(task);
  if (approvals.length > 0 || task.blockers.length > 0) {
    lines.push(...section("Waiting on", width, theme));
    for (const approval of approvals) lines.push(...wrapHanging(`${paint(theme, "warning", "!")} `, `${approval.kind} for ${approval.domain}: ${approval.detail}`, width));
    for (const blocker of task.blockers) lines.push(...wrapHanging(`${paint(theme, "error", "✗")} `, `${blocker.reason} (needs: ${blocker.need})`, width));
  }
  const runs = (task.runLog ?? []).slice(-6);
  if (runs.length > 0) {
    lines.push(...section("Recent runs", width, theme));
    for (const entry of runs) lines.push(...wrap(paint(theme, "muted", describeRun(runFromLog(entry, task.id), now)), width));
  }
  return lines;
}

/** Detail lines for a saved plan waiting to start. */
export function planDetailLines(plan: PlannedTask, width: number, now: number, theme?: LobbyTheme): string[] {
  const lines = [
    ...wrap(bold(theme, plan.title), width),
    paint(theme, "dim", plan.id),
    [paint(theme, "muted", "pending"), `saved ${since(now - Date.parse(plan.createdAt))}`].join(paint(theme, "dim", " · ")),
  ];
  if (plan.issue) lines.push(...wrap(`from issue #${plan.issue.number} — ${plan.issue.title}${plan.issue.url ? ` ${paint(theme, "dim", plan.issue.url)}` : ""}`, width));
  lines.push("", paint(theme, "dim", "s starts it as a task in this session · d discards it"));
  lines.push(...section("Agreed plan", width, theme), ...markdownLines(plan.brief, width, theme));
  return lines;
}

export interface TasksInput {
  rows: readonly TaskRow[];
  selected: number;
  /** Detail lines for the selected row, already fitted to the detail pane. */
  detail: readonly string[];
  focus: "list" | "detail";
  detailOffset: number;
  notice?: string;
  /** The search in force; the rows are already filtered by it. */
  query?: string;
  /** Filled with where the list and the detail landed, for scrolling. */
  panes?: PaneLayout;
}

/** Narrow terminals show the list or the detail, not both. */
export const TASKS_COLUMNS_MIN = 90;

/** Outer widths of the list and detail panes (the detail's text is 4 columns narrower). */
export function tasksWidths(width: number): { list: number; detail: number; wide: boolean } {
  if (width < TASKS_COLUMNS_MIN) return { list: width, detail: width, wide: false };
  const list = Math.max(36, Math.round((width - 1) * 0.36));
  return { list, detail: width - 1 - list, wide: true };
}

/** Everything a search looks at for one row: id, title, request, proposal, plan. */
function rowText(row: TaskRow, tasks: readonly Task[], plans: readonly PlannedTask[]): string {
  if (row.kind === "plan") {
    const plan = plans.find((entry) => entry.id === row.id);
    return [row.id, row.title, plan?.brief ?? "", plan?.issue?.title ?? ""].join("\n");
  }
  const task = tasks.find((entry) => entry.id === row.id);
  return [row.id, row.title, row.status, task ? taskRequest(task) : "", task?.proposal ?? "", task?.plan ?? ""].join("\n");
}

/** The rows whose task or plan mentions `query` anywhere. */
export function filterRows(rows: readonly TaskRow[], tasks: readonly Task[], plans: readonly PlannedTask[], query: string | undefined): TaskRow[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => rowText(row, tasks, plans).toLowerCase().includes(needle));
}

export function renderTasks(input: TasksInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const notice = input.notice ? [paint(theme, "accent", input.notice)] : [];
  const bodyHeight = height - notice.length;
  if (input.rows.length === 0) {
    const empty = input.query ? `No task or plan mentions "${input.query}".` : "No tasks yet. Start one from the Lobby tab, or plan one in the Plan tab.";
    return fill([...notice, ...box(width, bodyHeight, [paint(theme, "dim", empty)], { title: "Tasks", theme })], height, width);
  }
  const { list: listWidth, detail: detailWidth, wide } = tasksWidths(width);
  const list = listLines(input.rows, input.selected, listWidth - 4, input.focus === "list", theme);
  const rows = Math.max(0, bodyHeight - 2);
  const listStart = windowStart(list.selectedLine, list.lines.length, rows);
  const count = input.query ? `${input.rows.length} match${input.rows.length === 1 ? "" : "es"}` : `${input.rows.length}`;
  const listPane = box(listWidth, bodyHeight, list.lines.slice(listStart), { title: "Tasks", right: count, focused: input.focus === "list", scroll: { total: list.lines.length, start: listStart }, theme });
  const detailStart = detailWindow(input.detail.length, rows, input.detailOffset);
  const detailPane = box(detailWidth, bodyHeight, input.detail.slice(detailStart), { title: "Detail", ...(input.detail.length > rows ? { right: position(detailStart, rows, input.detail.length) } : {}), focused: input.focus === "detail", scroll: { total: input.detail.length, start: detailStart }, theme });
  const showList = wide || input.focus !== "detail";
  const showDetail = wide || input.focus === "detail";
  if (showList) notePane(input.panes, "list", notice.length, 0, listWidth, bodyHeight, list.lines.length);
  if (showDetail) notePane(input.panes, "detail", notice.length, wide ? listWidth + 1 : 0, detailWidth, bodyHeight, input.detail.length);
  if (!wide) return fill([...notice, ...(showDetail ? detailPane : listPane)], height, width);
  return fill([...notice, ...beside([listPane, detailPane])], height, width);
}
