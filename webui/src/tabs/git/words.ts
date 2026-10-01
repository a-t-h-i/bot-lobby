/**
 * The Git page's wording and small helpers, copied from `src/lobby/tabs/git.ts`
 * (which draws through the terminal layout, so the page cannot import it).
 * Pure and free of the DOM.
 */
import type { PullChecks, PullDetailInfo, PullInfo, PullReadInfo, PullReviewInfo } from "@protocol"
import { formatSince } from "@/lib/format"

export const LIST_TITLE = "Pull requests"
export const DETAIL_TITLE = "Pull request"
export const ACTIONS_LINE = "v reviews it with an agent · f with a focus you type · t is Jev's quick read"
export const NOT_POSTED = "nothing is posted to GitHub"
export const NOT_LOADED = "Press r to load open pull requests with the GitHub CLI (gh)."
export const EMPTY_LIST = "No open pull requests."
export const LOADING_LIST = "loading pull requests from GitHub…"
export const READING = "reading the diff…"
export const JEV_FAILED = "Jev could not read it"
export const STALE = "the pull request has new commits since this review — v reviews it again"
export const NO_DESCRIPTION = "(no description)"
export const FOCUS_LABEL = "Review with a focus (optional)"
export const FOCUS_HINT = "Leave it empty for a full review."

/** `✓` passing, `✗` failing, `●` still running, blank without checks. */
export function checkMark(checks: PullChecks | undefined): string {
  if (checks === "passing") return "✓"
  if (checks === "failing") return "✗"
  return checks === "pending" ? "●" : ""
}

/** The tone a checks mark wears (never colour alone: the glyph stays). */
export function checkTone(checks: PullChecks | undefined): string {
  if (checks === "passing") return "text-primary"
  return checks === "failing" ? "text-destructive" : "text-foreground"
}

/** The size of a change, `+12 −3`. */
export function changeSize(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`
}

/** `approved`, `changes requested` or `review required`. */
export function decisionWords(decision: string | undefined): string {
  if (decision === "APPROVED") return "approved"
  if (decision === "CHANGES_REQUESTED") return "changes requested"
  return decision === "REVIEW_REQUIRED" ? "review required" : ""
}

/** What the list says about our review: `✓ reviewed`, `✗ reviewed`, `◆ reviewed`, `reviewing`. */
export function reviewMark(review: PullInfo["review"]): string {
  if (!review) return ""
  if (review.status === "running") return "reviewing"
  if (review.status !== "done" || !review.verdict) return ""
  if (review.verdict === "approve") return "✓ reviewed"
  return review.verdict === "changes" ? "✗ reviewed" : "◆ reviewed"
}

/** `approve`, `request changes` or `comment`. */
export function verdictWords(verdict: PullReviewInfo["verdict"]): string {
  if (verdict === "approve") return "approve"
  if (verdict === "changes") return "request changes"
  return verdict === "comment" ? "comment" : ""
}

/** A review's right-hand note: `approve · 2m 05s`, `stopped`, `failed`. */
export function reviewNote(review: PullReviewInfo, now: number): string {
  if (review.status === "running") return took(review, now)
  if (review.status === "cancelled") return "stopped"
  const status = review.status === "done" ? took(review, now) : review.status
  return [verdictWords(review.verdict), status].filter(Boolean).join(" · ")
}

/** How long a review took, `2m 05s`. */
export function took(review: PullReviewInfo, now: number): string {
  const seconds = Math.max(0, Math.round(((review.finishedAt ?? now) - review.startedAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

/** The detail's first facts line: state, who opened it and when it last moved. */
export function factsLine(pull: PullDetailInfo, now: number): string {
  const state = pull.state ? (pull.draft ? "draft" : pull.state.toLowerCase()) : pull.draft ? "draft" : ""
  return [
    state,
    pull.author ? `by ${pull.author}` : "",
    pull.updatedAt ? `updated ${formatSince(now - Date.parse(pull.updatedAt))}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The branch and size line: `⎇ feature-search → main · +48 −12 · 6 files`. */
export function branchLine(pull: PullInfo): string {
  const files = `${pull.changedFiles} file${pull.changedFiles === 1 ? "" : "s"}`
  return `⎇ ${pull.headRef || "?"} → ${pull.baseRef || "?"} · ${changeSize(pull.additions, pull.deletions)} · ${files}`
}

/** The checks, decision and merge line. */
export function stateLine(pull: PullDetailInfo): string {
  const merge = pull.mergeable === "CONFLICTING" ? "conflicts" : pull.mergeable === "MERGEABLE" ? "mergeable" : ""
  return [
    pull.checks ? `checks ${pull.checks} (${pull.checkCount})` : "",
    decisionWords(pull.decision),
    merge,
    pull.labels.join(", "),
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The muted line under a list row: files, labels and a stale mark. */
export function metaLine(pull: PullInfo): string {
  return [
    `${pull.changedFiles} file${pull.changedFiles === 1 ? "" : "s"}`,
    pull.labels.join(", "),
    pull.review?.stale ? "stale" : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Jev's read right-hand note: `<model> · <ms> ms`. */
export function readNote(read: PullReadInfo): string {
  return read.read ? `${read.read.model} · ${read.read.ms} ms` : ""
}
