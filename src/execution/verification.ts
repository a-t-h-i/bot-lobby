/**
 * The verification engine: runs a project's final checks (typecheck, unit
 * tests, build, browser fixtures) through one shared path so completion,
 * `scripts/verify-final.ts` and any concurrent caller execute each check once
 * per fingerprint. Heavy checks run here only — never between intermediate
 * worker steps. Keys cover sources, configuration, dependencies, commands and
 * execution environment, so a recorded pass can be reused while nothing it
 * covered changed, and browser fixtures always consume freshly built assets:
 * `web:check` depends on `web:build` and keys on the built `build.json`.
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { VerificationReport, VerifyResult, VerifyState } from "../schemas/verification.ts";
import { POSIX, signalGroup } from "./pi-runner.ts";

/** What a check prints; injected so tests run without spawning anything. */
export type VerifyExec = (command: string, args: readonly string[], options: { cwd: string; timeoutMs: number; signal?: AbortSignal }) => Promise<{ code: number | null; output: string; timedOut: boolean }>;

export const DEFAULT_TIMEOUT_MS = 30 * 60_000;

export interface VerifyCheck {
  id: string;
  command: string;
  args: readonly string[];
  timeoutMs: number;
  /** Files and directories (walked, without node_modules and dist) that key the result. */
  inputs: readonly string[];
  /** Ids that must pass first; a failed dependency makes this check unavailable. */
  dependsOn?: readonly string[];
}

function killVerificationTree(child: ChildProcess): void {
  if (POSIX) signalGroup(child, "SIGKILL");
  else if (child.pid !== undefined) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { timeout: 5_000, windowsHide: true });
}

function captureOutput(child: ChildProcess): () => string {
  let output = "";
  const read = (part: Buffer) => { output = (output + part.toString()).slice(-200_000); };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);
  return () => output;
}

/** Spawn a check the way the engine runs commands; kill its tree on timeout or abort. */
export const execVerify: VerifyExec = (command, args, options) => new Promise((resolve) => {
  if (options.signal?.aborted) { resolve({ code: null, output: "", timedOut: false }); return; }
  const child = spawn(command, args, { cwd: options.cwd, env: process.env, detached: POSIX, stdio: ["ignore", "pipe", "pipe"] });
  const output = captureOutput(child);
  let done = false;
  let timedOut = false;
  const abort = () => killVerificationTree(child);
  const finish = (code: number | null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    resolve({ code, output: output(), timedOut });
  };
  const timer = setTimeout(() => { timedOut = true; killVerificationTree(child); }, options.timeoutMs).unref();
  options.signal?.addEventListener("abort", abort, { once: true });
  child.on("error", () => finish(null));
  child.on("close", finish);
});

/** Directories never walked for fingerprints: outputs and installed packages. */
const SKIP = new Set(["node_modules", "dist", ".git"]);

function walk(top: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(top, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(top, join(dir, entry.name), out);
    } else if (entry.isFile()) out.push(join(dir, entry.name));
  }
}

/** Inputs as they stand: a content hash per file (an edit that restores size and mtime still changes it), gone files keyed as gone. */
export function checkFingerprint(top: string, check: VerifyCheck): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([check.command, check.args, process.version, process.platform, process.arch,
    Object.entries(process.env).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]));
  const files: string[] = [];
  for (const input of check.inputs) {
    const full = join(top, input);
    if (!existsSync(full)) files.push(input);
    else if (statSync(full).isDirectory()) walk(top, input, files);
    else files.push(input);
  }
  for (const file of [...new Set(files)].sort()) {
    let stamp = "gone";
    try {
      stamp = createHash("sha256").update(readFileSync(join(top, file))).digest("hex");
    } catch {
      // A deleted or unreadable input keys as gone.
    }
    hash.update(`\0${file}\0${stamp}`);
  }
  return hash.digest("hex").slice(0, 24);
}

export interface FinalCheckSpec {
  script: string;
  check: Omit<VerifyCheck, "command" | "args">;
}

/** The checks a project's own scripts define, in run order; absent scripts are not applicable. */
export const FINAL_CHECK_SPECS: readonly FinalCheckSpec[] = [
  { script: "typecheck", check: { id: "typecheck", timeoutMs: 10 * 60_000, inputs: ["package.json", "package-lock.json", "tsconfig.json", "src", "webui/tsconfig.json", "webui/src"] } },
  { script: "test", check: { id: "test", timeoutMs: 60 * 60_000, inputs: ["package.json", "package-lock.json", "tsconfig.json", "src", "test"] } },
  { script: "web:build", check: { id: "web:build", timeoutMs: 10 * 60_000, inputs: ["package.json", "package-lock.json", "webui", "src/lobby/prompts.ts", "src/webui/protocol.ts"] } },
  { script: "web:check", check: { id: "web:check", timeoutMs: 60 * 60_000, inputs: ["package.json", "package-lock.json", "playwright.config.ts", "test/web", "webui/dist/build.json", "src"], dependsOn: ["web:build"] } },
];

