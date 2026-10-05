import type { DeliveryOperation, DeliveryResult } from "./types.ts";
import { command, object, type DeliveryContext } from "./transport.ts";
import { sha } from "./source.ts";

export type SaveStage = () => void;
export async function matchingPull(ctx: DeliveryContext, op: DeliveryOperation): Promise<DeliveryResult | undefined> {
  const text = await command(ctx, "gh", ["pr", "list", "--state", "all", "--head", op.sourceBranch!, "--base", "main", "--limit", "1000", "--json", "number,url,state,headRefOid,headRefName,baseRefName"]);
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length >= 1000) throw new Error("PR reconciliation is incomplete; inspect repository PRs before retrying.");
  const matches = rows.map(object).filter((row) => row.headRefOid === op.sourceCommit && row.headRefName === op.sourceBranch && row.baseRefName === "main");
  if (matches.length > 1) throw new Error("Multiple matching PRs; reconcile them manually before retrying.");
  const row = matches[0];
  if (!row) return undefined;
  if (row.state === "CLOSED") throw new Error("Matching PR was closed without merging; reopen it or explicitly review a new source commit.");
  if (!["OPEN", "MERGED"].includes(String(row.state)) || !Number.isInteger(row.number) || typeof row.url !== "string" || !/^https:\/\/github\.com\//.test(row.url)) throw new Error("Malformed matching PR; verify its state manually.");
  return { action: "create_pr", pullNumber: Number(row.number), pullUrl: row.url };
}
async function remoteBranch(ctx: DeliveryContext, branch: string): Promise<string | undefined> {
  const output = await command(ctx, "git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  if (!output) return undefined;
  const [commit, ref] = output.split(/\s+/);
  if (ref !== `refs/heads/${branch}`) throw new Error("Unexpected remote branch identity.");
  return sha(commit!);
}
export async function publishPull(ctx: DeliveryContext, op: DeliveryOperation, save: SaveStage, verify: () => Promise<void>): Promise<DeliveryResult> {
  const existing = await matchingPull(ctx, op);
  if (existing) return existing;
  if (await remoteBranch(ctx, op.sourceBranch!) !== op.sourceCommit) {
    try { await command(ctx, "git", ["push", "origin", `${op.sourceCommit}:refs/heads/${op.sourceBranch}`]); }
    catch (error) { if (await remoteBranch(ctx, op.sourceBranch!) !== op.sourceCommit) throw error; }
  }
  if (await remoteBranch(ctx, op.sourceBranch!) !== op.sourceCommit) throw new Error("Task branch push could not be verified; preserve work and retry after remote access recovers.");
  op.stage = "branch_pushed"; save();
  await verify();
  try { await command(ctx, "gh", ["pr", "create", "--head", op.sourceBranch!, "--base", "main", "--title", `Completed work: ${op.sourceBranch}`, "--body", `Explicit delivery of reviewed commit ${op.sourceCommit}.`]); }
  catch (error) { const found = await matchingPull(ctx, op); if (found) return found; throw error; }
  const result = await matchingPull(ctx, op);
  if (!result) throw new Error("PR creation response was not verified; refresh/retry to reconcile before creating another PR.");
  return result;
}
