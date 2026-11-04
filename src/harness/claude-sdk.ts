/**
 * Claude Code through the Claude Agent SDK, Anthropic's supported way for an
 * app to drive it (and to run on a Claude plan's Agent SDK credit). The SDK
 * starts the installed `claude` when there is one (or the one set in
 * Settings > Harnesses), else its own bundled build, and hands back the same
 * messages as `claude -p --output-format stream-json`, so `claudeEvents`
 * maps them. When the SDK is not installed, Bot Lobby falls back to the CLI.
 *
 * The options follow T3 Code's Claude adapter (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`):
 * the `claude_code` system prompt preset with Bot Lobby's instructions
 * appended, the effort, the executable path, extra arguments and the
 * permission mode.
 */
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PiStreamEvent } from "../execution/pi-runner.ts";
import { claudeCompactSettings, claudeEnv, claudeEvents, claudeTools, type ClaudeEvent } from "./claude.ts";
import type { HarnessOutcome, HarnessProcessOptions } from "./process.ts";
import type { HarnessAccess, HarnessCollector, HarnessPlan } from "./runner.ts";
import { findCommand } from "./status.ts";

type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query;

let loader: () => Promise<QueryFn | undefined> = async () => {
  try {
    return (await import("@anthropic-ai/claude-agent-sdk")).query as QueryFn;
  } catch {
    return undefined;
  }
};

/** The SDK's `query`, or undefined when the package is not installed. */
export function loadClaudeSdk(): Promise<QueryFn | undefined> {
  return loader();
}

/** Tests swap the SDK for a fake. */
export function setClaudeSdkLoader(next: () => Promise<QueryFn | undefined>): void {
  loader = next;
}

/** Launch arguments as the SDK's `extraArgs`: `--flag value` pairs, a bare flag as null. */
export function extraArgsOf(tokens: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith("-")) continue;
    const [name, inline] = token.replace(/^-+/, "").split(/=(.*)/s, 2) as [string, string | undefined];
    const next = tokens[index + 1];
    if (inline !== undefined) out[name] = inline;
    else if (next !== undefined && !next.startsWith("-")) {
      out[name] = next;
      index++;
    } else out[name] = null;
  }
  return out;
}

export function claudeSdkOptions(plan: HarnessPlan, access: HarnessAccess, input: { cwd: string; env: Record<string, string | undefined>; launchArgs: string[]; abort: AbortController; stderr: (data: string) => void }): Options {
  const { settings } = plan.harness;
  const executable = settings.binaryPath || findCommand("claude");
  const options: Options = {
    cwd: input.cwd,
    abortController: input.abort,
    persistSession: false,
    env: { ...input.env, ...claudeEnv(plan), CLAUDE_AGENT_SDK_CLIENT_APP: "bot-lobby" },
    stderr: input.stderr,
    ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    ...(plan.model ? { model: plan.model } : {}),
    ...(plan.effort ? { effort: plan.effort as NonNullable<Options["effort"]> } : {}),
    ...(plan.instructions ? { systemPrompt: { type: "preset", preset: "claude_code", append: plan.instructions } } : {}),
    ...(input.launchArgs.length > 0 ? { extraArgs: extraArgsOf(input.launchArgs) } : {}),
  };
  const compact = claudeCompactSettings(plan);
  if (compact) options.settings = compact as Options["settings"];
  if (access.writes) {
    options.permissionMode = "bypassPermissions";
    options.allowDangerouslySkipPermissions = true;
  } else {
    const tools = claudeTools(access.tools ?? []);
    options.tools = tools;
    options.allowedTools = tools;
    options.permissionMode = "dontAsk";
  }
  return options;
}

/** The user's messages as the SDK takes them: the prompt, then any steer, until the turn's result. */
function inputQueue(): { stream: AsyncIterable<SDKUserMessage>; push(text: string): void; end(): void } {
  const waiting: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  const queued: SDKUserMessage[] = [];
  let ended = false;
  const message = (text: string): SDKUserMessage => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null });
  return {
    stream: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const item = queued.shift();
          if (item) return Promise.resolve({ value: item, done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => waiting.push(resolve));
        },
      }),
    },
    push(text) {
      if (ended) return;
      const item = message(text);
      const resolve = waiting.shift();
      if (resolve) resolve({ value: item, done: false });
      else queued.push(item);
    },
    end() {
      ended = true;
      for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true });
    },
  };
}

const MAX_STDERR = 64_000;

/** One turn on Claude Code through the SDK, watched like a harness process (stall, cancel, steer). */
export async function runClaudeSdk(query: QueryFn, plan: HarnessPlan, access: HarnessAccess, input: { cwd: string; env: Record<string, string | undefined>; launchArgs: string[]; prompt: string }, collected: HarnessCollector, options: HarnessProcessOptions): Promise<HarnessOutcome> {
  const abort = new AbortController();
  const queue = inputQueue();
  let stderr = "";
  let lastOutput = Date.now();
  let toolsInFlight = 0;
  let killed = false;
  let stalled = false;
  const emit = (event: PiStreamEvent) => {
    lastOutput = Date.now();
    if (event.type === "tool_execution_start") toolsInFlight += 1;
    if (event.type === "tool_execution_end") toolsInFlight = Math.max(0, toolsInFlight - 1);
    options.onEvent?.(event);
  };
  const handle = claudeEvents({ emit, closeInput: () => queue.end() }, collected);
  const onAbort = () => {
    killed = true;
    queue.end();
    abort.abort();
  };
  const watch = setInterval(() => {
    const limit = toolsInFlight > 0 ? options.toolStallTimeoutMs : options.stallTimeoutMs;
    if (!killed && limit && limit > 0 && Date.now() - lastOutput >= limit) {
      stalled = true;
      onAbort();
    }
  }, 1000);
  watch.unref();
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  queue.push(input.prompt);
  options.onStart?.({ steer: (text) => queue.push(text) });
  let exitCode = 0;
  try {
    const sdkOptions = claudeSdkOptions(plan, access, { ...input, abort, stderr: (data) => { lastOutput = Date.now(); if (stderr.length < MAX_STDERR) stderr += data; } });
    for await (const message of query({ prompt: queue.stream, options: sdkOptions })) {
      lastOutput = Date.now();
      handle(message as unknown as ClaudeEvent);
    }
  } catch (error) {
    exitCode = 1;
    if (!killed && !collected.error) collected.error = (error as Error).message;
  } finally {
    clearInterval(watch);
    queue.end();
    options.signal?.removeEventListener("abort", onAbort);
  }
  return { exitCode, stderr, killed, stalled };
}
