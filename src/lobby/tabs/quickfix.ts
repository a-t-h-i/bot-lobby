/**
 * The Quick fix tab: direct prompts that skip the whole workflow. The job list
 * on one side, the selected job's plain-words steps and final report on the
 * other.
 */
import { shortDuration } from "../../text.ts";
import { jobTitle, type QuickFixJob } from "../quickfix.ts";
import { beside, bold, box, clock, detailWindow, fill, markdownLines, notePane, paint, position, rule, selectRow, spinner, windowStart, wrap, wrapHanging, type LobbyTheme, type PaneLayout } from "../layout.ts";

export interface QuickFixTabInput {
  jobs: readonly QuickFixJob[];
  /** Index into `jobs` shown newest first. */
  selected: number;
  focus: "list" | "detail";
  detailOffset: number;
  profile: string;
  tick: number;
  now: number;
  /** The search in force: only jobs that mention it are listed. */
  query?: string;
  /** Filled with where the list and the detail landed, for scrolling. */
  panes?: PaneLayout;
}

export const QUICKFIX_COLUMNS_MIN = 90;

const STATUS_COLORS: Record<QuickFixJob["status"], "accent" | "success" | "error" | "warning" | "dim" | "muted"> = {
  queued: "muted",
  running: "accent",
  success: "success",
  failed: "error",
  timeout: "error",
  cancelled: "warning",
};

function mark(job: QuickFixJob, tick: number, theme?: LobbyTheme): string {
  if (job.status === "running") return paint(theme, "accent", spinner(tick));
  if (job.status === "queued") return paint(theme, "muted", "…");
  if (job.status === "success") return paint(theme, "success", "✓");
  if (job.status === "cancelled") return paint(theme, "warning", "·");
  return paint(theme, "error", "✗");
}

function elapsed(job: QuickFixJob, now: number): string {
  if (!job.startedAt) return "";
  return shortDuration((job.finishedAt ?? now) - job.startedAt);
}

/** Jobs newest first, the order the list shows. */
export function newestFirst(jobs: readonly QuickFixJob[]): QuickFixJob[] {
  return [...jobs].reverse();
}

export function jobDetailLines(job: QuickFixJob, width: number, tick: number, now: number, theme?: LobbyTheme): string[] {
  const facts = [
    paint(theme, STATUS_COLORS[job.status], job.status),
    elapsed(job, now),
    job.model ? `${job.model}${job.thinking ? ` · ${job.thinking}` : ""}` : job.thinking ?? "",
    job.tools ? `${job.tools} tool${job.tools === 1 ? "" : "s"}` : "",
    job.usage?.cost ? `$${job.usage.cost.toFixed(2)}` : "",
  ].filter(Boolean);
  const lines = [paint(theme, "dim", job.id), facts.join(paint(theme, "dim", " · ")), "", ...wrap(bold(theme, job.prompt), width)];
  lines.push("", rule(width, "Steps", theme));
  if (job.steps.length === 0) lines.push(paint(theme, "dim", job.status === "queued" ? "Waiting for the quick fix ahead of it." : job.status === "running" ? `${spinner(tick)} starting…` : "No tool calls."));
  for (const step of job.steps) {
    const lead = `${paint(theme, "dim", clock(step.at))} ${step.pending && job.status === "running" ? paint(theme, "accent", spinner(tick)) : paint(theme, "dim", "·")} `;
    lines.push(...wrapHanging(lead, step.pending && job.status === "running" ? `${step.text}…` : paint(theme, "muted", step.text), width));
  }
  if (job.error) lines.push("", ...wrap(paint(theme, "error", `✗ ${job.error}`), width));
  if (job.report) {
    lines.push("", rule(width, "Report", theme), ...markdownLines(job.report, width, theme));
  }
  return lines;
}

/** Before the first fix: one sentence, then the agent and the model it runs on. */
function intro(input: QuickFixTabInput, width: number, theme?: LobbyTheme): string[] {
  return [
    ...wrap(bold(theme, "Describe a small change below and one agent makes it now, beside any running task."), width),
    "",
    `${paint(theme, "mdCode", "QUICK FIX".padEnd(11))}${paint(theme, "muted", input.profile)}`,
  ];
}

/** Jobs whose prompt, steps or report mention `query`. */
export function filterJobs(jobs: readonly QuickFixJob[], query: string | undefined): QuickFixJob[] {
  const needle = query?.trim().toLowerCase();
  if (!needle) return [...jobs];
  return jobs.filter((job) => [job.prompt, job.report ?? "", job.error ?? "", ...job.steps.map((step) => step.text)].join("\n").toLowerCase().includes(needle));
}

/** Outer widths of the list and detail panes. */
export function quickFixWidths(width: number): { list: number; detail: number; wide: boolean } {
  if (width < QUICKFIX_COLUMNS_MIN) return { list: width, detail: width, wide: false };
  const list = Math.max(36, Math.round((width - 1) * 0.36));
  return { list, detail: width - 1 - list, wide: true };
}

export function renderQuickFix(input: QuickFixTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const jobs = newestFirst(filterJobs(input.jobs, input.query));
  if (jobs.length === 0) {
    const content = input.query && input.jobs.length > 0 ? [paint(theme, "dim", `No quick fix mentions "${input.query}".`)] : intro(input, width - 4, theme);
    return box(width, height, content, { title: "Quick fix", ...(input.query ? { right: input.profile } : {}), theme });
  }
  const selected = Math.min(Math.max(0, input.selected), jobs.length - 1);
  const { list: listWidth, detail: detailWidth, wide } = quickFixWidths(width);
  const rows = jobs.map((job, index) => {
    const time = elapsed(job, input.now);
    const text = `${mark(job, input.tick, theme)} ${index === selected ? bold(theme, jobTitle(job)) : jobTitle(job)}${time ? ` ${paint(theme, "dim", time)}` : ""}`;
    return selectRow(theme, text, listWidth - 4, index === selected, input.focus === "list");
  });
  const count = input.query ? `${jobs.length} match${jobs.length === 1 ? "" : "es"}` : `${jobs.length}`;
  const listStart = windowStart(selected, rows.length, height - 2);
  const listPane = box(listWidth, height, rows.slice(listStart), { title: "Quick fixes", right: count, focused: input.focus === "list", scroll: { total: rows.length, start: listStart }, theme });
  const detail = jobDetailLines(jobs[selected]!, detailWidth - 4, input.tick, input.now, theme);
  const detailStart = detailWindow(detail.length, height - 2, input.detailOffset);
  const detailNote = [detail.length > height - 2 ? position(detailStart, height - 2, detail.length) : "", input.profile].filter(Boolean).join(" · ");
  const detailPane = box(detailWidth, height, detail.slice(detailStart), { title: "Detail", right: detailNote, focused: input.focus === "detail", scroll: { total: detail.length, start: detailStart }, theme });
  const showList = wide || input.focus !== "detail";
  const showDetail = wide || input.focus === "detail";
  if (showList) notePane(input.panes, "list", 0, 0, listWidth, height, rows.length);
  if (showDetail) notePane(input.panes, "detail", 0, wide ? listWidth + 1 : 0, detailWidth, height, detail.length);
  if (!wide) return fill(showDetail ? detailPane : listPane, height, width);
  return fill(beside([listPane, detailPane]), height, width);
}
