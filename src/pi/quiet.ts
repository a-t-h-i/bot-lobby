/**
 * Quiet mode for the master transcript: built-in tool rows render zero lines
 * by default and `alt+t` reveals a compact one-line summary per call. While a
 * task runs, the web tools are removed from the master's active set so the
 * researcher subagent, running in its own process, stays the task's only web
 * path; without a task, pi has them like any other tool.
 *
 * bot-lobby's extension also loads inside the subagent processes it spawns
 * (see `spawnPiProcess`). Those children receive their tools from an explicit
 * `--tools` allowlist, so the master-only filtering and renderer overrides must
 * never run there or research silently degrades to repository-only.
 */

/** bot-lobby's web tools (src/web/tools.ts): the researcher's, and pi's outside a task, never the oracle's. */
export const WEB_TOOL_NAMES: readonly string[] = [
  "web_search",
  "fetch_content",
  "source_check",
  "get_search_content",
];

let quiet = true;

/** True while built-in tool rows consume no transcript lines. */
export function isQuiet(): boolean {
  return quiet;
}

export function setQuiet(value: boolean): void {
  quiet = value;
}

/** Flip quiet mode and return the new value. */
export function toggleQuiet(): boolean {
  quiet = !quiet;
  return quiet;
}

/** Drop the web tools from an active set, preserving every other name. */
export function visibleTools(active: string[]): string[] {
  return active.filter((name) => !WEB_TOOL_NAMES.includes(name));
}

/**
 * The master's active tools for a turn: without the web tools while a task
 * is active, and with those it took away given back once none is. Only tools
 * it hid itself come back, so a tool the user turned off stays off. Returns
 * undefined when nothing changes.
 */
export function webToolsFor(active: string[], taskActive: boolean, hidden: readonly string[]): { active: string[]; hidden: string[] } | undefined {
  if (taskActive) {
    const taken = active.filter((name) => WEB_TOOL_NAMES.includes(name));
    if (taken.length === 0) return undefined;
    return { active: visibleTools(active), hidden: [...new Set([...hidden, ...taken])] };
  }
  const back = hidden.filter((name) => !active.includes(name));
  if (hidden.length === 0) return undefined;
  return { active: [...active, ...back], hidden: [] };
}

/** True inside a bot-lobby subagent process (marked in `spawnPiProcess`). */
export function isSubagentProcess(): boolean {
  return process.env.BOT_LOBBY_SUBAGENT === "1";
}
