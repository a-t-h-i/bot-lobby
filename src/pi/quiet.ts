/**
 * Quiet mode for the master transcript: built-in tool rows render zero lines
 * by default and `alt+t` reveals a compact one-line summary per call. The web
 * tools are removed from the master's active set so the researcher subagent,
 * running in its own process, stays the only web path.
 *
 * bot-lobby's extension also loads inside the subagent processes it spawns
 * (see `spawnPiProcess`). Those children receive their tools from an explicit
 * `--tools` allowlist, so the master-only filtering and renderer overrides must
 * never run there or research silently degrades to repository-only.
 */

/** Web tools owned by pi-web-access; the researcher gets them, the master does not. */
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

/** True inside a bot-lobby subagent process (marked in `spawnPiProcess`). */
export function isSubagentProcess(): boolean {
  return process.env.BOT_LOBBY_SUBAGENT === "1";
}
