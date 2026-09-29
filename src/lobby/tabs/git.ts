/**
 * The Git tab: the repository's open pull requests through `gh`, the selected
 * one with its checks, files, description and discussion, and — the point of
 * the tab — a review of it by a read-only agent (v, or f with a focus), or a
 * quick read by Jev (t), shown right under its facts.
 */
import { textWidth } from "../../width.ts";
import type { PullDetail, PullSummary } from "../pulls.ts";
import { isStale, type PullReadState, type PullReview, type Verdict } from "../pr-review.ts";
import { BRANCH_GLYPH, bold, columns, fill, markdownLines, paint, rule, selectRow, since, spinner, split, spread, windowStart, wrap, wrapHanging, type LobbyTheme } from "../layout.ts";

export interface GitTabInput {
  pulls: readonly PullSummary[];
  selected: number;
  detail?: PullDetail;
  /** The agent's review of the selected pull request, and Jev's read of it. */
  review?: PullReview;
  read?: PullReadState;
  focus: "list" | "detail";
  detailOffset: number;
  loading: boolean;
  loaded: boolean;
  error?: string;
  tick: number;
  now: number;
}

export const GIT_COLUMNS_MIN = 90;

const VERDICTS: Record<Verdict, { words: string; color: "success" | "error" | "warning" }> = {
  approve: { words: "approve", color: "success" },
  changes: { words: "request changes", color: "error" },
  comment: { words: "comment", color: "warning" },
};

/** `✓` passing, `✗` failing, `●` still running, blank without checks. */
function checkMark(pull: PullSummary, theme?: LobbyTheme): string {
  if (pull.checks === "passing") return paint(theme, "success", "✓");
  if (pull.checks === "failing") return paint(theme, "error", "✗");
  if (pull.checks === "pending") return paint(theme, "warning", "●");
  return " ";
}

/** The size of a change, `+12 −3`, added lines green and removed ones red. */
export function changeSize(additions: number, deletions: number, theme?: LobbyTheme): string {
  return `${paint(theme, "success", `+${additions}`)} ${paint(theme, "error", `−${deletions}`)}`;
}

function decisionWords(decision: string | undefined): { words: string; color: "success" | "error" | "warning" } | undefined {
  if (decision === "APPROVED") return { words: "approved", color: "success" };
  if (decision === "CHANGES_REQUESTED") return { words: "changes requested", color: "error" };
  if (decision === "REVIEW_REQUIRED") return { words: "review required", color: "warning" };
  return undefined;
}

