import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { activityWord } from "../pi/activity.ts";

export interface PiRunOptions {
  cwd: string;
  task: string;
  systemPrompt?: string;
  tools?: readonly string[];
  model?: string;
  thinking?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Reports the current one-word tool activity while the agent works. */
  onActivity?: (activity: string) => void;
}

export interface ProcessOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  killed: boolean;
  timedOut: boolean;
}

/** Streaming agent events forwarded as they arrive on stdout. */
export interface PiStreamEvent {
  type: "tool_execution_start";
  toolName: string;
}

export interface ProcessRunOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  /** Optional sink for streaming agent events (tool starts). */
  onEvent?: (event: PiStreamEvent) => void;
}

export type ProcessRunner = (
  args: string[],
  options: ProcessRunOptions,
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

/** Buffers one JSON-mode stream, keeping only lines parsePiStream consumes. */
export interface StreamCollector {
  push(chunk: string): void;
  finish(): string;
}

/**
 * Buffers one JSON-mode stream, keeping only lines parsePiStream consumes and
 * forwarding tool-start events to an optional sink. Keeping only assistant
 * `message_end` events means a tool-heavy run cannot exhaust memory or
 * truncate the final report. Events split across chunk boundaries are
 * reassembled; malformed lines are ignored exactly as parsePiStream ignores
 * them.
 */
export function createStreamCollector(onEvent?: (event: PiStreamEvent) => void): StreamCollector {
  const partial: string[] = [];
  const kept: string[] = [];
  const keep = (line: string) => {
    // Most lines are per-token `message_update` deltas or large tool results;
    // skip the parse for any line that cannot be one of the two kept events.
    if (!line.includes('"tool_execution_start"') && !line.includes('"message_end"')) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return; // Malformed lines never parse; drop them.
    }
    if (raw === null || typeof raw !== "object") return;
    const event = raw as { type?: string; toolName?: string; message?: { role?: string } };
    if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
      onEvent?.({ type: "tool_execution_start", toolName: event.toolName });
    }
    if (event.type === "message_end" && event.message?.role === "assistant") kept.push(line);
  };
  return {
    // Scan only the new chunk for line breaks; a long line split over many
    // chunks is joined once, when its newline finally arrives.
    push(chunk) {
      let start = 0;
      let newline = chunk.indexOf("\n");
      while (newline >= 0) {
        const tail = chunk.slice(start, newline);
        keep(partial.length > 0 ? partial.splice(0).join("") + tail : tail);
        start = newline + 1;
        newline = chunk.indexOf("\n", start);
      }
      if (start < chunk.length) partial.push(chunk.slice(start));
    },
    finish() {
      if (partial.length > 0) keep(partial.splice(0).join(""));
      return kept.join("\n");
    },
  };
}

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
 * build; otherwise fall back to `pi` on PATH (or BOT_LOBBY_PI_BIN). We match
 * on the launcher filename, not PI_SESSION_ID: that variable is inherited by
 * every child process, including test runners and scripts, where argv[1] is
 * not pi at all.
 */
function resolvePiInvocation(args: string[]): { command: string; args: string[] } {
  const launcher = process.argv[1];
  if (launcher && existsSync(launcher) && isPiLauncher(launcher)) {
    return { command: launcher, args };
  }
  return { command: process.env.BOT_LOBBY_PI_BIN ?? "pi", args };
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

function wireOutput(
  proc: ChildProcess,
  buffers: { stdout: string; stderr: string },
  onEvent?: (event: PiStreamEvent) => void,
): () => void {
  const collector = createStreamCollector(onEvent);
  // Decode as UTF-8 streams so a multi-byte character split across chunks survives.
  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => collector.push(chunk));
  proc.stderr?.on("data", (chunk: string) => {
    // Keep stderr head-bounded: it only feeds exit-code error messages.
    if (buffers.stderr.length < MAX_STREAM_CHARS) buffers.stderr += chunk;
  });
  return () => {
    buffers.stdout = collector.finish();
  };
}

/** Default runner: spawn the same pi binary in JSON mode and collect output. */
export function spawnPiProcess(args: string[], options: ProcessRunOptions): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const invocation = resolvePiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      // Marks subagent processes so bot-lobby skips master-only quiet wiring.
      env: { ...process.env, BOT_LOBBY_SUBAGENT: "1" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const buffers = { stdout: "", stderr: "" };
    const state = { killed: false, timedOut: false };
    const flush = wireOutput(proc, buffers, options.onEvent);

    const finish = (exitCode: number) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      flush();
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
  const dir = mkdtempSync(join(tmpdir(), "bot-lobby-prompt-"));
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
      onEvent: (event) => options.onActivity?.(activityWord(event.toolName)),
    });
    return toResult(parsePiStream(outcome.stdout), outcome, options.signal?.aborted === true);
  } finally {
    prompt?.cleanup();
  }
}
