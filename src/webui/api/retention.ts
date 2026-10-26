/**
 * `lobby.retention` / `lobby.setRetention`: whether the repo's `.gitignore`
 * keeps `.pi/bot-lobby` tracked in git. Retention lives in the file itself,
 * not in config — on writes `.pi/*` + `!.pi/bot-lobby/`, off restores the
 * plain `.pi/` ignore; every other line is preserved as written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectProjectRoot } from "../../state/project.ts";
import { retentionEnabled, withRetention } from "../../state/gitignore.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";

/** The repo's .gitignore, under the lobby's project root. */
function gitignorePath(ctx: ApiContext): string {
  return join(ctx.service.projectRoot?.() ?? detectProjectRoot(process.cwd()), ".gitignore");
}

/** The file's content; missing is empty (retention off), anything else fails. */
function readGitignore(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    fail(500, "failed", `could not read this repository's .gitignore: ${(error as Error).message}`);
  }
}

/** Whether `.pi/bot-lobby` is retained in git, read back from the file. */
export function lobbyRetention(ctx: ApiContext): { enabled: boolean } {
  return { enabled: retentionEnabled(readGitignore(gitignorePath(ctx))) };
}

/** Rewrite the managed block so retention matches `enabled`. */
export function lobbySetRetention(body: { enabled: boolean }, ctx: ApiContext): { enabled: boolean } {
  const path = gitignorePath(ctx);
  const next = withRetention(readGitignore(path), body.enabled);
  try {
    writeFileSync(path, next, "utf8");
  } catch (error) {
    fail(500, "failed", `could not write this repository's .gitignore: ${(error as Error).message}`);
  }
  return { enabled: retentionEnabled(next) };
}
