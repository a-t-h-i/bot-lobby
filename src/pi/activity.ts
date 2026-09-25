/**
 * One-word descriptions of the tool an agent is running: subagents show it as
 * `[spinner] word - elapsed`, and the oracle names the master's `orchestrate`
 * action. Pure lookup:
 * no clock, environment or I/O reads.
 */
const ACTIVITY_WORDS: Record<string, string> = {
  read: "reading",
  edit: "editing",
  write: "editing",
  grep: "searching",
  find: "searching",
  bash: "running",
  orchestrate: "orchestrating",
  web_search: "researching",
  web_fetch: "researching",
  fetch: "researching",
  fetch_content: "researching",
  get_search_content: "researching",
  source_check: "researching",
};

const FALLBACK_WORD = "working";

/** What the oracle says between its own tool calls while a master turn runs. */
export const ORACLE_THINKING = "thinking";

export function activityWord(toolName: string): string {
  return ACTIVITY_WORDS[toolName.trim().toLowerCase()] ?? FALLBACK_WORD;
}

/** Master `orchestrate` actions -> the word the oracle shows instead of the generic "orchestrating". */
const ORACLE_ACTION_WORDS: Record<string, string> = {
  clarify: "asking",
  scout: "scouting",
  research: "researching",
  propose: "proposing",
  plan: "planning",
  implement: "delegating",
  qa: "reviewing",
  knowledge: "recording",
  compact: "recording",
  decide: "deciding",
  resolve_approval: "deciding",
  complete: "wrapping up",
  status: "checking",
  block: "blocking",
  resume: "resuming",
  cancel: "cancelling",
};

function orchestrateAction(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || !("action" in args)) return undefined;
  const action = (args as { action?: unknown }).action;
  return typeof action === "string" ? action.trim().toLowerCase() : undefined;
}

/** One word for what the oracle (master) is doing; `orchestrate` maps by its action. */
export function oracleActivityWord(toolName: string, args?: unknown): string {
  if (toolName.trim().toLowerCase() !== "orchestrate") return activityWord(toolName);
  const action = orchestrateAction(args);
  return (action && ORACLE_ACTION_WORDS[action]) || FALLBACK_WORD;
}
