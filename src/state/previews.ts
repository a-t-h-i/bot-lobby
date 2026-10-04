import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectProjectRoot } from "./project.ts";

/** Stable identity even when a project is reached through a symlink. */
export function canonicalRoot(root: string): string {
  try { return realpathSync(root); } catch { return resolve(root); }
}

/** No legacy global bucket fallback: files belong to exactly one project. */
export function previewRoot(root = detectProjectRoot(process.cwd())): string {
  return join(tmpdir(), "bot-lobby-previews", createHash("sha256").update(canonicalRoot(root)).digest("hex"));
}
