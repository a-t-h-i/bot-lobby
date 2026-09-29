/**
 * The Tasks tab: every task in the project — this session's, those other pi
 * sessions are driving, plans saved from the planner and recently finished
 * ones — with a detail pane showing the approved plan and its progress, the
 * user's comments on it, amendments, what the task waits on and recent runs.
 */
import { TERMINAL_STATES, taskRequest, type Task } from "../../schemas/task.ts";
import type { PlannedTask } from "../../state/backlog.ts";
import type { PlanComment } from "../../state/comments.ts";
import { planChecklist } from "../../pi/plan-checklist.ts";
import { persistedRuns } from "../../pi/ui.ts";
import { describeRun, runFromLog } from "../../pi/run-summary.ts";
import { pendingApprovals } from "../../workflow/approvals.ts";
import { textWidth } from "../../width.ts";
import { ago, beside, bold, box, detailWindow, fill, markdownHanging, markdownLines, notePane, paint, position, rule, selectRow, since, spread, strike, windowStart, wrap, wrapHanging, type LobbyColor, type LobbyTheme, type PaneLayout } from "../layout.ts";

export type TaskSection = "mine" | "others" | "pending" | "recent" | "archived";

/** How a row is ticked off: still to do (a plan, or a task under way), completed, or abandoned. */
export type CheckState = "open" | "done" | "dropped";

export interface TaskRow {
  /** A task on the list, a saved plan, or a task in the archive. */
  kind: "task" | "plan" | "archived";
  id: string;
  title: string;
  section: TaskSection;
  /** Task state, or `pending` for a saved plan. */
  status: string;
  paused?: boolean;
  check: CheckState;
  /** Plan steps done, once the task has a plan. */
  progress?: { done: number; total: number };
  /** Who drives it, for tasks other sessions own. */
  owner?: string;
  /** How long ago it finished (finished tasks), was saved (plans) or was archived, as `3h`. */
  age?: string;
  /** The GitHub issue a plan came from. */
  issue?: number;
  /** Auto mode is on: the oracle drives it without asking. */
  auto?: boolean;
}

/** What the lobby knows about sessions beyond this one: background sessions' names, tasks in auto mode. */
export interface RowContext {
  /** Background sessions this window started, by pi session id. */
  names?: ReadonlyMap<string, string>;
  /** Tasks with auto mode on. */
  auto?: ReadonlySet<string>;
  /** Sessions running now (from their heartbeats); a task whose owner is not among them says so. */
  live?: ReadonlySet<string>;
  /** Archived tasks, listed last when shown. */
  archived?: readonly Task[];
}

export const SECTION_TITLES: Record<TaskSection, string> = {
  mine: "THIS SESSION",
  others: "OTHER SESSIONS",
  pending: "PENDING",
  recent: "FINISHED",
  archived: "ARCHIVED",
};

/** The box each row wears: empty while there is work to do, ticked when completed, crossed when abandoned. */
export const CHECK_MARKS: Record<CheckState, string> = { open: "☐", done: "☑", dropped: "☒" };

export function checkState(task: Task): CheckState {
  if (task.state === "completed") return "done";
  if (task.state === "abandoned") return "dropped";
  return "open";
}

/** Checklist progress as `3/7`, or undefined before a plan exists. */
export function taskProgress(task: Task): { done: number; total: number } | undefined {
  if (!task.plan) return undefined;
  const steps = planChecklist(task.plan, persistedRuns(task));
  if (steps.length === 0) return undefined;
  return { done: steps.filter((step) => step.status === "done").length, total: steps.length };
}

function ownerLabel(task: Task, sessionId: string | undefined, names?: ReadonlyMap<string, string>, live?: ReadonlySet<string>): string {
  if (!task.ownerSessionId) return "not running";
  if (task.ownerSessionId === sessionId) return "this session";
  const name = names?.get(task.ownerSessionId);
  // A background session is named after its task, so the row's title already says which one.
  if (name) return name === task.title ? "background" : `background · ${name}`;
  // An ended session's id tells nobody anything: say that nothing runs the task.
  return live && !live.has(task.ownerSessionId) ? "not running" : `session ${task.ownerSessionId.slice(0, 8)}`;
}

