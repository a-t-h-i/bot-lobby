/**
 * The Quick fix tab: direct prompts that skip the whole workflow. The job list
 * on one side, the selected job's plain-words steps and final report on the
 * other.
 */
import { shortDuration } from "../../text.ts";
import { jobTitle, type QuickFixJob } from "../quickfix.ts";
import { bold, clock, columns, fill, markdownLines, paint, rule, selectRow, spinner, split, windowStart, wrap, wrapHanging, type LobbyTheme } from "../layout.ts";

export interface QuickFixTabInput {
  jobs: readonly QuickFixJob[];
  /** Index into `jobs` shown newest first. */
  selected: number;
  focus: "list" | "detail";
  detailOffset: number;
  profile: string;
  tick: number;
  now: number;
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

function intro(input: QuickFixTabInput, width: number, theme?: LobbyTheme): string[] {
  return [
    bold(theme, "Make a direct change, the way you would ask pi."),
    "",
    "Type what you want below and press enter. One coding agent makes the change right away — no scouting, proposal, plan or review — while any bot-lobby task keeps running. Quick fixes run one at a time in the order you send them.",
    "",
    "Keep them small: a rename, a typo, a one-function fix. If it turns out bigger, the agent stops and says so, and you can plan it as a task.",
    "",
    paint(theme, "dim", `quick fix: ${input.profile}`),
  ].flatMap((line) => wrap(line, width));
}

export function renderQuickFix(input: QuickFixTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  if (input.jobs.length === 0) return fill([rule(width, "Quick fix", theme, input.profile), ...intro(input, width, theme)], height, width);
  const jobs = newestFirst(input.jobs);
  const selected = Math.min(Math.max(0, input.selected), jobs.length - 1);
  const wide = width >= QUICKFIX_COLUMNS_MIN;
  const [listWidth, detailWidth] = wide ? split(width, 0.38, 3, 40) : [width, width];
  const rows = jobs.map((job, index) => {
    const time = elapsed(job, input.now);
    const text = `${mark(job, input.tick, theme)} ${index === selected ? bold(theme, jobTitle(job)) : jobTitle(job)}${time ? ` ${paint(theme, "dim", time)}` : ""}`;
    return selectRow(theme, text, listWidth, index === selected, input.focus === "list");
  });
  const listPane = fill([rule(listWidth, "Quick fixes", theme, `${jobs.length}`), ...rows.slice(windowStart(selected, rows.length, height - 1))], height);
  const detail = jobDetailLines(jobs[selected]!, detailWidth, input.tick, input.now, theme);
  const detailPane = fill([rule(detailWidth, input.focus === "detail" ? "Detail ◂" : "Detail", theme, input.profile), ...detail.slice(Math.max(0, Math.min(input.detailOffset, detail.length - 1)))], height);
  if (!wide) return fill(input.focus === "detail" ? detailPane : listPane, height, width);
  return fill(columns(listPane, detailPane, listWidth, detailWidth, " │ ", theme), height, width);
}
