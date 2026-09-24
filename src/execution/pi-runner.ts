import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface PiRunOptions {
  cwd: string;
  task: string;
  systemPrompt?: string;
  tools?: readonly string[];
  model?: string;
  thinking?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ProcessOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  killed: boolean;
  timedOut: boolean;
}

export type ProcessRunner = (
  args: string[],
  options: { cwd: string; signal?: AbortSignal; timeoutMs: number },
) => Promise<ProcessOutcome>;

export interface PiRunResult {
  status: "success" | "failed" | "cancelled" | "timeout";
  output: string;
  error?: string;
  usage: { input: number; output: number; cost: number; turns: number };
  model?: string;
}

export interface ParsedStream {
  text: string;
  usage: { input: number; output: number; cost: number; turns: number };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

const MAX_STREAM_CHARS = 5_000_000;

/** Build the `pi` argv for one isolated, non-interactive agent run. */
export function buildPiArgs(options: PiRunOptions & { systemPromptFile?: string }): string[] {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (options.model && options.model !== "inherit") args.push("--model", options.model);
  if (options.thinking) args.push("--thinking", options.thinking);
  if (options.tools && options.tools.length > 0) args.push("--tools", options.tools.join(","));
  if (options.systemPromptFile) args.push("--append-system-prompt", options.systemPromptFile);
  args.push(`Task: ${options.task}`);
  return args;
}

interface MessageLike {
  role?: string;
  content?: unknown;
  usage?: { input?: number; output?: number; cost?: { total?: number } };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } =>
      typeof part === "object" && part !== null && (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .join("");
}

/** Parse the JSON-mode stream defensively; malformed lines are ignored. */
export function parsePiStream(stdout: string): ParsedStream {
  const parsed: ParsedStream = { text: "", usage: { input: 0, output: 0, cost: 0, turns: 0 } };
  for (const line of stdout.split("\n")) {
    let event: { type?: string; message?: MessageLike };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (event?.type !== "message_end" || event.message?.role !== "assistant") continue;
    const message = event.message;
    parsed.usage.turns += 1;
    parsed.usage.input += message.usage?.input ?? 0;
    parsed.usage.output += message.usage?.output ?? 0;
    parsed.usage.cost += message.usage?.cost?.total ?? 0;
    if (message.model) parsed.model = message.model;
    if (message.stopReason) parsed.stopReason = message.stopReason;
    if (message.errorMessage) parsed.errorMessage = message.errorMessage;
    const text = messageText(message.content);
    if (text.trim()) parsed.text = text;
  }
  return parsed;
}

/**
 * Prefer the pi launcher that started this session so subagents use the same
 * build; otherwise fall back to `pi` on PATH (or DEV_HOUSE_PI_BIN). We match
 * on the launcher filename, not PI_SESSION_ID: that variable is inherited by
 * every child process, including test runners and scripts, where argv[1] is
 * not pi at all.
 */
function resolvePiInvocation(args: string[]): { command: string; args: string[] } {
  const launcher = process.argv[1];
  if (launcher && existsSync(launcher) && isPiLauncher(launcher)) {
    return { command: launcher, args };
  }
  return { command: process.env.DEV_HOUSE_PI_BIN ?? "pi", args };
}

/** Exported for tests: mis-detecting a non-pi script re-runs it as an agent. */
export function isPiLauncher(script: string): boolean {
  const base = basename(script);
  return base === "pi" || base === "pi.js" || script.includes("pi-coding-agent");
}

function terminate(proc: ChildProcess): void {
  proc.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }, 5000);
  escalation.unref();
}

function wireOutput(proc: ChildProcess, buffers: { stdout: string; stderr: string }): void {
  const append = (key: "stdout" | "stderr", chunk: string) => {
    if (buffers[key].length < MAX_STREAM_CHARS) buffers[key] += chunk;
  };
  proc.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk.toString()));
  proc.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk.toString()));
}

/** Default runner: spawn the same pi binary in JSON mode and collect output. */
export function spawnPiProcess(args: string[], options: { cwd: string; signal?: AbortSignal; timeoutMs: number }): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const invocation = resolvePiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      // Marks subagent processes so dev-house skips master-only quiet wiring.
      env: { ...process.env, DEV_HOUSE_SUBAGENT: "1" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const buffers = { stdout: "", stderr: "" };
    const state = { killed: false, timedOut: false };
    wireOutput(proc, buffers);

    const finish = (exitCode: number) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode, ...buffers, ...state });
    };
    const onAbort = () => {
      state.killed = true;
      terminate(proc);
    };
    const timer = setTimeout(() => {
      state.killed = true;
      state.timedOut = true;
      terminate(proc);
    }, options.timeoutMs);

    proc.on("close", (code) => finish(code ?? 0));
    proc.on("error", (error: Error) => {
      buffers.stderr += error.message;
      finish(1);
    });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toResult(parsed: ParsedStream, outcome: ProcessOutcome, aborted: boolean): PiRunResult {
  const base = { output: parsed.text, usage: parsed.usage, model: parsed.model };
  if (outcome.timedOut) return { ...base, status: "timeout", error: "agent timed out" };
  if (outcome.killed || aborted || parsed.stopReason === "aborted") {
    return { ...base, status: "cancelled", error: "agent was cancelled" };
  }
  if (outcome.exitCode !== 0) {
    const detail = parsed.errorMessage ?? outcome.stderr.trim();
    return { ...base, status: "failed", error: detail || `pi exited with code ${outcome.exitCode}` };
  }
  if (parsed.stopReason === "error") {
    return { ...base, status: "failed", error: parsed.errorMessage ?? "agent reported an error" };
  }
  if (!parsed.text.trim()) return { ...base, status: "failed", error: "agent produced no usable output" };
  return { ...base, status: "success" };
}

function writePromptFile(prompt: string): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "dev-house-prompt-"));
  const file = join(dir, "system.md");
  writeFileSync(file, prompt, { encoding: "utf8", mode: 0o600 });
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Run one isolated subagent and normalise its outcome. */
export async function runPiAgent(options: PiRunOptions, run: ProcessRunner = spawnPiProcess): Promise<PiRunResult> {
  const prompt = options.systemPrompt ? writePromptFile(options.systemPrompt) : undefined;
  try {
    const args = buildPiArgs({ ...options, systemPromptFile: prompt?.file });
    const outcome = await run(args, {
      cwd: options.cwd,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    return toResult(parsePiStream(outcome.stdout), outcome, options.signal?.aborted === true);
  } finally {
    prompt?.cleanup();
  }
}
