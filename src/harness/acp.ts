/**
 * Agent Client Protocol (JSON-RPC 2.0 over stdio) for Antigravity, Gemini
 * CLI, OpenCode and any other ACP agent: initialize, open a session in the
 * working folder, pick the model and effort through the session's options,
 * send the task with Bot Lobby's instructions in front, and map the
 * `session/update` notifications onto pi's stream events. The client offers
 * no file system or terminal of its own, so the agent uses its own tools,
 * and its permission requests are answered from the role's allowlist.
 *
 * Adapted from T3 Code: the prompt wrapping from
 * `packages/provider-core/src/server/orchestrationInstructions.ts`, the
 * permission answers from `apps/server/src/provider/acp/AntigravityProtocol.ts`
 * (`selectAntigravityPermissionOptionId`, `isAntigravityUserInputRequest`) and
 * the session option categories from `packages/provider-acp/src/server/sessionConfig.ts`.
 */
import { THINKING_LEVELS } from "../schemas/configuration.ts";
import type { HarnessDriver, HarnessIO } from "./process.ts";
import type { HarnessAccess, HarnessCollector, HarnessPlan } from "./runner.ts";

export const ACP_PROTOCOL_VERSION = 1;

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: { code?: number; message?: string };
}

interface PermissionOption {
  optionId: string;
  kind?: string;
  name?: string;
}

interface ConfigOption {
  id: string;
  category?: string;
  type?: string;
  options?: Array<{ value?: string; name?: string; options?: Array<{ value?: string; name?: string }> }>;
}

/** pi's tool names for ACP tool kinds, for the activity line and the edit log. */
const KIND_TOOLS: Record<string, string> = {
  read: "read",
  edit: "edit",
  delete: "write",
  move: "write",
  search: "grep",
  execute: "bash",
  fetch: "fetch_content",
  think: "think",
};

/** Whether a role may run a tool of this ACP kind. */
export function acpKindAllowed(kind: string | undefined, access: HarnessAccess): boolean {
  if (access.writes) return true;
  switch (kind) {
    case "read":
    case "search":
    case "think":
      return true;
    case "fetch":
      return access.web;
    case "execute":
      return access.shell;
    default:
      return false;
  }
}

/** The option to pick for a permission request, or undefined to cancel it (a question for the user, which nobody can answer here). */
export function acpPermissionOption(request: { toolCall?: { toolCallId?: string; kind?: string }; options?: PermissionOption[] }, access: HarnessAccess): string | undefined {
  if (request.toolCall?.toolCallId?.startsWith("interaction_")) return undefined;
  const allow = acpKindAllowed(request.toolCall?.kind, access);
  const kinds = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of kinds) {
    const option = request.options?.find((entry) => entry.kind === kind && entry.optionId.trim());
    if (option) return option.optionId;
  }
  return undefined;
}

function choices(option: ConfigOption): Array<{ value: string; name: string }> {
  return (option.options ?? []).flatMap((entry) => ("options" in entry && Array.isArray(entry.options) ? entry.options : [entry]))
    .filter((entry): entry is { value: string; name: string } => typeof entry.value === "string")
    .map((entry) => ({ value: entry.value, name: entry.name ?? entry.value }));
}

/** The choice whose id or name is the effort level, or the nearest one below it. */
export function acpEffortChoice(option: ConfigOption, level: string): string | undefined {
  const list = choices(option);
  const at = THINKING_LEVELS.indexOf(level as (typeof THINKING_LEVELS)[number]);
  for (let index = at; index >= 0; index--) {
    const name = THINKING_LEVELS[index]!;
    const hit = list.find((choice) => choice.value.toLowerCase() === name || choice.name.toLowerCase() === name);
    if (hit) return hit.value;
  }
  return undefined;
}

function blockText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as { type?: string; text?: string };
  return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

function toolArgs(update: Record<string, unknown>): Record<string, unknown> {
  const raw = (update.rawInput && typeof update.rawInput === "object" ? update.rawInput : {}) as Record<string, unknown>;
  const locations = Array.isArray(update.locations) ? update.locations as Array<{ path?: string }> : [];
  const path = locations.find((entry) => typeof entry.path === "string")?.path ?? raw.path ?? raw.file_path ?? raw.filePath;
  return { ...raw, ...(typeof path === "string" ? { path } : {}), ...(typeof update.title === "string" ? { title: update.title } : {}) };
}