/** Rows in display order: this session's task, other sessions', pending plans, then recent finished tasks. */
export function taskRows(tasks: readonly Task[], plans: readonly PlannedTask[], sessionId: string | undefined, now: number, context: RowContext = {}): TaskRow[] {
  const active = tasks.filter((task) => !TERMINAL_STATES.includes(task.state));
  const row = (task: Task, section: TaskSection): TaskRow => {
    const progress = section === "recent" ? undefined : taskProgress(task);
    const auto = section !== "recent" && context.auto?.has(task.id);
    return {
      kind: "task",
      id: task.id,
      title: task.title,
      section,
      status: task.state,
      ...(task.paused && section !== "recent" ? { paused: true } : {}),
      check: checkState(task),
      ...(progress ? { progress } : {}),
      ...(section === "others" ? { owner: ownerLabel(task, sessionId, context.names, context.live) } : {}),
      ...(section === "recent" ? { age: ago(now - Date.parse(task.updatedAt)) } : {}),
      ...(auto ? { auto: true } : {}),
    };
  };
  return [
    ...active.filter((task) => sessionId && task.ownerSessionId === sessionId).map((task) => row(task, "mine")),
    ...active.filter((task) => !sessionId || task.ownerSessionId !== sessionId).map((task) => row(task, "others")),
    ...plans.filter((plan) => plan.status === "pending").map((plan): TaskRow => ({
      kind: "plan",
      id: plan.id,
      title: plan.title,
      section: "pending",
      status: "pending",
      check: "open",
      ...(plan.createdAt ? { age: ago(now - Date.parse(plan.createdAt)) } : {}),
      ...(plan.issue ? { issue: plan.issue.number } : {}),
    })),
    ...tasks.filter((task) => TERMINAL_STATES.includes(task.state)).map((task) => row(task, "recent")),
    ...(context.archived ?? []).map((task): TaskRow => ({
      kind: "archived",
      id: task.id,
      title: task.title,
      section: "archived",
      status: task.state,
      check: checkState(task),
      age: ago(now - Date.parse(task.archivedAt ?? task.updatedAt)),
    })),
  ];
}

type StateColor = Extract<LobbyColor, "success" | "warning" | "error" | "accent" | "muted" | "dim">;

const STATE_COLORS: Record<string, StateColor> = {
  completed: "success",
  abandoned: "dim",
  blocked: "error",
  awaiting_approval: "warning",
  planning: "accent",
  implementing: "accent",
  reviewing: "accent",
  pending: "muted",
};

function statusColor(status: string): StateColor {
  return STATE_COLORS[status] ?? "muted";
}

/** A task's state in words: `awaiting approval`, `implementing · paused`. */
function stateWords(status: string, paused?: boolean): string {
  return `${status.replace(/_/g, " ")}${paused ? " · paused" : ""}`;
}

/** The row's box, coloured by what it says: the state's colour while open, green when done, dim when dropped. */
export function checkMark(row: Pick<TaskRow, "check" | "status" | "paused">, theme?: LobbyTheme): string {
  const color: StateColor = row.check === "done" ? "success" : row.check === "dropped" ? "dim" : row.paused ? "warning" : statusColor(row.status);
  return paint(theme, color, CHECK_MARKS[row.check]);
}

/** A title as its box says: struck through and dim once abandoned, bold while selected. */
function rowTitle(row: TaskRow, selected: boolean, theme?: LobbyTheme): string {
  if (row.check === "dropped") return paint(theme, "dim", strike(theme, row.title));
  if (row.kind === "archived") return selected ? bold(theme, row.title) : paint(theme, "dim", row.title);
  if (row.check === "done") return selected ? bold(theme, row.title) : paint(theme, "muted", row.title);
  return selected ? bold(theme, row.title) : row.title;
}

/** Progress as pips, `cells` wide: filled for the share done, hollow for the rest. */
export function pips(done: number, total: number, cells: number, theme?: LobbyTheme): string {
  if (cells <= 0 || total <= 0) return "";
  const filled = Math.min(cells, Math.round((Math.max(0, done) / total) * cells));
  return `${paint(theme, done >= total ? "success" : "accent", "▰".repeat(filled))}${paint(theme, "borderMuted", "▱".repeat(cells - filled))}`;
}

/** Plan progress on a row: a pip per step (up to eight) and `3/5`. */
function progressText(progress: TaskRow["progress"], theme?: LobbyTheme): string {
  if (!progress) return "";
  return `${pips(progress.done, progress.total, Math.min(progress.total, 8), theme)} ${paint(theme, "muted", `${progress.done}/${progress.total}`)}`;
}

