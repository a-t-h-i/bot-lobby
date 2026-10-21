/**
 * The oracle bridge: each third-party harness as a pi model provider
 * (`claude-code/claude-opus-5-5`, `codex-cli/gpt-5.5`, …), so an agent that
 * lives in pi, the oracle above all, can think on a harness while pi keeps
 * the session, the prompts and every Bot Lobby tool.
 *
 * Each user turn starts the harness afresh on the conversation so far
 * (`transcript.ts`) with its own tools switched off and pi's tools served
 * over MCP (`mcp-host.ts`). When the harness calls a tool, the reply pi sees
 * ends with that tool call; pi runs the tool, and its result goes back to
 * the waiting MCP call when pi asks for the next reply, so one harness run
 * spans the whole turn. A conversation that no longer matches the run (a
 * new turn, a cancel, a compaction) starts a new run.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type JsonObject,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type TranscriptContext,
  type Usage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BotLobbyConfig } from "../../schemas/configuration.ts";
import { BRIDGE_DEFAULT_MODEL, BRIDGE_PROVIDERS, HARNESS_IDS, type HarnessId } from "../../schemas/harness.ts";
import { HARNESSES, harnessModels } from "../catalog.ts";
import { collector, harnessLaunch, planHarnessRun, type HarnessAccess, type HarnessCollector } from "../runner.ts";
import { openBridge, type BridgeCall, type BridgeTool } from "./mcp-host.ts";
import { bridgeResult, bridgeTools, bridgeTurn } from "./transcript.ts";

/** How long to wait for more parallel tool calls before handing the batch to pi. */
const TOOL_BATCH_MS = 150;
const CONTEXT_WINDOW = 200_000;
const MAX_TOKENS = 64_000;
/** A bridged run may only use pi's tools: a permission request for anything else is refused. */
const BRIDGE_ACCESS: HarnessAccess = { writes: false, shell: false, web: false, tools: [], mcp: true };

type ToolResult = Extract<Message, { role: "toolResult" }>;

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

/** One pi reply being built from what the harness says. */
class Reply {
  readonly stream: AssistantMessageEventStream = createAssistantMessageEventStream();
  readonly output: AssistantMessage;
  private open: { kind: "text" | "thinking"; index: number } | undefined;
  ended = false;

  constructor(model: Model<Api>) {
    this.output = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(), stopReason: "pending", timestamp: Date.now() };
    this.stream.push({ type: "start", partial: this.output });
  }

  delta(kind: "text" | "thinking", text: string): void {
    if (this.ended || !text) return;
    if (this.open?.kind !== kind) {
      this.close();
      const index = this.output.content.push(kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" }) - 1;
      this.open = { kind, index };
      this.stream.push({ type: kind === "text" ? "text_start" : "thinking_start", contentIndex: index, partial: this.output });
    }
    const { index } = this.open;
    const block = this.output.content[index]!;
    if (block.type === "text") block.text += text;
    else if (block.type === "thinking") block.thinking += text;
    this.stream.push({ type: kind === "text" ? "text_delta" : "thinking_delta", contentIndex: index, delta: text, partial: this.output });
  }

  /** Separate two messages the harness sent as one text block would run them together. */
  break(): void {
    this.close();
  }

  toolCall(call: ToolCall): void {
    if (this.ended) return;
    this.close();
    const index = this.output.content.push(call) - 1;
    this.stream.push({ type: "toolcall_start", contentIndex: index, partial: this.output });
    this.stream.push({ type: "toolcall_end", contentIndex: index, toolCall: call, partial: this.output });
  }

  finish(reason: "stop" | "toolUse", usage: Usage): void {
    if (this.ended) return;
    this.close();
    this.ended = true;
    this.output.stopReason = reason;
    this.output.usage = usage;
    this.stream.push({ type: "done", reason, message: this.output });
    this.stream.end();
  }

  fail(reason: "error" | "aborted", message: string): void {
    if (this.ended) return;
    this.close();
    this.ended = true;
    this.output.stopReason = reason;
    this.output.errorMessage = message;
    this.stream.push({ type: "error", reason, error: this.output });
    this.stream.end();
  }

  private close(): void {
    if (!this.open) return;
    const { kind, index } = this.open;
    const block = this.output.content[index]!;
    this.open = undefined;
    if (kind === "text" && block.type === "text") this.stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: this.output });
    else if (block.type === "thinking") this.stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: this.output });
  }
}

