import type { DeliveryChecksState } from "./types.ts";
import { api, object, pages, type DeliveryContext } from "./transport.ts";

export interface Check { name: string; state: "passing" | "failing" | "pending" }
export interface Checks { state: DeliveryChecksState; entries: Check[]; reason?: string }
function checkRun(raw: unknown, sha: string): Check {
  const row = object(raw);
  if (typeof row.name !== "string" || !row.name || row.head_sha !== sha) throw new Error("Stale or malformed check run; refresh review.");
  if (!["queued", "in_progress", "completed", "waiting", "requested", "pending"].includes(String(row.status))) throw new Error("Unknown check status.");
  if (row.status !== "completed") return { name: row.name, state: "pending" };
  if (!["success", "neutral", "skipped", "failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"].includes(String(row.conclusion))) throw new Error("Unknown check conclusion.");
  return { name: row.name, state: ["success", "neutral", "skipped"].includes(String(row.conclusion)) ? "passing" : "failing" };
}
function status(raw: unknown): Check {
  const row = object(raw);
  if (typeof row.context !== "string" || !row.context || !["success", "pending", "failure", "error"].includes(String(row.state))) throw new Error("Malformed commit status.");
  return { name: row.context, state: row.state === "success" ? "passing" : row.state === "pending" ? "pending" : "failing" };
}
async function statuses(ctx: DeliveryContext, repo: string, sha: string): Promise<Check[]> {
  const combined = object(await api(ctx, `repos/${repo}/commits/${sha}/status`));
  if (combined.sha !== sha || !Number.isInteger(combined.total_count) || !Array.isArray(combined.statuses) || !["success", "pending", "failure"].includes(String(combined.state))) throw new Error("Malformed combined statuses.");
  const rows = await pages(ctx, `repos/${repo}/commits/${sha}/statuses`);
  // GitHub lists newest first; older results for the same context are superseded.
  const latest = new Map<string, Check>();
  for (const raw of rows) { const entry = status(raw); if (!latest.has(entry.name)) latest.set(entry.name, entry); }
  if (latest.size !== combined.total_count) throw new Error("Statuses changed during lookup; refresh review.");
  return [...latest.values()];
}
export async function readChecks(ctx: DeliveryContext, repo: string, sha: string): Promise<Checks> {
  try {
    const runs = await pages(ctx, `repos/${repo}/commits/${sha}/check-runs`, "check_runs");
    const entries = [...runs.map((raw) => checkRun(raw, sha)), ...await statuses(ctx, repo, sha)];
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state));
    const state = entries.some((v) => v.state === "failing") ? "failing" : entries.some((v) => v.state === "pending") ? "pending" : entries.length ? "passing" : "absent";
    return { state, entries };
  } catch (error) { return { state: /[Ss]tale/.test((error as Error).message) ? "stale" : "unavailable", entries: [], reason: (error as Error).message }; }
}
