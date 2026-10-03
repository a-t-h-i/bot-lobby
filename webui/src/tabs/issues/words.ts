/**
 * The Issues page's wording and small helpers, copied from
 * `src/lobby/tabs/issues.ts` (which draws through the terminal layout, so the
 * page cannot import it). Pure and free of the DOM.
 */
import type { IssueDetailInfo, IssueInfo } from "@protocol"
import { formatSince } from "@/lib/format"

export const LIST_TITLE = "Issues"
export const DETAIL_TITLE = "Issue"
export const ACTION_LINE = "p plans it with the planning panel, then save it as a task"
export const NOT_LOADED = "Refresh to load open issues with the GitHub CLI (gh)."
export const EMPTY_LIST = "No open issues. File one with New issue."
export const LOADING_LIST = "loading issues from GitHub…"
export const OFF = "issues are off (lobby.issues)"
export const NO_DESCRIPTION = "(no description)"

/** The detail's facts line: state, who opened it, when it last moved, labels. */
export function factsLine(issue: IssueDetailInfo, now: number): string {
  return [
    issue.state ? issue.state.toLowerCase() : "",
    issue.author ? `by ${issue.author}` : "",
    issue.updatedAt ? `updated ${formatSince(now - Date.parse(issue.updatedAt))}` : "",
    issue.labels.join(", "),
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The muted line under a list row: author and age. */
export function rowFacts(issue: IssueInfo, now: number): string {
  return [
    issue.author ? `by ${issue.author}` : "",
    issue.updatedAt ? formatSince(now - Date.parse(issue.updatedAt)) : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The first two labels as `[bug, ui]`, or blank without any. */
export function labelText(labels: string[]): string {
  return labels.length > 0 ? `[${labels.slice(0, 2).join(", ")}]` : ""
}
