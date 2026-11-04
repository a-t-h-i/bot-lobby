/**
 * Bot Lobby's data moved out of pi's folders: `~/.pi/bot-lobby` →
 * `~/.bot-lobby` and `<project>/.pi/bot-lobby` → `<project>/.bot-lobby`. On
 * first start each old folder is copied once; the old ones are left alone.
 */
import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { globalConfigDir } from "../state/project.ts";

function copyOnce(from: string, to: string): string | undefined {
  if (existsSync(to) || !existsSync(from)) return undefined;
  cpSync(from, to, { recursive: true, errorOnExist: false, force: false, filter: (path) => !path.endsWith("daemon.lock") });
  return `copied ${from} to ${to} (the old folder is kept)`;
}

/** Copy what is missing; returns one line per copy. */
export function migrateData(root: string, home = homedir()): string[] {
  const out: string[] = [];
  if (process.env.BOT_LOBBY_CONFIG_DIR === undefined) {
    const global = copyOnce(join(home, ".pi", "bot-lobby"), globalConfigDir());
    if (global) out.push(global);
  }
  const project = copyOnce(join(root, ".pi", "bot-lobby"), join(root, ".bot-lobby"));
  if (project) out.push(project);
  return out;
}
