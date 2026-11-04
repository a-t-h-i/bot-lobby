/**
 * Skills on this computer, found the way coding agents find them: a folder
 * with a SKILL.md (front matter `name` and `description`) under the project's
 * and the home folder's `.claude/skills`, `.agents/skills` and `.bot-lobby/skills`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface FoundSkill {
  name: string;
  description: string;
  filePath: string;
}

const FOLDERS = [".claude/skills", ".agents/skills", ".bot-lobby/skills"];

function frontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Skills in the project first, then the home folder; first one per name. */
export function findSkills(cwd: string, home = homedir()): FoundSkill[] {
  const found = new Map<string, FoundSkill>();
  for (const base of [cwd, home]) {
    for (const folder of FOLDERS) {
      const dir = join(base, folder);
      if (!existsSync(dir)) continue;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of names) {
        const filePath = join(dir, entry, "SKILL.md");
        if (!existsSync(filePath)) continue;
        try {
          const meta = frontMatter(readFileSync(filePath, "utf8"));
          const name = meta.name || entry;
          if (!found.has(name)) found.set(name, { name, description: meta.description ?? "", filePath });
        } catch {
          // An unreadable skill is skipped.
        }
      }
    }
  }
  return [...found.values()];
}
