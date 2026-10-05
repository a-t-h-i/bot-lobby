/**
 * The Quick fix tab's wording and small helpers.
 */
import type { QuickFixJob } from "@protocol"

export const INTRO = "Describe a small change in the box below and one agent makes it now, beside any running task."

/** The first non-blank line of the prompt. */
export function jobTitle(job: Pick<QuickFixJob, "prompt">): string {
  return job.prompt.split("\n").find((line) => line.trim())?.trim() ?? "(empty)"
}

/** Jobs newest first, the order the list shows. */
export function newestFirst(jobs: readonly QuickFixJob[]): QuickFixJob[] {
  return [...jobs].reverse()
}

/** `40s`, `2m` or `1m 05s`. */
export function shortDuration(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  const minutes = Math.floor(seconds / 60)
  if (minutes === 0) return `${seconds}s`
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${String(rest).padStart(2, "0")}s`
}

/** How long a job has run (or ran); empty before it starts. */
export function elapsed(job: QuickFixJob, now: number): string {
  if (!job.startedAt) return ""
  return shortDuration((job.finishedAt ?? now) - job.startedAt)
}

/** The facts after the status: `40s · openai/gpt-5 · medium · 2 tools · $0.02`. */
export function factsRest(job: QuickFixJob, now: number): string {
  const model = job.model ? `${job.model}${job.thinking ? ` · ${job.thinking}` : ""}` : (job.thinking ?? "")
  return [
    elapsed(job, now),
    model,
    job.tools ? `${job.tools} tool${job.tools === 1 ? "" : "s"}` : "",
    job.usage?.cost ? `$${job.usage.cost.toFixed(2)}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

/** What the Steps section says before there is a step. */
export function noStepsText(status: QuickFixJob["status"]): string {
  if (status === "queued") return "Waiting for the quick fix ahead of it."
  if (status === "running") return "starting…"
  return status === "held" ? "Not started." : "No tool calls."
}