/** The line under an open row's title: its state, who drives it and whether auto mode is on; a plan's age and issue. */
function detailsLine(row: TaskRow, theme?: LobbyTheme): string {
  const dot = paint(theme, "dim", " · ");
  if (row.kind === "plan") {
    return [paint(theme, "muted", "planned"), row.age ? paint(theme, "dim", row.age === "now" ? "saved just now" : `saved ${row.age} ago`) : "", row.issue ? paint(theme, "dim", `#${row.issue}`) : ""].filter(Boolean).join(dot);
  }
  return [
    paint(theme, row.paused ? "warning" : statusColor(row.status), stateWords(row.status, row.paused)),
    row.auto ? paint(theme, "success", "⟳ auto") : "",
    row.owner ? paint(theme, "dim", row.owner) : "",
  ].filter(Boolean).join(dot);
}

/**
 * List lines with a rule over each section, plus which line holds the
 * selected row. A task or plan still to do takes two lines — its box and
 * title (with plan progress on the right), then its state, owner and auto
 * mode; a finished one takes one, ticked or struck through, with its age.
 */
export function listLines(rows: readonly TaskRow[], selected: number, width: number, focused: boolean, theme?: LobbyTheme): { lines: string[]; selectedLine: number } {
  const lines: string[] = [];
  let selectedLine = 0;
  let section: TaskSection | undefined;
  const counts = new Map<TaskSection, number>();
  for (const row of rows) counts.set(row.section, (counts.get(row.section) ?? 0) + 1);
  rows.forEach((row, index) => {
    if (row.section !== section) {
      section = row.section;
      if (lines.length > 0) lines.push("");
      lines.push(rule(width, SECTION_TITLES[section], theme, String(counts.get(section) ?? 0)));
    }
    const chosen = index === selected;
    const marker = chosen ? paint(theme, "accent", "▸") : " ";
    const head = `${marker} ${checkMark(row, theme)} ${rowTitle(row, chosen, theme)}`;
    if (chosen) selectedLine = lines.length;
    if (row.check !== "open") {
      lines.push(selectRow(theme, spread(head, row.age ? paint(theme, "dim", row.age) : "", width), width, chosen, focused));
      return;
    }
    lines.push(selectRow(theme, spread(head, progressText(row.progress, theme), width), width, chosen, focused));
    lines.push(selectRow(theme, `    ${detailsLine(row, theme)}`, width, chosen, focused));
  });
  return { lines, selectedLine };
}

/** The list pane's right-hand count: what is open and what is finished, or how many rows match a search. */
export function listCount(rows: readonly TaskRow[], query?: string): string {
  if (query) return `${rows.length} match${rows.length === 1 ? "" : "es"}`;
  const listed = rows.filter((row) => row.kind !== "archived");
  const open = listed.filter((row) => row.check === "open").length;
  const finished = listed.length - open;
  const archived = rows.length - listed.length;
  return [open ? `${open} open` : "", finished ? `${finished} finished` : "", archived ? `${archived} archived` : ""].filter(Boolean).join(" · ") || "0";
}

const COMMENT_MARKS: Record<PlanComment["status"], string> = { open: "○", delivered: "◐", addressed: "✓" };
const COMMENT_WORDS: Record<PlanComment["status"], string> = { open: "waiting for the owning session", delivered: "sent to the oracle", addressed: "plan amended" };

/** `note` at the end of the last line when it fits there, else on a line of its own under it. */
function trailing(lines: string[], note: string, width: number): string[] {
  const last = lines.at(-1) ?? "";
  if (textWidth(last) + 1 + textWidth(note) <= width) return [...lines.slice(0, -1), `${last} ${note}`];
  return [...lines, ...wrapHanging("  ", note, width)];
}

function section(title: string, width: number, theme?: LobbyTheme, right = ""): string[] {
  return ["", rule(width, title, theme, right)];
}