/** One harness run: one user turn, across as many pi replies as it makes tool calls. */
interface Run {
  harness: HarnessId;
  model: string;
  tools: BridgeTool[];
  reply: Reply | undefined;
  /** What the harness did while pi was running tools, for the next reply. */
  queue: Array<(reply: Reply) => void>;
  /** MCP calls waiting on pi, by the tool call id pi was given. */
  waiting: Map<string, BridgeCall>;
  batch: ReturnType<typeof setTimeout> | undefined;
  collected: HarnessCollector;
  reported: { input: number; output: number; cost: number };
  done: boolean;
  abort: AbortController;
}

export interface BridgeHost {
  config(): BotLobbyConfig;
  cwd(): string;
}

const runs = new Map<string, Run>();

function emit(run: Run, act: (reply: Reply) => void): void {
  if (run.reply && !run.reply.ended) act(run.reply);
  else run.queue.push(act);
}

/** Usage since the last reply, so pi's totals add up. */
function usageSince(run: Run): Usage {
  const { input, output, cost } = run.collected.usage;
  const usage = emptyUsage();
  usage.input = Math.max(0, input - run.reported.input);
  usage.output = Math.max(0, output - run.reported.output);
  usage.totalTokens = usage.input + usage.output;
  usage.cost.total = Math.max(0, cost - run.reported.cost);
  run.reported = { input, output, cost };
  return usage;
}

