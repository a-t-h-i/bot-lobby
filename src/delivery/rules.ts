import { api, object, pages, strings, type DeliveryContext } from "./transport.ts";

export interface Rules { known: boolean; required: string[]; policies: unknown[]; blocked?: string }
function effective(raw: unknown, required: Set<string>): string | undefined {
  const rule = object(raw);
  if (typeof rule.type !== "string") throw new Error("Malformed repository rule.");
  if (["deletion", "non_fast_forward"].includes(rule.type)) return undefined;
  if (rule.type !== "required_status_checks") return `Repository rule ${rule.type} prohibits or cannot safely authorize direct pushes. Use a PR or ask a repository administrator.`;
  const params = object(rule.parameters);
  if (typeof params.strict_required_status_checks_policy !== "boolean" || !Array.isArray(params.required_status_checks)) throw new Error("Malformed required status rule.");
  for (const rawCheck of params.required_status_checks) {
    const check = object(rawCheck);
    if (typeof check.context !== "string" || !check.context.trim()) throw new Error("Malformed required check context.");
    if (check.integration_id !== null && check.integration_id !== undefined) throw new Error("App-bound required checks need verified app identity; use a PR.");
    required.add(check.context);
  }
}
function legacy(raw: unknown, required: Set<string>): string | undefined {
  const rule = object(raw);
  if (rule.required_status_checks !== null) {
    const checks = object(rule.required_status_checks);
    if (typeof checks.strict !== "boolean") throw new Error("Malformed legacy status policy.");
    strings(checks.contexts).forEach((name) => required.add(name));
    if (!Array.isArray(checks.checks)) throw new Error("Missing required check bindings.");
    for (const value of checks.checks) { const check = object(value); if (check.app_id !== null) throw new Error("App-bound legacy checks require verified app identity; use a PR."); }
  }
  const linear = object(rule.required_linear_history);
  const signatures = object(rule.required_signatures);
  if (typeof linear.enabled !== "boolean" || typeof signatures.enabled !== "boolean") throw new Error("Unknown branch protection policy.");
  if (rule.required_pull_request_reviews !== null || rule.restrictions !== null || linear.enabled || signatures.enabled) return "Branch protection requires PR/review, restricted pushes, linear history or signed commits; use a PR. No bypass is attempted.";
  if (rule.lock_branch && object(rule.lock_branch).enabled !== false) return "Main is locked; ask a repository administrator.";
}
export async function readRules(ctx: DeliveryContext, repo: string): Promise<Rules> {
  try {
    const branch = object(await api(ctx, `repos/${repo}/branches/main`));
    if (branch.name !== "main" || typeof branch.protected !== "boolean") throw new Error("Malformed main branch response.");
    const policies = await pages(ctx, `repos/${repo}/rules/branches/main`);
    const required = new Set<string>();
    const reasons = policies.map((raw) => effective(raw, required)).filter(Boolean);
    if (branch.protected) {
      const protection = await api(ctx, `repos/${repo}/branches/main/protection`);
      policies.push(protection); reasons.push(legacy(protection, required));
    }
    return { known: true, required: [...required].sort(), policies, blocked: reasons.filter(Boolean).join(" ") || undefined };
  } catch (error) { return { known: false, required: [], policies: [], blocked: `${(error as Error).message} Repository rules must be verified before merging; refresh review or use a PR.` }; }
}
