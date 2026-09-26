/**
 * The Issues tab: the repository's open GitHub issues through `gh`, the
 * selected issue with its comments, and the way into planning it (p) before it
 * becomes a task.
 */
import type { IssueDetail, IssueSummary } from "../issues.ts";
import { bold, since, columns, fill, paint, rule, selectRow, spinner, split, windowStart, wrap, type LobbyTheme } from "../layout.ts";

export interface IssuesTabInput {
  issues: readonly IssueSummary[];
  selected: number;
  detail?: IssueDetail;
  focus: "list" | "detail";
  detailOffset: number;
  loading: boolean;
  loaded: boolean;
  error?: string;
  notice?: string;
  tick: number;
  now: number;
}

export const ISSUES_COLUMNS_MIN = 90;

export function issueDetailLines(issue: IssueDetail, width: number, now: number, theme?: LobbyTheme): string[] {
  const facts = [
    issue.state ? paint(theme, issue.state === "OPEN" ? "success" : "dim", issue.state.toLowerCase()) : "",
    issue.author ? `by ${issue.author}` : "",
    issue.updatedAt ? `updated ${since(now - Date.parse(issue.updatedAt))}` : "",
    issue.labels.length > 0 ? paint(theme, "warning", issue.labels.join(", ")) : "",
  ].filter(Boolean);
  const lines = [...wrap(bold(theme, `#${issue.number} ${issue.title}`), width), facts.join(paint(theme, "dim", " · "))];
  if (issue.url) lines.push(paint(theme, "dim", issue.url));
  lines.push("", paint(theme, "dim", "p plans it with the planner, then save it as a task"), "", ...wrap(issue.body.trim() || paint(theme, "dim", "(no description)"), width));
  for (const comment of issue.comments) {
    lines.push("", rule(width, comment.author ?? "comment", theme, comment.createdAt ? since(now - Date.parse(comment.createdAt)) : ""), ...wrap(comment.body.trim(), width));
  }
  return lines;
}

function empty(input: IssuesTabInput, width: number, theme?: LobbyTheme): string[] {
  if (input.loading) return [`${paint(theme, "accent", spinner(input.tick))} loading issues from GitHub…`];
  if (input.error) return [];
  if (!input.loaded) return wrap(paint(theme, "dim", "Press r to load open issues with the GitHub CLI (gh)."), width);
  return wrap(paint(theme, "dim", "No open issues. Press n to file one."), width);
}

export function renderIssues(input: IssuesTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const banner = [
    ...(input.error ? wrap(paint(theme, "error", `✗ ${input.error}`), width) : []),
    ...(input.notice ? wrap(paint(theme, "success", input.notice), width) : []),
  ];
  const bodyHeight = Math.max(0, height - banner.length);
  if (input.issues.length === 0) return fill([...banner, rule(width, "Issues", theme), ...empty(input, width, theme)], height, width);
  const selected = Math.min(Math.max(0, input.selected), input.issues.length - 1);
  const wide = width >= ISSUES_COLUMNS_MIN;
  const [listWidth, detailWidth] = wide ? split(width, 0.4, 3, 40) : [width, width];
  const rows = input.issues.map((issue, index) => {
    const labels = issue.labels.length > 0 ? ` ${paint(theme, "warning", `[${issue.labels.slice(0, 2).join(", ")}]`)}` : "";
    const title = index === selected ? bold(theme, issue.title) : issue.title;
    return selectRow(theme, `${paint(theme, "dim", `#${issue.number}`)} ${title}${labels}`, listWidth, index === selected, input.focus === "list");
  });
  const right = input.loading ? `${spinner(input.tick)} refreshing` : `${input.issues.length} open`;
  const listPane = fill([rule(listWidth, "Issues", theme, right), ...rows.slice(windowStart(selected, rows.length, bodyHeight - 1))], bodyHeight);
  const detail = input.detail && input.detail.number === input.issues[selected]!.number
    ? issueDetailLines(input.detail, detailWidth, input.now, theme)
    : [`${paint(theme, "accent", spinner(input.tick))} loading #${input.issues[selected]!.number}…`];
  const detailPane = fill([rule(detailWidth, input.focus === "detail" ? "Issue ◂" : "Issue", theme), ...detail.slice(Math.max(0, Math.min(input.detailOffset, detail.length - 1)))], bodyHeight);
  if (!wide) return fill([...banner, ...(input.focus === "detail" ? detailPane : listPane)], height, width);
  return fill([...banner, ...columns(listPane, detailPane, listWidth, detailWidth, " │ ", theme)], height, width);
}