function attach(run: Run, reply: Reply, signal: AbortSignal | undefined): void {
  run.reply = reply;
  for (const act of run.queue.splice(0)) act(reply);
  if (!signal) return;
  const onAbort = () => {
    if (run.reply !== reply) return;
    stopRun(run);
    reply.fail("aborted", "Request was aborted");
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
}

function stopRun(run: Run): void {
  if (run.done) return;
  run.done = true;
  run.reply = undefined;
  clearTimeout(run.batch);
  run.abort.abort();
  for (const call of run.waiting.values()) call.respond({ content: [{ type: "text", text: "The turn was cancelled." }], isError: true });
  run.waiting.clear();
}

function onCall(run: Run, call: BridgeCall): void {
  if (run.done) return call.respond({ content: [{ type: "text", text: "This turn has ended." }], isError: true });
  const id = `bridge_${randomBytes(9).toString("base64url")}`;
  run.waiting.set(id, call);
  const toolCall: ToolCall = { type: "toolCall", id, name: call.name, arguments: call.arguments as JsonObject };
  emit(run, (reply) => {
    reply.toolCall(toolCall);
    // Parallel calls arrive one by one: hand pi the batch once they stop coming.
    clearTimeout(run.batch);
    run.batch = setTimeout(() => {
      if (run.reply !== reply) return;
      run.reply = undefined;
      reply.finish("toolUse", usageSince(run));
    }, TOOL_BATCH_MS);
  });
}

/** The tool results (and anything the user added meanwhile) after the reply that made the calls. */
function tail(context: TranscriptContext): { results: ToolResult[]; added: string[] } {
  const turns = context.messages.filter((message) => message.role !== "system");
  let start = turns.length;
  while (start > 0 && turns[start - 1]!.role !== "assistant") start--;
  const results: ToolResult[] = [];
  const added: string[] = [];
  for (const message of turns.slice(start)) {
    if (message.role === "toolResult") results.push(message);
    else if (message.role === "user") added.push(typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n"));
  }
  return { results, added };
}

function startRun(host: BridgeHost, id: HarnessId, model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions | undefined, reply: Reply, key: string): void {
  const settings = host.config().harnesses[id];
  const turn = bridgeTurn(context);
  const harness = { id, model: model.id === BRIDGE_DEFAULT_MODEL ? "" : model.id, settings };
  const run: Run = {
    harness: id,
    model: model.id,
    tools: turn.tools,
    reply: undefined,
    queue: [],
    waiting: new Map(),
    batch: undefined,
    collected: collector(),
    reported: { input: 0, output: 0, cost: 0 },
    done: false,
    abort: new AbortController(),
  };
  runs.set(key, run);
  attach(run, reply, options?.signal);
  let messageBreak = false;
  run.collected.onDelta = (kind, text) => emit(run, (current) => {
    // Claude Code and Codex send whole messages: keep two of them apart.
    if (messageBreak && kind === "text") current.break();
    messageBreak = HARNESSES[id].protocol !== "acp";
    current.delta(kind, text);
  });
  const label = HARNESSES[id].label;
  void (async () => {
    let dir: string | undefined;
    const bridge = await openBridge({ tools: () => run.tools, onCall: (call) => onCall(run, call) }).catch((error: Error) => {
      const current = run.reply;
      stopRun(run);
      current?.fail("error", `${label}: could not open the tool bridge: ${error.message}`);
      return undefined;
    });
    if (!bridge) return;
    try {
      const plan = { ...planHarnessRun({ systemPrompt: turn.systemPrompt, thinking: options?.reasoning ?? "off", harness, bridged: true }), mcp: bridge.mcp };
      const promptFile = () => {
        dir ??= mkdtempSync(join(tmpdir(), "bot-lobby-bridge-"));
        const file = join(dir, "instructions.md");
        writeFileSync(file, plan.instructions, { encoding: "utf8", mode: 0o600 });
        return file;
      };
      const start = harnessLaunch(plan, { cwd: host.cwd(), prompt: turn.prompt, access: BRIDGE_ACCESS }, promptFile);
      const outcome = await start(run.collected, { signal: run.abort.signal });
      if (run.done) return;
      const error = outcome.spawnError ?? run.collected.error ?? (outcome.exitCode !== 0 && !run.collected.text.trim() ? outcome.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400) || `exited with code ${outcome.exitCode}` : undefined);
      // The reply pi is waiting on ends the turn; when pi is between replies, its next request starts a new run.
      const current = run.reply;
      stopRun(run);
      if (error) current?.fail("error", `${label}: ${error}`);
      else current?.finish("stop", usageSince(run));
    } catch (error) {
      const current = run.reply;
      stopRun(run);
      current?.fail("error", `${label}: ${(error as Error).message}`);
    } finally {
      bridge.close();
      if (runs.get(key) === run) runs.delete(key);
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  })();
}

/** pi's request for the next reply from a harness. */
export function bridgeStream(host: BridgeHost, id: HarnessId, model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const reply = new Reply(model);
  const key = options?.sessionId ?? "pi";
  const live = runs.get(key);
  const { results, added } = tail(context);
  const continues = live && !live.done && live.harness === id && live.model === model.id && results.length > 0 && results.every((result) => live.waiting.has(result.toolCallId));
  if (live && continues) {
    live.tools = bridgeTools(context);
    attach(live, reply, options?.signal);
    // Anything the user said meanwhile rides on the last result, since not every harness takes a message mid-turn.
    const note = added.length > 0 ? `\n\n[The user added while you worked: ${added.join("\n\n")}]` : "";
    results.forEach((result, index) => {
      const answer = bridgeResult(result);
      if (note && index === results.length - 1) answer.content.push({ type: "text", text: note.trim() });
      live.waiting.get(result.toolCallId)?.respond(answer);
      live.waiting.delete(result.toolCallId);
    });
    return reply.stream;
  }
  if (live) {
    stopRun(live);
    runs.delete(key);
  }
  startRun(host, id, model, context, options, reply, key);
  return reply.stream;
}

/** Register a pi provider for every harness, with its models from the catalog. */
export function registerHarnessProviders(pi: ExtensionAPI, host: BridgeHost): void {
  const config = host.config();
  for (const id of HARNESS_IDS) {
    const info = HARNESSES[id];
    const models = [{ id: BRIDGE_DEFAULT_MODEL, label: `${info.label} default` }, ...harnessModels(id, config.harnesses[id])];
    pi.registerProvider(BRIDGE_PROVIDERS[id], {
      name: info.label,
      baseUrl: "http://localhost",
      apiKey: "bot-lobby-harness",
      api: `bot-lobby-${id}` as Api,
      models: models.map((model) => ({ id: model.id, name: model.label, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: CONTEXT_WINDOW, maxTokens: MAX_TOKENS })),
      streamSimple: (model, context, options) => bridgeStream(host, id, model, context, options),
    });
  }
}
