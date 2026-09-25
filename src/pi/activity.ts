/**
 * One-word description of the tool a subagent is currently running, used by the
 * zen scene to show `[spinner] word - elapsed` under each agent. Pure lookup:
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

export function activityWord(toolName: string): string {
  return ACTIVITY_WORDS[toolName.trim().toLowerCase()] ?? FALLBACK_WORD;
}
