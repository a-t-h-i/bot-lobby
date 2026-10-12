/**
 * The scripts library: scripts every agent shares for jobs that come back
 * (seeding data, regenerating fixtures, a set of checks, a migration), so a
 * step done once is run the next time, not worked out again, which saves
 * tokens and time. They live in `<data>/scripts/`, one file each, named for
 * what they do in snake_case with the language's extension
 * (`seed_public_holidays.py`, `run_changed_tests.sh`). The first lines of each
 * file say what it is for and how to run it, and the library's index is read
 * from them, so a script edited by hand stays listed. Only the oracle adds or
 * replaces a script; workers propose one. A replaced script is kept under
 * `archive/`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The languages a script may be written in: how it is run and how its header lines are commented. */
export const SCRIPT_LANGUAGES = {
  py: { runner: "python3", comment: "#" },
  sh: { runner: "bash", comment: "#" },
  bash: { runner: "bash", comment: "#" },
  js: { runner: "node", comment: "//" },
  mjs: { runner: "node", comment: "//" },
  cjs: { runner: "node", comment: "//" },
  ts: { runner: "node", comment: "//" },
  rb: { runner: "ruby", comment: "#" },
  pl: { runner: "perl", comment: "#" },
  ps1: { runner: "pwsh -File", comment: "#" },
} as const;
export type ScriptLanguage = keyof typeof SCRIPT_LANGUAGES;

/** Longest name, extension included. */
export const MAX_SCRIPT_NAME = 64;
/** Largest script the library takes. */
export const MAX_SCRIPT_BYTES = 64 * 1024;

const NAME = new RegExp(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)+\\.(${Object.keys(SCRIPT_LANGUAGES).join("|")})$`);
/** How many lines from the top the header is looked for in. */
const HEADER_LINES = 12;

export interface ScriptEntry {
  /** The file name: `seed_public_holidays.py`. */
  name: string;
  path: string;
  language: ScriptLanguage;
  /** What it is for, one line. */
  purpose: string;
  /** How to run it, with its arguments; the runner and path when the header gives none. */
  usage: string;
}

export function scriptsDir(dataRoot: string): string {
  return join(dataRoot, "scripts");
}

/** The words of a name (`seed_public_holidays.py` → `seed public holidays`), for matching it against a step. */
export function nameWords(name: string): string {
  return name.replace(/\.[a-z0-9]+$/, "").replace(/_/g, " ");
}

/**
 * The library name for what was asked: lower-cased, spaces and hyphens as
 * underscores (`Seed public-holidays.py` → `seed_public_holidays.py`). Throws
 * with what is wrong when it still does not read `<what_it_does>.<ext>`.
 */
export function scriptName(asked: string): string {
  const name = asked.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  const languages = Object.keys(SCRIPT_LANGUAGES).map((ext) => `.${ext}`).join(", ");
  if (!/\.[a-z0-9]+$/.test(name) || !(name.split(".").pop()! in SCRIPT_LANGUAGES)) {
    throw new Error(`a script name ends in its language's extension (${languages}): "${asked}"`);
  }
  if (name.length > MAX_SCRIPT_NAME) throw new Error(`a script name is at most ${MAX_SCRIPT_NAME} characters: "${asked}"`);
  if (!NAME.test(name)) {
    throw new Error(`a script is named for what it does, in snake_case words (seed_public_holidays.py): "${asked}"`);
  }
  return name;
}

function language(name: string): ScriptLanguage {
  return name.split(".").pop() as ScriptLanguage;
}

function headerValue(lines: readonly string[], key: string): string | undefined {
  const line = lines.find((entry) => new RegExp(`^\\s*(?:#|//)\\s*${key}\\s*:`, "i").test(entry));
  return line?.replace(new RegExp(`^\\s*(?:#|//)\\s*${key}\\s*:\\s*`, "i"), "").trim() || undefined;
}

/** The command that runs a script when its header gives none. */
export function runCommand(entry: Pick<ScriptEntry, "path" | "language">): string {
  return `${SCRIPT_LANGUAGES[entry.language].runner} ${entry.path}`;
}

function readEntry(dir: string, name: string): ScriptEntry | undefined {
  const path = join(dir, name);
  try {
    if (!statSync(path).isFile()) return undefined;
    const lines = readFileSync(path, "utf8").split("\n").slice(0, HEADER_LINES);
    const entry = { name, path, language: language(name) };
    return { ...entry, purpose: headerValue(lines, "purpose") ?? nameWords(name), usage: headerValue(lines, "usage") ?? runCommand(entry) };
  } catch {
    return undefined;
  }
}

/** Every script in the library, by name; files not named like a script are left out. */
export function listScripts(dataRoot: string): ScriptEntry[] {
  const dir = scriptsDir(dataRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => NAME.test(name))
    .sort()
    .map((name) => readEntry(dir, name))
    .filter((entry): entry is ScriptEntry => entry !== undefined);
}

/** The body with any header lines of its own taken out, and a shebang it starts with kept apart. */
function splitBody(body: string): { shebang?: string; rest: string } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const shebang = lines[0]?.startsWith("#!") ? lines.shift() : undefined;
  const rest = lines.filter((line, index) => index >= HEADER_LINES || !/^\s*(?:#|\/\/)\s*(?:purpose|usage)\s*:/i.test(line));
  while (rest.length > 0 && rest[0]!.trim() === "") rest.shift();
  return { ...(shebang ? { shebang } : {}), rest: rest.join("\n") };
}

export interface SaveScript {
  dataRoot: string;
  name: string;
  purpose: string;
  /** How to run it, with its arguments; the runner and path when absent. */
  usage?: string;
  body: string;
}

export interface SavedScript {
  entry: ScriptEntry;
  /** Where the version it replaced was kept, when there was one. */
  archived?: string;
}

/**
 * Add a script to the library, or replace the one of that name (the old one
 * is kept under `archive/`). The engine writes its header: purpose and usage
 * as comments after any shebang, so the index never depends on the agent
 * having written one.
 */
export function saveScript(input: SaveScript, now = new Date()): SavedScript {
  const name = scriptName(input.name);
  const purpose = input.purpose.replace(/\s+/g, " ").trim();
  if (!purpose) throw new Error("a script needs its purpose: one line on what it does");
  const { shebang, rest } = splitBody(input.body);
  if (!rest.trim()) throw new Error("the script is empty");
  const dir = scriptsDir(input.dataRoot);
  const path = join(dir, name);
  const lang = language(name);
  const usage = input.usage?.replace(/\s+/g, " ").trim() || runCommand({ path, language: lang });
  const { comment } = SCRIPT_LANGUAGES[lang];
  const text = [...(shebang ? [shebang] : []), `${comment} purpose: ${purpose}`, `${comment} usage: ${usage}`, "", rest.replace(/\s+$/, ""), ""].join("\n");
  if (Buffer.byteLength(text) > MAX_SCRIPT_BYTES) throw new Error(`a script is at most ${MAX_SCRIPT_BYTES / 1024} KB`);
  mkdirSync(dir, { recursive: true });
  let archived: string | undefined;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === text) return { entry: readEntry(dir, name)! };
    mkdirSync(join(dir, "archive"), { recursive: true });
    archived = join(dir, "archive", `${name}.${now.toISOString().replace(/[:.]/g, "-")}`);
    copyFileSync(path, archived);
  }
  writeFileSync(path, text, { mode: 0o755 });
  return { entry: readEntry(dir, name)!, ...(archived ? { archived } : {}) };
}