/** Read a project's final checks from its package.json scripts. */
export function finalChecks(top: string): VerifyCheck[] {
  let scripts: Record<string, string> | undefined;
  try {
    scripts = JSON.parse(readFileSync(join(top, "package.json"), "utf8")).scripts;
  } catch {
    return [];
  }
  return FINAL_CHECK_SPECS.flatMap((spec) => {
    const script = scripts?.[spec.script];
    return typeof script === "string" && script.trim() ? [{ ...spec.check, command: "npm", args: ["run", spec.script] }] : [];
  });
}

const inFlight = new Map<string, Promise<VerifyResult>>();

function resultOf(id: string, state: VerifyState, summary: string, fingerprint: string, ms = 0, output?: string, reused = false): VerifyResult {
  return { id, state, at: new Date().toISOString(), ms, fingerprint, summary, ...(output ? { output } : {}), ...(reused ? { reused: true } : {}) };
}

/** Run one check: single-flight per fingerprint, so concurrent callers share the work. */
function runCheck(top: string, check: VerifyCheck, exec: VerifyExec, signal: AbortSignal | undefined): Promise<VerifyResult> {
  const fingerprint = checkFingerprint(top, check);
  const key = `${top}:${check.id}:${fingerprint}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const started = Date.now();
  const run = exec(check.command, check.args, { cwd: top, timeoutMs: check.timeoutMs, ...(signal ? { signal } : {}) })
    .then((outcome): VerifyResult => {
      const ms = Date.now() - started;
      if (signal?.aborted) return resultOf(check.id, "cancelled", `${check.id} was cancelled; a cancelled check is not a pass — complete again to re-run it`, fingerprint, ms);
      if (outcome.timedOut) return resultOf(check.id, "fail", `${check.id} timed out after ${Math.round(check.timeoutMs / 60_000)} min`, fingerprint, ms, outcome.output.slice(-4_000));
      if (outcome.code === 0) return resultOf(check.id, "pass", `${check.id} passed`, fingerprint, ms);
      if (outcome.code === null) return resultOf(check.id, "unavailable", `${check.id} could not run (command not found or terminated); an unavailable check is not a pass`, fingerprint, ms, outcome.output.slice(-4_000));
      return resultOf(check.id, "fail", `${check.id} failed with exit ${outcome.code}`, fingerprint, ms, outcome.output.slice(-4_000));
    })
    .catch((error: unknown) => resultOf(check.id, "unavailable", `${check.id} could not run: ${error instanceof Error ? error.message : String(error)}`, fingerprint, Date.now() - started))
    .finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
  inFlight.set(key, run);
  return run;
}

export interface VerificationInput {
  top: string;
  checks: readonly VerifyCheck[];
  /** The task's last report: a pass whose fingerprint still matches is reused, not re-run. */
  previous?: VerificationReport;
  exec?: VerifyExec;
  signal?: AbortSignal;
  now?: () => Date;
}

/** Run the final checks once per fingerprint; the report refuses nothing itself — completion does. */
export async function runVerification(input: VerificationInput): Promise<VerificationReport> {
  const exec = input.exec ?? execVerify;
  const results: VerifyResult[] = [];
  for (const check of input.checks) {
    const fingerprint = checkFingerprint(input.top, check);
    const failedDependency = check.dependsOn?.find((dep) => results.find((result) => result.id === dep)?.state !== "pass");
    if (failedDependency) {
      results.push(resultOf(check.id, "unavailable", `${check.id} was not run: ${failedDependency} did not pass`, fingerprint));
      continue;
    }
    if (input.signal?.aborted) {
      results.push(resultOf(check.id, "cancelled", `${check.id} was cancelled before execution; a cancelled check is not a pass`, fingerprint));
      continue;
    }
    const prior = input.previous?.results.find((result) => result.id === check.id);
    if (!input.signal?.aborted && prior?.state === "pass" && prior.fingerprint === fingerprint) {
      results.push({ ...prior, at: (input.now ?? (() => new Date()))().toISOString(), reused: true });
    } else results.push(await runCheck(input.top, check, exec, input.signal));
  }
  invalidateChangedInputs(input.top, input.checks, results);
  const state = results.length === 0 || results.every((result) => result.state === "pass") ? "passing" : "failing";
  const fingerprint = createHash("sha256").update(results.map((result) => `${result.id}:${result.fingerprint}:${result.state}`).join("\n")).digest("hex").slice(0, 24);
  return { at: (input.now ?? (() => new Date()))().toISOString(), state, fingerprint, results, ...(results.length === 0 ? { note: "no applicable checks: the project defines none of typecheck, test, web:build, web:check" } : {}) };
}

/** Checks cannot pass on inputs that changed while this run was in flight. */
function invalidateChangedInputs(top: string, checks: readonly VerifyCheck[], results: VerifyResult[]): void {
  for (const result of results) {
    const check = checks.find((entry) => entry.id === result.id)!;
    if (result.state !== "pass" || result.fingerprint === checkFingerprint(top, check)) continue;
    result.state = "fail";
    result.summary = `${result.id} inputs changed during verification; run it again on the current tree`;
    delete result.reused;
  }
}

/** One line per check, failures with their output pointer — what to fix and how to re-verify. */
export function verificationSummary(report: VerificationReport): string {
  if (report.note) return report.note;
  return report.results.map((result) => `${result.id}: ${result.summary}${result.reused ? " (reused: unchanged since the last pass)" : ""}`).join("; ");
}
