/**
 * The lint gate's runner: the project's own linter, run by the engine (never
 * by an agent) on the files a task's agents touched, and only those. Each
 * touched file goes to every linter whose config sits nearest above it
 * (ESLint, Biome, Oxlint, Ruff), run from that config's folder with the
 * binary the project installed, so the packages of a monorepo each lint by
 * their own rules; or, when Settings name a command, every touched file goes
 * to that. A linter that is configured but not installed, times out or cannot
 * start reads as "could not run", never as findings: lint never holds a task
 * on a failure of its own. No shell is involved, so a file name is only ever
 * an argument.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { LintConfig } from "../schemas/configuration.ts";
import type { LintFinding, LintRun } from "../schemas/lint.ts";
import { tail } from "../text.ts";

export type { LintFinding, LintReport, LintRun, LintState } from "../schemas/lint.ts";

/** What one linter call gave back: an exit code (null when it never ran to the end), its output, why it failed to run. */
export interface LintExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** missing (not found), timeout, cancelled, or the spawn error. */
  failure?: string;
}

export type LintExec = (command: string, args: readonly string[], options: { cwd: string; timeoutMs: number; signal?: AbortSignal }) => Promise<LintExecResult>;

const MAX_BUFFER = 16 * 1024 * 1024;
/** Findings kept per run; the counts stay whole. */
export const MAX_FINDINGS = 60;
const OUTPUT_TAIL = 3000;

export const execLint: LintExec = (command, args, options) => new Promise((done) => {
  execFile(command, [...args], { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true, ...(options.signal ? { signal: options.signal } : {}) }, (error, stdout, stderr) => {
    const out = String(stdout ?? "");
    const err = String(stderr ?? "");
    if (!error) return done({ code: 0, stdout: out, stderr: err });
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: unknown };
    if (failure.name === "AbortError") return done({ code: null, stdout: out, stderr: err, failure: "cancelled" });
    if (failure.code === "ENOENT") return done({ code: null, stdout: out, stderr: err, failure: "missing" });
    if (failure.killed || failure.signal) return done({ code: null, stdout: out, stderr: err, failure: "timeout" });
    if (typeof failure.code === "number") return done({ code: failure.code, stdout: out, stderr: err });
    done({ code: null, stdout: out, stderr: err, failure: failure.message });
  });
});

/** What a linter's output says, or undefined when it does not read as a lint result (a crash, a config error). */
interface Parsed {
  findings: LintFinding[];
}

interface Linter {
  name: string;
  /** Files whose presence in a folder makes it this linter's: the nearest such folder above a file is where it runs. */
  configs: readonly string[];
  /** A folder whose package.json or pyproject.toml configures it counts too. */
  configured?: (folder: string) => boolean;
  extensions: readonly string[];
  /** The installed binary as `[command, ...leading args]`, looked for from `folder` up to the repository's top. */
  binary(folder: string, top: string): string[] | undefined;
  args(files: readonly string[]): string[];
  read(result: LintExecResult, folder: string, top: string): Parsed | undefined;
}

const JS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro"];

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Folders from `start` up to `top`, nearest first. */
function upward(start: string, top: string): string[] {
  const folders: string[] = [];
  let folder = start;
  for (;;) {
    folders.push(folder);
    if (folder === top) break;
    const parent = dirname(folder);
    const rel = relative(top, parent);
    if (parent === folder || rel.startsWith("..") || isAbsolute(rel)) break;
    folder = parent;
  }
  return folders;
}

/** A package's bin script, run with this Node, found in `node_modules` from `folder` up to `top`. */
function nodeBin(pkg: string, bin: string): (folder: string, top: string) => string[] | undefined {
  return (folder, top) => {
    for (const at of upward(folder, top)) {
      const dir = join(at, "node_modules", pkg);
      const manifest = json(readText(join(dir, "package.json")) ?? "") as { bin?: string | Record<string, string> } | undefined;
      if (!manifest) continue;
      const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[bin];
      if (entry && existsSync(join(dir, entry))) return [process.execPath, join(dir, entry)];
    }
    return undefined;
  };
}

/** Ruff from a virtualenv in the project, else from PATH (where a missing one reads as not installed). */
function ruffBin(folder: string, top: string): string[] {
  const names = process.platform === "win32" ? [join(".venv", "Scripts", "ruff.exe"), join("venv", "Scripts", "ruff.exe")] : [join(".venv", "bin", "ruff"), join("venv", "bin", "ruff")];
  for (const at of upward(folder, top)) for (const name of names) if (existsSync(join(at, name))) return [join(at, name)];
  return ["ruff"];
}

/** A path a linter printed (absolute, or relative to where it ran) as the repository names it. */
const repoPath = (top: string, file: string) => relative(top, resolve(top, file)).split("\\").join("/");

