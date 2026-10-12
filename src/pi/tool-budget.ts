/**
 * A hard limit on a subagent's tool calls, enforced inside its own process so
 * it holds on every provider and model. The engine sets the budget through
 * `BOT_LOBBY_TOOL_BUDGET` (scouts get `scout.maxToolCalls`). At 60% the next
 * tool result tells the agent to wrap up; past the limit every call is
 * refused with the reason, so the agent writes its report with what it has.
 * An agent that keeps calling anyway is stopped after a few refusals.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const TOOL_BUDGET_ENV = "BOT_LOBBY_TOOL_BUDGET";

export interface ToolBudget {
  /** The call after which the agent is told to wrap up. */
  warnAt: number;
  /** Calls past this are refused. */
  max: number;
}

/** Refusals in a row after which the run is stopped rather than refused again. */
export const MAX_REFUSALS = 5;

/** The env that gives a subagent `max` tool calls; none for 0 (no limit). */
export function toolBudgetEnv(max: number): Record<string, string> {
  return max > 0 ? { [TOOL_BUDGET_ENV]: String(Math.round(max)) } : {};
}

export function parseToolBudget(value: string | undefined): ToolBudget | undefined {
  const max = Number(value);
  if (!value || !Number.isFinite(max) || max < 1) return undefined;
  return { warnAt: Math.max(1, Math.round(max * 0.6)), max: Math.round(max) };
}

/** What the agent is told up front, in its workflow context. */
export function toolBudgetNote(max: number): string {
  const budget = parseToolBudget(String(max));
  return budget ? `Tool budget: at most ${budget.max} tool calls. After ${budget.warnAt} you are told to wrap up; past ${budget.max} every call is refused and you report with what you have.` : "";
}

export function budgetWarning(used: number, budget: ToolBudget): string {
  return `bot-lobby: ${used} of your ${budget.max} tool calls are used. Stop exploring: check only what your answer still needs, then write your report.`;
}

export function budgetRefusal(budget: ToolBudget): string {
  return `bot-lobby: your ${budget.max} tool calls are spent, so this call was not run. Write your report now in the required format with what you have, and mark what you did not verify as an assumption.`;
}

/** Count the agent's own tool calls (not those a tool made for it), warn once, then refuse. */
export function registerToolBudget(pi: ExtensionAPI, budget = parseToolBudget(process.env[TOOL_BUDGET_ENV])): void {
  if (!budget) return;
  let used = 0;
  let refused = 0;
  let warned = false;
  pi.on("tool_call", (event) => {
    if (event.parentToolCallId) return undefined;
    used += 1;
    if (used <= budget.max) return undefined;
    refused += 1;
    return { block: true, reason: budgetRefusal(budget), ...(refused >= MAX_REFUSALS ? { terminate: true } : {}) };
  });
  pi.on("tool_result", (event) => {
    if (event.parentToolCallId || warned || used < budget.warnAt || used > budget.max) return undefined;
    warned = true;
    return { content: [...event.content, { type: "text" as const, text: budgetWarning(used, budget) }] };
  });
}