/** Detail lines for a task: header, plan with progress, comments, amendments, waits and runs. */
export function taskDetailLines(task: Task, comments: readonly PlanComment[], sessionId: string | undefined, width: number, now: number, theme?: LobbyTheme): string[] {
  const lines: string[] = [];
  const check = checkState(task);
  const row = { check, status: task.state, ...(task.paused ? { paused: true } : {}) };
  const title = check === "dropped" ? paint(theme, "dim", strike(theme, task.title)) : bold(theme, task.title);
  lines.push(...wrapHanging(`${checkMark(row, theme)} `, title, width));
  const dot = paint(theme, "dim", " · ");
  const finished = TERMINAL_STATES.includes(task.state);
  const facts = [
    bold(theme, paint(theme, task.paused ? "warning" : statusColor(task.state), stateWords(task.state, task.paused))),
    finished ? "" : paint(theme, "muted", ownerLabel(task, sessionId)),
    paint(theme, "muted", `started ${since(now - Date.parse(task.createdAt))}`),
    finished ? paint(theme, "muted", `${task.state === "abandoned" ? "dropped" : "done"} ${since(now - Date.parse(task.updatedAt))}`) : "",
  ].filter(Boolean);
  lines.push(...wrapHanging("  ", facts.join(dot), width));
  const track = task.track ? (task.track.path === "fast" ? `fast track (${task.track.size})` : `full workflow (${task.track.size})`) : "";
  lines.push(...wrapHanging("  ", paint(theme, "dim", [task.id, track, task.domains.length > 0 ? task.domains.join(", ") : ""].filter(Boolean).join(" · ")), width));
  const steps = task.plan ? planChecklist(task.plan, persistedRuns(task)) : [];
  const done = steps.filter((step) => step.status === "done").length;
  if (steps.length > 0) {
    const cells = Math.max(4, Math.min(24, width - 20));
    lines.push("", `  ${pips(done, steps.length, cells, theme)} ${paint(theme, "muted", `${done} of ${steps.length} steps`)}`);
  }
  const request = taskRequest(task);
  // Requests are often Markdown: a plan agreed in the planning panel, an issue, a pasted spec.
  if (request && request !== task.title) lines.push(...section("Request", width, theme), ...markdownLines(request, width, theme));
  if (task.plan) {
    if (steps.length > 0) {
      lines.push(...section("Progress", width, theme, `${done}/${steps.length} steps`));
      for (const [index, step] of steps.entries()) {
        const mark = step.status === "done" ? paint(theme, "success", CHECK_MARKS.done) : paint(theme, step.status === "current" ? "accent" : "dim", CHECK_MARKS.open);
        const text = step.status === "done" ? paint(theme, "muted", step.text) : step.status === "current" ? bold(theme, step.text) : paint(theme, "muted", step.text);
        const current = step.status === "current" ? ` ${paint(theme, "accent", "◂ now")}` : "";
        lines.push(...wrapHanging(`${mark} ${paint(theme, "dim", `${index + 1}.`)} `, `${text}${current}`, width));
      }
    }
    lines.push(...section("Approved plan", width, theme));
    lines.push(...markdownLines(task.plan, width, theme));
  } else if (task.proposal) {
    lines.push(...section(TERMINAL_STATES.includes(task.state) ? "Proposal" : "Proposal (no plan yet)", width, theme), ...markdownLines(task.proposal, width, theme));
  } else {
    lines.push(...section("Plan", width, theme), paint(theme, "dim", TERMINAL_STATES.includes(task.state) ? "It ended before a plan was made." : "No proposal or plan yet — the oracle is still clarifying or scouting."));
  }
  const open = comments.filter((comment) => comment.status !== "addressed").length;
  lines.push(...section("Comments", width, theme, open > 0 ? `${open} open` : ""));
  if (comments.length === 0) lines.push(paint(theme, "dim", TERMINAL_STATES.includes(task.state) ? "No comments." : "No comments yet — press c to comment on the plan; the oracle amends it."));
  for (const comment of comments) {
    const color = comment.status === "addressed" ? "success" : comment.status === "delivered" ? "accent" : "warning";
    const said = markdownHanging(`${paint(theme, color, COMMENT_MARKS[comment.status])} `, comment.text, width, theme);
    lines.push(...trailing(said, paint(theme, "dim", `— ${COMMENT_WORDS[comment.status]}, ${since(now - Date.parse(comment.createdAt))}`), width));
  }
  if (task.amendments.length > 0) {
    lines.push(...section("Amendments", width, theme));
    for (const amendment of task.amendments) lines.push(...markdownHanging("- ", amendment, width, theme));
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
  const dot = paint(theme, "dim", " · ");
  const lines = [
    ...wrapHanging(`${checkMark({ check: "open", status: "pending" }, theme)} `, bold(theme, plan.title), width),
    ...wrapHanging("  ", [bold(theme, paint(theme, "muted", "pending")), paint(theme, "muted", `saved ${since(now - Date.parse(plan.createdAt))}`)].join(dot), width),
    ...wrapHanging("  ", paint(theme, "dim", plan.id), width),
  ];
  if (plan.issue) lines.push(...wrapHanging("  ", `from issue #${plan.issue.number} — ${plan.issue.title}${plan.issue.url ? ` ${paint(theme, "dim", plan.issue.url)}` : ""}`, width));
  const key = (text: string) => paint(theme, "accent", text);
  lines.push("", ...wrapHanging("  ", [`${key("s")} ${paint(theme, "muted", "start it in a new session")}`, `${key("h")} ${paint(theme, "muted", "start it here")}`, `${key("d d")} ${paint(theme, "muted", "discard it")}`].join(paint(theme, "dim", "   ")), width));
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
  const count = listCount(input.rows, input.query);
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
