/**
 * Saved plans over HTTP: starting one here or in a new background session,
 * and discarding one. Actions answer with the same notice text the terminal
 * shows (the terminal asks twice before discarding; the web call is already
 * an explicit confirmation).
 */
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";

/** Start a saved plan: in this window (`here`) or in a new session of its own. */
export function plansStart(body: { planId: string; where: "here" | "session"; auto?: boolean }, ctx: ApiContext): { notice: string; key?: string } {
  const plan = ctx.service.plans().find((entry) => entry.id === body.planId);
  if (!plan) fail(404, "not_found", `no plan ${body.planId}`);
  if (body.where === "here") return { notice: ctx.service.startPlanned(plan!) };
  const session = ctx.service.startSession({ plan: plan!, ...(body.auto ? { auto: true } : {}) });
  if (typeof session === "string") return { notice: session };
  return { notice: `started ${session.name} in a new session`, key: session.key };
}

/** Discard a saved plan; unknown ids are 404. */
export function plansDiscard(body: { planId: string }, ctx: ApiContext): { notice: string } {
  const plan = ctx.service.plans().find((entry) => entry.id === body.planId);
  if (!plan) fail(404, "not_found", `no plan ${body.planId}`);
  ctx.service.discardPlan(body.planId);
  return { notice: `discarded ${body.planId}` };
}
