/**
 * The managed `.gitignore` block for bot-lobby's per-project data. Off (the
 * default) ignores all of `.pi/`; on ignores only its siblings and negates
 * `.pi/bot-lobby/` back in, so the lobby's tasks, knowledge and scripts ride
 * with the repo. Pure string handling: no fs, no git subprocesses.
 */

const OFF_COMMENT = "# bot-lobby local task state, knowledge and config";
const ON_COMMENT = "# bot-lobby local task state and config (bot-lobby retained in git)";

/** Every line this module owns, wherever it appears in the file. */
const MANAGED = new Set([OFF_COMMENT, ON_COMMENT, ".pi/", ".pi/*", "!.pi/bot-lobby", "!.pi/bot-lobby/"]);

/** True iff content negates `.pi/bot-lobby` back into the repo. */
export function retentionEnabled(content: string): boolean {
  return content.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed === "!.pi/bot-lobby" || trimmed === "!.pi/bot-lobby/";
  });
}

/** Rewrite content so the managed block matches `enabled`; pure and idempotent. */
export function withRetention(content: string, enabled: boolean): string {
  const block = enabled ? [ON_COMMENT, ".pi/*", "!.pi/bot-lobby/"] : [OFF_COMMENT, ".pi/"];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const kept: string[] = [];
  let at = -1;
  for (const line of lines) {
    if (MANAGED.has(line.trim())) {
      if (at < 0) at = kept.length;
      continue;
    }
    kept.push(line);
  }
  if (at < 0) return kept.length === 0 ? `${block.join("\n")}\n` : `${kept.join("\n")}\n\n${block.join("\n")}\n`;
  kept.splice(at, 0, ...block);
  return `${kept.join("\n")}\n`;
}