function eslintRead(result: LintExecResult, _folder: string, top: string): Parsed | undefined {
  // 2 is ESLint's own failure (a config error, a crash), not findings.
  if (result.code !== 0 && result.code !== 1) return undefined;
  const reports = json(result.stdout);
  if (!Array.isArray(reports)) return undefined;
  const findings: LintFinding[] = [];
  for (const report of reports as Array<{ filePath?: string; messages?: Array<{ ruleId?: string | null; severity?: number; message?: string; line?: number; column?: number }> }>) {
    for (const message of report.messages ?? []) {
      // A file the config does not cover is skipped, not a finding.
      if (!message.ruleId && /^File ignored\b/.test(message.message ?? "")) continue;
      findings.push({
        file: repoPath(top, report.filePath ?? ""),
        ...(message.line ? { line: message.line } : {}),
        ...(message.column ? { column: message.column } : {}),
        ...(message.ruleId ? { rule: message.ruleId } : {}),
        message: message.message ?? "",
        severity: message.severity === 2 ? "error" : "warning",
      });
    }
  }
  return { findings };
}

function oxlintRead(result: LintExecResult, folder: string, top: string): Parsed | undefined {
  if (result.code !== 0 && result.code !== 1) return undefined;
  const raw = json(result.stdout) as { diagnostics?: unknown[] } | unknown[] | undefined;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.diagnostics) ? raw.diagnostics : undefined;
  if (!list) return undefined;
  return {
    findings: (list as Array<{ message?: string; code?: string; severity?: string; filename?: string; labels?: Array<{ span?: { line?: number; column?: number } }> }>).map((entry) => {
      const span = entry.labels?.[0]?.span;
      return {
        file: repoPath(top, resolve(folder, entry.filename ?? "")),
        ...(span?.line ? { line: span.line } : {}),
        ...(span?.column ? { column: span.column } : {}),
        ...(entry.code ? { rule: entry.code } : {}),
        message: entry.message ?? "",
        severity: entry.severity === "error" ? "error" : "warning",
      } satisfies LintFinding;
    }),
  };
}

/** Biome's GitHub reporter: `::error title=lint/x/y,file=a.ts,line=1,endLine=1,col=1,endColumn=9::message`. */
function biomeRead(result: LintExecResult, folder: string, top: string): Parsed | undefined {
  if (result.code !== 0 && result.code !== 1) return undefined;
  const findings: LintFinding[] = [];
  for (const line of `${result.stdout}\n${result.stderr}`.split("\n")) {
    const match = /^::(error|warning|notice)\s+([^:]*)::(.*)$/.exec(line.trim());
    if (!match) continue;
    const fields = Object.fromEntries(match[2]!.split(",").map((pair) => { const at = pair.indexOf("="); return [pair.slice(0, at), pair.slice(at + 1)]; }));
    if (!fields.file) continue;
    findings.push({
      file: repoPath(top, resolve(folder, fields.file)),
      ...(Number(fields.line) ? { line: Number(fields.line) } : {}),
      ...(Number(fields.col) ? { column: Number(fields.col) } : {}),
      ...(fields.title ? { rule: fields.title } : {}),
      message: match[3]!.trim(),
      severity: match[1] === "error" ? "error" : "warning",
    });
  }
  // Exit 1 with nothing read is Biome failing on its own (a broken config), not a clean run.
  if (result.code === 1 && findings.length === 0) return undefined;
  return { findings };
}

function ruffRead(result: LintExecResult, folder: string, top: string): Parsed | undefined {
  if (result.code !== 0 && result.code !== 1) return undefined;
  const list = json(result.stdout);
  if (!Array.isArray(list)) return undefined;
  return {
    findings: (list as Array<{ code?: string | null; message?: string; filename?: string; location?: { row?: number; column?: number } }>).map((entry) => ({
      file: repoPath(top, resolve(folder, entry.filename ?? "")),
      ...(entry.location?.row ? { line: entry.location.row } : {}),
      ...(entry.location?.column ? { column: entry.location.column } : {}),
      ...(entry.code ? { rule: entry.code } : {}),
      message: entry.message ?? "",
      severity: "error" as const,
    })),
  };
}

function packageHas(folder: string, key: string): boolean {
  const manifest = json(readText(join(folder, "package.json")) ?? "") as Record<string, unknown> | undefined;
  return Boolean(manifest && typeof manifest === "object" && key in manifest);
}

