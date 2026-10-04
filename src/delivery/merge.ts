import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { DeliveryOperation, DeliveryResult } from "./types.ts";
import { command, type DeliveryContext } from "./transport.ts";
import { refreshMain, sha } from "./source.ts";
import type { SaveStage } from "./pr.ts";

async function ancestor(ctx: DeliveryContext, source: string, target: string): Promise<boolean> {
  const result = await ctx.exec("git", ["merge-base", "--is-ancestor", source, target], { cwd: ctx.cwd, timeout: 20_000 });
  if (result.code !== 0 && result.code !== 1) throw new Error("Remote ancestry cannot be verified; restore repository access before retrying.");
  return result.code === 0;
}
export async function reconcileMerge(ctx: DeliveryContext, op: DeliveryOperation): Promise<DeliveryResult | undefined> {
  const remote = await refreshMain(ctx);
  if (await ancestor(ctx, op.mergeCommit ?? op.sourceCommit, remote)) return { action: "merge_main", commit: op.mergeCommit ?? op.sourceCommit };
}
async function integrate(ctx: DeliveryContext, op: DeliveryOperation, save: SaveStage): Promise<void> {
  const directory = mkdtempSync(join(realpathSync(op.repository!), "dev-house-integration-"));
  const path = join(directory, "worktree");
  op.integrationPath = path; op.stage = "integrating"; save();
  await command(ctx, "git", ["worktree", "add", "--detach", path, op.targetCommit!]);
  const isolated = { ...ctx, cwd: path };
  try { await mergeCommit(isolated, op, save); }
  finally { await command(ctx, "git", ["worktree", "remove", "--force", path]); }
}
async function mergeCommit(ctx: DeliveryContext, op: DeliveryOperation, save: SaveStage): Promise<void> {
  try { await command(ctx, "git", ["merge", "--ff", "--no-edit", op.sourceCommit]); }
  catch { await command(ctx, "git", ["merge", "--abort"]); throw new Error("Isolated merge failed (conflict, hooks or identity). Resolve the task branch and refresh review; main was not pushed."); }
  op.mergeCommit = sha(await command(ctx, "git", ["rev-parse", "HEAD^{commit}"]));
  op.stage = "merged"; save();
}
export async function publishMerge(ctx: DeliveryContext, op: DeliveryOperation, save: SaveStage, verify: () => Promise<void>): Promise<DeliveryResult> {
  const existing = await reconcileMerge(ctx, op);
  if (existing) return existing;
  if (!op.mergeCommit) await integrate(ctx, op, save);
  await verify();
  if (await refreshMain(ctx) !== op.targetCommit) throw new Error("Remote main changed. Preserve the recorded merge and refresh review for a fresh explicit approval; no push was attempted.");
  op.stage = "pushing_main"; save();
  try { await command(ctx, "git", ["push", "origin", `${op.mergeCommit}:refs/heads/main`]); }
  catch (error) { const result = await reconcileMerge(ctx, op); if (result) return result; throw error; }
  const result = await reconcileMerge(ctx, op);
  if (!result) throw new Error("Main push cannot be verified; retry reconciliation after remote access recovers.");
  return result;
}