/** How long a review took, `2m 05s`. */
function took(review: PullReview, now: number): string {
  const ms = Math.max(0, (review.finishedAt ?? now) - review.startedAt);
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** The review of the selected pull request: running steps, or the finished review, or why it failed. */
export function reviewLines(review: PullReview, detail: PullDetail | undefined, width: number, tick: number, now: number, theme?: LobbyTheme): string[] {
  const lines: string[] = [];
  const verdict = review.verdict ? VERDICTS[review.verdict] : undefined;
  // Short enough to fit beside the title in a narrow pane; the model goes on a line of its own.
  const right = review.status === "running"
    ? `${spinner(tick)} ${took(review, now)}`
    : [verdict ? paint(theme, verdict.color, verdict.words) : "", review.status === "done" ? took(review, now) : review.status].filter(Boolean).join(paint(theme, "dim", " · "));
  lines.push(rule(width, "Review", theme, right));
  if (review.model) lines.push(paint(theme, "dim", [review.model, review.thinking].filter(Boolean).join(" · ")));
  if (review.focus) lines.push(...wrapHanging(paint(theme, "dim", "focus: "), review.focus, width));
  if (review.saved) lines.push(paint(theme, "dim", `kept from ${since(now - review.startedAt)}`));
  if (isStale(review, detail)) lines.push(paint(theme, "warning", "the pull request has new commits since this review — v reviews it again"));
  if (review.status === "running") {
    for (const step of review.steps.slice(-6)) lines.push(...wrapHanging(paint(theme, "dim", "· "), paint(theme, "muted", step), width));
    lines.push(paint(theme, "dim", "x stops it"));
    return lines;
  }
  if (review.status === "cancelled") lines.push(paint(theme, "warning", "stopped"));
  if (review.status === "failed" || review.status === "timeout") lines.push(...wrap(paint(theme, "error", `✗ ${review.error ?? review.status}`), width));
  if (review.text) lines.push(...markdownLines(review.text, width, theme));
  return lines;
}

/** Jev's read: one line, or the reason there is none. */
export function readLines(read: PullReadState, width: number, tick: number, theme?: LobbyTheme): string[] {
  if (read.status === "running") return [rule(width, "Jev's read", theme, spinner(tick)), paint(theme, "dim", "reading the diff…")];
  if (read.status === "failed") return [rule(width, "Jev's read", theme), ...wrap(paint(theme, "warning", read.error ?? "Jev could not read it"), width)];
  return [rule(width, "Jev's read", theme, read.read ? `${read.read.model} · ${read.read.ms} ms` : ""), ...wrap(read.line ?? "", width)];
}

export function pullDetailLines(pull: PullDetail, review: PullReview | undefined, read: PullReadState | undefined, width: number, tick: number, now: number, theme?: LobbyTheme): string[] {
  const dot = paint(theme, "dim", " · ");
  const decision = decisionWords(pull.decision);
  const facts = [
    pull.state ? paint(theme, pull.state === "OPEN" ? "success" : "dim", pull.draft ? "draft" : pull.state.toLowerCase()) : pull.draft ? paint(theme, "dim", "draft") : "",
    pull.author ? `by ${pull.author}` : "",
    pull.updatedAt ? `updated ${since(now - Date.parse(pull.updatedAt))}` : "",
  ].filter(Boolean);
  const checks = pull.checks ? `checks ${paint(theme, pull.checks === "passing" ? "success" : pull.checks === "failing" ? "error" : "warning", pull.checks)} (${pull.checkCount})` : "";
  const merge = pull.mergeable ? (pull.mergeable === "CONFLICTING" ? paint(theme, "error", "conflicts") : pull.mergeable === "MERGEABLE" ? "mergeable" : "") : "";
  const lines = [
    ...wrap(bold(theme, `#${pull.number} ${pull.title}`), width),
    facts.join(dot),
    `${paint(theme, "accent", `${BRANCH_GLYPH} ${pull.headRef || "?"}`)} → ${pull.baseRef || "?"}${dot}${changeSize(pull.additions, pull.deletions, theme)}${dot}${pull.changedFiles} file${pull.changedFiles === 1 ? "" : "s"}`,
    [checks, decision ? paint(theme, decision.color, decision.words) : "", merge, pull.labels.length > 0 ? paint(theme, "warning", pull.labels.join(", ")) : ""].filter(Boolean).join(dot),
  ].filter((line) => line.length > 0);
  if (pull.url) lines.push(paint(theme, "dim", pull.url));
  lines.push("", ...wrap(paint(theme, "dim", "v reviews it with an agent · f with a focus you type · t is Jev's quick read"), width));
  if (read) lines.push("", ...readLines(read, width, tick, theme));
  if (review) lines.push("", ...reviewLines(review, pull, width, tick, now, theme));
  if (pull.files.length > 0) {
    lines.push("", rule(width, "Files", theme, String(pull.files.length)));
    const numbers = pull.files.map((file) => textWidth(changeSize(file.additions, file.deletions)));
    const room = Math.max(...numbers);
    for (const file of pull.files) lines.push(spread(file.path, `${" ".repeat(room - textWidth(changeSize(file.additions, file.deletions)))}${changeSize(file.additions, file.deletions, theme)}`, width));
  }
  lines.push("", rule(width, "Description", theme), ...(pull.body.trim() ? markdownLines(pull.body.trim(), width, theme) : [paint(theme, "dim", "(no description)")]));
  for (const note of pull.notes) {
    const verdict = note.state && note.state !== "COMMENTED" ? paint(theme, note.state === "APPROVED" ? "success" : note.state === "CHANGES_REQUESTED" ? "error" : "warning", note.state.toLowerCase().replace(/_/g, " ")) : "";
    lines.push("", rule(width, note.author ?? "comment", theme, [verdict, note.at ? since(now - Date.parse(note.at)) : ""].filter(Boolean).join(" · ")), ...(note.body.trim() ? markdownLines(note.body.trim(), width, theme) : []));
  }
  return lines;
}

function empty(input: GitTabInput, width: number, theme?: LobbyTheme): string[] {
  if (input.loading) return [`${paint(theme, "accent", spinner(input.tick))} loading pull requests from GitHub…`];
  if (input.error) return [];
  if (!input.loaded) return wrap(paint(theme, "dim", "Press r to load open pull requests with the GitHub CLI (gh)."), width);
  return wrap(paint(theme, "dim", "No open pull requests."), width);
}

/** One row of the list: number, checks, title, and the review's outcome when there is one. */
function row(pull: PullSummary, width: number, selected: boolean, focused: boolean, review: PullReview | undefined, theme?: LobbyTheme): string {
  const verdict = review?.status === "done" && review.verdict ? paint(theme, VERDICTS[review.verdict].color, review.verdict === "approve" ? "✓ reviewed" : review.verdict === "changes" ? "✗ reviewed" : "◆ reviewed") : review?.status === "running" ? paint(theme, "accent", "reviewing") : "";
  const title = selected ? bold(theme, pull.title) : pull.title;
  const draft = pull.draft ? `${paint(theme, "dim", "draft")} ` : "";
  const head = `${paint(theme, "dim", `#${pull.number}`)} ${checkMark(pull, theme)} ${draft}${title}`;
  return selectRow(theme, spread(head, [verdict, changeSize(pull.additions, pull.deletions, theme)].filter(Boolean).join(" "), width), width, selected, focused);
}

export function renderGit(input: GitTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const banner = input.error ? wrap(paint(theme, "error", `✗ ${input.error}`), width) : [];
  const bodyHeight = Math.max(0, height - banner.length);
  if (input.pulls.length === 0) return fill([...banner, rule(width, "Pull requests", theme), ...empty(input, width, theme)], height, width);
  const selected = Math.min(Math.max(0, input.selected), input.pulls.length - 1);
  const wide = width >= GIT_COLUMNS_MIN;
  const [listWidth, detailWidth] = wide ? split(width, 0.4, 3, 40) : [width, width];
  const rows = input.pulls.map((pull, index) => row(pull, listWidth, index === selected, input.focus === "list", pull.number === input.review?.number ? input.review : undefined, theme));
  const right = input.loading ? `${spinner(input.tick)} refreshing` : `${input.pulls.length} open`;
  const listPane = fill([rule(listWidth, "Pull requests", theme, right), ...rows.slice(windowStart(selected, rows.length, bodyHeight - 1))], bodyHeight);
  const current = input.pulls[selected]!;
  const detail = input.detail && input.detail.number === current.number
    ? pullDetailLines(input.detail, input.review, input.read, detailWidth, input.tick, input.now, theme)
    : [`${paint(theme, "accent", spinner(input.tick))} loading #${current.number}…`];
  const detailPane = fill([rule(detailWidth, input.focus === "detail" ? "Pull request ◂" : "Pull request", theme), ...detail.slice(Math.max(0, Math.min(input.detailOffset, detail.length - 1)))], bodyHeight);
  if (!wide) return fill([...banner, ...(input.focus === "detail" ? detailPane : listPane)], height, width);
  return fill([...banner, ...columns(listPane, detailPane, listWidth, detailWidth, " │ ", theme)], height, width);
}