export function acpDriver(io: HarnessIO, plan: HarnessPlan, prompt: string, collector: HarnessCollector, access: HarnessAccess, cwd: string): HarnessDriver {
  let nextId = 1;
  const pending = new Map<number, (message: RpcMessage) => void>();
  const tools = new Map<string, string>();
  const steers: string[] = [];
  let sessionId: string | undefined;
  let message = "";
  let thought = "";
  let prompting = false;
  let finished = false;

  const request = (method: string, params: Record<string, unknown>, then: (message: RpcMessage) => void) => {
    const id = nextId++;
    pending.set(id, then);
    io.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  };
  const notify = (method: string, params: Record<string, unknown>) => io.write(JSON.stringify({ jsonrpc: "2.0", method, params }));
  const respond = (id: number | string, result: unknown) => io.write(JSON.stringify({ jsonrpc: "2.0", id, result }));
  const fail = (text: string) => {
    if (finished) return;
    finished = true;
    collector.error = text;
    io.done();
  };
  const flushThought = () => {
    if (thought.trim()) io.emit({ type: "thought", text: thought.trim().slice(0, 1500) });
    thought = "";
  };
  const send = (text: string) => {
    prompting = true;
    message = "";
    io.emit({ type: "turn_start" });
    request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }, (reply) => {
      prompting = false;
      flushThought();
      if (message.trim()) collector.text = message;
      if (reply.error) return fail(reply.error.message ?? "the agent refused the prompt");
      const usage = reply.result?.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      if (usage) {
        collector.addUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0, 0, plan.model || undefined);
        io.emit({ type: "usage", input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, cost: 0, ...(plan.model ? { model: plan.model } : {}) });
      }
      const stop = String(reply.result?.stopReason ?? "end_turn");
      if (stop === "cancelled") collector.stopReason = "aborted";
      else if (stop === "refusal") collector.error = "the agent refused the task";
      // A steering message sent mid-turn goes in as the next prompt.
      if (stop !== "cancelled" && steers.length > 0) return send(steers.splice(0).join("\n\n"));
      finished = true;
      io.done();
    });
  };
  const configure = (result: Record<string, unknown>, then: () => void) => {
    const steps: Array<(next: () => void) => void> = [];
    const options = Array.isArray(result.configOptions) ? result.configOptions as ConfigOption[] : [];
    const modelOption = options.find((option) => option.category === "model");
    const effortOption = options.find((option) => option.category === "thought_level");
    if (plan.model && modelOption) steps.push((next) => request("session/set_config_option", { sessionId, configId: modelOption.id, value: plan.model }, next));
    else if (plan.model && result.models) steps.push((next) => request("session/set_model", { sessionId, modelId: plan.model }, next));
    const effort = effortOption ? acpEffortChoice(effortOption, plan.level) : undefined;
    if (effortOption && effort) steps.push((next) => request("session/set_config_option", { sessionId, configId: effortOption.id, value: effort }, next));
    const run = () => {
      const step = steps.shift();
      if (step) step(() => run());
      else then();
    };
    run();
  };
  const onUpdate = (update: Record<string, unknown>) => {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = blockText(update.content);
        if (!text) return;
        flushThought();
        if (!message) io.emit({ type: "writing" });
        message += text;
        return;
      }
      case "agent_thought_chunk": {
        const text = blockText(update.content);
        if (!text) return;
        if (!thought) io.emit({ type: "thinking" });
        thought += text;
        return;
      }
      case "tool_call": {
        flushThought();
        if (message.trim()) collector.text = message;
        message = "";
        const id = String(update.toolCallId ?? "");
        const name = KIND_TOOLS[String(update.kind ?? "")] ?? "tool";
        if (id && !tools.has(id)) {
          tools.set(id, name);
          io.emit({ type: "tool_execution_start", toolName: name, args: toolArgs(update) });
        }
        if (update.status === "completed" || update.status === "failed") onUpdate({ ...update, sessionUpdate: "tool_call_update" });
        return;
      }
      case "tool_call_update": {
        const id = String(update.toolCallId ?? "");
        const name = tools.get(id);
        if (!name || (update.status !== "completed" && update.status !== "failed")) return;
        tools.delete(id);
        io.emit({ type: "tool_execution_end", toolName: name, isError: update.status === "failed" });
        return;
      }
      case "usage_update": {
        const cost = (update.cost as { amount?: number } | undefined)?.amount;
        if (typeof cost === "number" && cost > collector.usage.cost) collector.usage.cost = cost;
        return;
      }
    }
  };
  const onRequest = (message: RpcMessage) => {
    if (message.id === undefined) return;
    if (message.method === "session/request_permission") {
      const optionId = acpPermissionOption((message.params ?? {}) as Parameters<typeof acpPermissionOption>[0], access);
      respond(message.id, { outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } });
      return;
    }
    // No file system or terminal was offered; anything else is unknown.
    io.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }));
  };
  return {
    start() {
      request("initialize", { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "bot-lobby", version: "1" } }, (reply) => {
        if (reply.error) return fail(`the agent did not start: ${reply.error.message ?? "initialize failed"}`);
        request("session/new", { cwd, mcpServers: [] }, (created) => {
          if (created.error || typeof created.result?.sessionId !== "string") return fail(`the agent did not open a session: ${created.error?.message ?? "no session id"}${/auth|key|sign|log ?in/i.test(created.error?.message ?? "") ? " (sign in to it once in a terminal)" : ""}`);
          sessionId = created.result.sessionId;
          collector.session = sessionId;
          configure(created.result, () => send(prompt));
        });
      });
    },
    steer(text) {
      if (prompting) steers.push(text);
    },
    abort() {
      if (sessionId) notify("session/cancel", { sessionId });
    },
    line(text) {
      let message: RpcMessage;
      try {
        message = JSON.parse(text) as RpcMessage;
      } catch {
        return;
      }
      if (message.method === "session/update") return onUpdate((message.params?.update ?? {}) as Record<string, unknown>);
      if (message.method) return onRequest(message);
      if (typeof message.id === "number") {
        const then = pending.get(message.id);
        pending.delete(message.id);
        then?.(message);
      }
    },
  };
}