export const LINTERS: readonly Linter[] = [
  {
    name: "ESLint",
    configs: ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"],
    configured: (folder) => packageHas(folder, "eslintConfig"),
    extensions: JS,
    binary: nodeBin("eslint", "eslint"),
    args: (files) => ["--format", "json", ...files],
    read: eslintRead,
  },
  {
    name: "Biome",
    configs: ["biome.json", "biome.jsonc"],
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json", ".jsonc", ".css", ".graphql"],
    binary: nodeBin("@biomejs/biome", "biome"),
    args: (files) => ["lint", "--reporter=github", "--colors=off", "--no-errors-on-unmatched", ...files],
    read: biomeRead,
  },
  {
    name: "Oxlint",
    configs: [".oxlintrc.json", "oxlint.config.ts"],
    extensions: JS,
    binary: nodeBin("oxlint", "oxlint"),
    args: (files) => ["--format", "json", ...files],
    read: oxlintRead,
  },
  {
    name: "Ruff",
    configs: ["ruff.toml", ".ruff.toml"],
    configured: (folder) => /^\[tool\.ruff[\].]/m.test(readText(join(folder, "pyproject.toml")) ?? ""),
    extensions: [".py", ".pyi"],
    binary: ruffBin,
    args: (files) => ["check", "--output-format=json", "--no-fix", "--force-exclude", ...files],
    read: ruffRead,
  },
];

function configuredIn(linter: Linter, folder: string): boolean {
  return linter.configs.some((name) => existsSync(join(folder, name))) || Boolean(linter.configured?.(folder));
}

/** A file as an argument: relative to where the linter runs, never mistakable for an option. */
function argument(folder: string, top: string, file: string): string {
  const rel = relative(folder, join(top, file)).split("\\").join("/");
  return rel.startsWith("-") ? `./${rel}` : rel;
}

/** Split a command line into words, with quotes ('…', "…") holding spaces; no shell ever reads it. */
export function commandWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | undefined;
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = undefined;
      else word += char;
    } else if (char === "'" || char === "\"") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || word) words.push(word);
      word = "";
      started = false;
    } else word += char;
  }
  if (started || word) words.push(word);
  return words;
}

/** `src/a.ts:12:5: message`, `src/a.ts:12: message` or `src/a.ts(12,5): message` lines that name a touched file. */
function genericFindings(text: string, files: readonly string[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(?:\.\/)?([^\s:(][^:(]*?)(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))[:\s-]+(.+)$/.exec(line);
    if (!match) continue;
    const file = files.find((entry) => entry === match[1] || entry.endsWith(`/${match[1]}`));
    if (!file) continue;
    const lineNo = Number(match[2] ?? match[4]);
    const column = Number(match[3] ?? match[5]);
    findings.push({ file, ...(lineNo ? { line: lineNo } : {}), ...(column ? { column } : {}), message: match[6]!.trim(), severity: /\bwarn(ing)?\b/i.test(match[6]!) && !/\berror\b/i.test(match[6]!) ? "warning" : "error" });
  }
  return findings;
}

function unavailable(tool: string, folder: string, files: string[], output: string, ms = 0): LintRun {
  return { tool, folder, files, state: "unavailable", errors: 0, warnings: 0, findings: [], output, ms };
}

function why(result: LintExecResult, tool: string, timeoutMs: number): string {
  if (result.failure === "missing") return `${tool} is not installed here.`;
  if (result.failure === "timeout") return `${tool} took longer than its ${Math.round(timeoutMs / 1000)}s limit.`;
  if (result.failure === "cancelled") return `${tool} was stopped.`;
  const said = tail(`${result.stderr}\n${result.stdout}`.trim(), OUTPUT_TAIL);
  return `${tool} failed to run${result.code !== null ? ` (exit ${result.code})` : ""}${result.failure ? `: ${result.failure}` : ""}${said ? `\n${said}` : ""}`;
}

function counted(tool: string, folder: string, files: string[], findings: LintFinding[], ms: number, output?: string): LintRun {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.length - errors;
  return { tool, folder, files, state: errors > 0 ? "failing" : "passing", errors, warnings, findings, ...(output ? { output } : {}), ms };
}

export interface LintPlan {
  tool: string;
  /** Absolute. */
  folder: string;
  files: string[];
  linter?: Linter;
}

/**
 * Which linter gets which touched file: each file goes to every built-in
 * linter that handles its extension and is configured in a folder above it
 * (the nearest such folder is where that linter runs). With a command in
 * Settings, the files it is given by extension (all of them by default) go to
 * that alone, from the repository's top.
 */
export function planLint(top: string, files: readonly string[], config: Pick<LintConfig, "command" | "extensions">): LintPlan[] {
  if (config.command.trim()) {
    const wanted = config.extensions.length ? files.filter((file) => config.extensions.includes(extname(file).toLowerCase())) : [...files];
    return wanted.length ? [{ tool: commandWords(config.command)[0] ?? "lint", folder: top, files: wanted }] : [];
  }
  const groups = new Map<string, LintPlan>();
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    for (const linter of LINTERS) {
      if (!linter.extensions.includes(ext)) continue;
      const folder = upward(dirname(join(top, file)), top).find((at) => configuredIn(linter, at));
      if (!folder) continue;
      const key = `${linter.name}\0${folder}`;
      const group = groups.get(key) ?? { tool: linter.name, folder, files: [], linter };
      group.files.push(file);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

/** Run one planned linter over its files. */
export async function runPlan(plan: LintPlan, top: string, config: Pick<LintConfig, "command" | "timeoutMs">, exec: LintExec = execLint, signal?: AbortSignal): Promise<LintRun> {
  const started = Date.now();
  const folder = repoPath(top, plan.folder);
  const files = plan.files;
  if (!plan.linter) {
    const words = commandWords(config.command);
    const holder = words.indexOf("{files}");
    const given = files.map((file) => argument(top, top, file));
    const args = holder >= 0 ? [...words.slice(1, holder), ...given, ...words.slice(holder + 1)] : [...words.slice(1), ...given];
    const result = await exec(words[0]!, args, { cwd: top, timeoutMs: config.timeoutMs, ...(signal ? { signal } : {}) });
    const ms = Date.now() - started;
    if (result.code === null) return unavailable(plan.tool, folder, files, why(result, plan.tool, config.timeoutMs), ms);
    if (result.code === 0) return counted(plan.tool, folder, files, [], ms);
    const said = `${result.stdout}\n${result.stderr}`;
    const findings = genericFindings(said, files);
    // A failing command whose lines name no touched file still failed: one finding stands for it.
    const read = findings.length ? findings : [{ file: files[0]!, message: `${plan.tool} exited ${result.code}`, severity: "error" as const }];
    return counted(plan.tool, folder, files, read, ms, tail(said.trim(), OUTPUT_TAIL));
  }
  const binary = plan.linter.binary(plan.folder, top);
  if (!binary) return unavailable(plan.tool, folder, files, `${plan.tool} is configured${folder ? ` in ${folder}/` : ""} but not installed: install the project's dependencies there.`);
  const result = await exec(binary[0]!, [...binary.slice(1), ...plan.linter.args(files.map((file) => argument(plan.folder, top, file)))], { cwd: plan.folder, timeoutMs: config.timeoutMs, ...(signal ? { signal } : {}) });
  const ms = Date.now() - started;
  if (result.code === null) return unavailable(plan.tool, folder, files, why(result, plan.tool, config.timeoutMs), ms);
  const parsed = plan.linter.read(result, plan.folder, top);
  if (!parsed) return unavailable(plan.tool, folder, files, why(result, plan.tool, config.timeoutMs), ms);
  return counted(plan.tool, folder, files, parsed.findings, ms);
}

/** A key for the touched files as they stand and the settings that lint them: equal keys, equal results. */
export function lintFingerprint(top: string, files: readonly string[], config: Pick<LintConfig, "command" | "extensions">): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([config.command, config.extensions]));
  for (const file of [...files].sort()) {
    let stamp = "gone";
    try {
      const stat = statSync(join(top, file));
      stamp = `${stat.size}:${stat.mtimeMs}`;
    } catch {
      // A deleted file keys as gone.
    }
    hash.update(`\0${file}\0${stamp}`);
  }
  return hash.digest("hex").slice(0, 24);
}

/** A linter the project configures, where, and whether its binary is there to run. */
export interface FoundLinter {
  tool: string;
  /** Repository-relative ("" at the top). */
  folder: string;
  installed: boolean;
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".venv", "venv", "target", ".next", ".turbo", "vendor"]);

/** The linters configured in the project (its top and folders up to `depth` below, skipping dependencies and builds), for Settings. */
export function findLinters(top: string, depth = 3, limit = 40): FoundLinter[] {
  const found: FoundLinter[] = [];
  const visit = (folder: string, level: number) => {
    if (found.length >= limit) return;
    for (const linter of LINTERS) {
      if (configuredIn(linter, folder)) found.push({ tool: linter.name, folder: repoPath(top, folder), installed: linter.name === "Ruff" ? ruffBin(folder, top)[0] !== "ruff" || onPath("ruff") : Boolean(linter.binary(folder, top)) });
    }
    if (level >= depth) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP.has(entry.name)).map((entry) => entry.name).sort();
    } catch {
      return;
    }
    for (const name of entries) visit(join(folder, name), level + 1);
  };
  visit(top, 0);
  return found;
}

function onPath(command: string): boolean {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  return (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").some((dir) => dir && extensions.some((ext) => existsSync(join(dir, `${command}${ext}`))));
}
