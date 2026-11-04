/**
 * The daemon's Host: what pi used to be for the engine. It keeps the
 * listeners, tools and commands the engine registers, the current Lobby
 * session (a JSONL file), and drives the Orchestrator's turns on a harness
 * (see `orchestrator.ts`): each turn fires the same events pi fired
 * (`before_agent_start`, `agent_start`, `message_update`, `tool_execution_*`,
 * `message_end`, `agent_end`), so the Lobby feed, the work clock, auto mode and
 * the metrics follow along unchanged. Tools reach the harness over MCP.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  Complete,
  Content,
  HostAPI,
  HostContext,
  HostEventResult,
  HostEvents,
  HostHandler,
  HostUI,
  ModelInfo,
  RegisteredCommand,
  SlashCommandInfo,
  ThinkingLevel,
  ToolDefinition,
  ToolInfo,
} from "../host/api.ts";
import { SessionFile } from "../host/session-store.ts";
import { findSkills } from "../host/skills.ts";
import { promptHub } from "../lobby/prompt-hub.ts";
import { pushNotice } from "../webui/notices.ts";
import { localToolName, type McpResult, type McpTool } from "./mcp/host.ts";
import { log } from "./log.ts";

/** One Orchestrator turn as the harness driver sees it. */
export interface TurnSink {
  /** Streamed reply text. */
  text(delta: string): void;
  thinking(delta: string): void;
  thinkingEnd(): void;
  /** One assistant message finished (text blocks), with its usage. */
  assistant(text: string, usage?: { input: number; output: number; cost: number }, error?: string): void;
  toolStart(id: string, name: string, args: unknown): void;
  toolEnd(id: string, name: string, isError: boolean): void;
  /** The harness session the turn ran in (to resume next time). */
  session(id: string, model?: string): void;
}

/** A harness that can host the Orchestrator. */
export interface OrchestratorDriver {
  readonly harness: string;
  /** Run one turn; `steer` lets more user messages in while it runs, when the harness can take them (else it returns false). */
  turn(input: {
    prompt: Content[];
    system: string;
    resume?: string;
    tools: McpTool[];
    callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpResult>;
    sink: TurnSink;
    signal: AbortSignal;
  }): { done: Promise<void>; steer(prompt: Content[]): boolean };
  complete: Complete;
}

interface Queued {
  content: Content[];
  steer: boolean;
}

type Listener = (event: unknown, ctx: HostContext) => HostEventResult | Promise<HostEventResult>;

/**
 * A tool's TypeBox schema as JSON Schema 2020-12, which MCP clients check:
 * draft-07 tuples (`items: [...]` with `additionalItems`) become
 * `prefixItems`. Claude Code silently drops a tool whose schema fails.
 */
export function mcpSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(mcpSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "items" && Array.isArray(value)) {
      out.prefixItems = value.map(mcpSchema);
      if ((schema as Record<string, unknown>).additionalItems === false) out.items = false;
    } else if (key === "additionalItems") continue;
    else out[key] = key === "properties" && value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, mcpSchema(child)])) : mcpSchema(value);
  }
  return out;
}

function textOf(content: Content[]): string {
  return content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function asContent(content: string | Content[]): Content[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

export interface DaemonHostOptions {
  cwd: string;
  /** Where Lobby session files live: `<project>/.bot-lobby/sessions/chats`. */
  sessionDir: string;
  driver: () => OrchestratorDriver | undefined;
}

export class DaemonHost implements HostAPI {
  private readonly listeners = new Map<string, Listener[]>();
  private readonly tools = new Map<string, ToolDefinition>();
  private active: Set<string> | undefined;
  private readonly commands = new Map<string, RegisteredCommand>();
  private thinking: ThinkingLevel = "high";
  private model: ModelInfo | undefined;
  private session: SessionFile;
  private readonly queue: Queued[] = [];
  private running: { controller: AbortController; steer(prompt: Content[]): boolean } | undefined;
  private editorText = "";
  private toolsExpanded = false;
  readonly ctx: HostContext;
  private readonly options: DaemonHostOptions;

  constructor(options: DaemonHostOptions) {
    this.options = options;
    this.session = SessionFile.create(options.sessionDir, options.cwd);
    const ui: HostUI = {
      notify: (message, level = "info") => {
        log(`${level}: ${message}`);
        pushNotice(message, level);
      },
      setStatus: () => {},
      select: async (title, choices) => {
        const outcome = await promptHub.ask("choose", "orchestrate", { title, options: choices });
        return outcome.how === "answered" && typeof outcome.value === "string" ? outcome.value : undefined;
      },
      confirm: async (title, message) => {
        const outcome = await promptHub.ask("choose", "orchestrate", { title: `${title} ${message}`.trim(), options: ["Yes", "No"] });
        return outcome.how === "answered" && outcome.value === "Yes";
      },
      editor: async (title) => {
        const outcome = await promptHub.ask("text", "orchestrate", { question: title });
        return outcome.how === "answered" && typeof outcome.value === "string" ? outcome.value : undefined;
      },
      getEditorText: () => this.editorText,
      setEditorText: (text) => {
        this.editorText = text;
      },
      getToolsExpanded: () => this.toolsExpanded,
      setToolsExpanded: (expanded) => {
        this.toolsExpanded = expanded;
      },
    };
    const host = this;
    this.ctx = {
      cwd: options.cwd,
      hasUI: true,
      mode: "daemon",
      ui,
      get sessionManager() {
        return host.session;
      },
      get model() {
        return host.model;
      },
      isIdle: () => !this.running,
      abort: () => this.abort(),
      newSession: async () => {
        await this.replaceSession(SessionFile.create(this.options.sessionDir, this.options.cwd), "new");
        return { cancelled: false };
      },
      switchSession: async (file) => {
        await this.replaceSession(SessionFile.open(file, this.options.cwd), "switch");
        return { cancelled: false };
      },
      complete: (request) => {
        const driver = this.options.driver();
        if (!driver) return Promise.reject(new Error("no coding agent is installed"));
        return driver.complete(request);
      },
    };
  }

  /* ----------------------------------------------------------- events */

  on<K extends keyof HostEvents>(event: K, handler: HostHandler<K>): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler as Listener);
    this.listeners.set(event, list);
    return () => {
      const at = list.indexOf(handler as Listener);
      if (at >= 0) list.splice(at, 1);
    };
  }

  /** Run every listener in order; the answers come back for the events that take one. */
  async emit<K extends keyof HostEvents>(event: K, payload: HostEvents[K]): Promise<HostEventResult[]> {
    const out: HostEventResult[] = [];
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        out.push(await listener(payload, this.ctx));
      } catch (error) {
        // A listener that throws must not break the turn; tool_call blocks are answers, not throws.
        if (event === "tool_call") throw error;
        log(`a ${event} listener failed: ${(error as Error).message}`);
      }
    }
    return out;
  }

  /** Start: what pi's session_start was. */
  async start(reason: HostEvents["session_start"]["reason"] = "startup"): Promise<void> {
    await this.emit("session_start", { reason });
  }

  async shutdown(): Promise<void> {
    this.abort();
    await this.emit("session_shutdown", {} as HostEvents["session_shutdown"]);
  }

  private async replaceSession(next: SessionFile, reason: "new" | "switch"): Promise<void> {
    this.abort();
    this.queue.length = 0;
    await this.emit("session_shutdown", {} as HostEvents["session_shutdown"]);
    this.session = next;
    await this.emit("session_start", { reason });
  }

  /* ------------------------------------------------------------ tools */

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  getAllTools(): ToolInfo[] {
    return [...this.tools.values()].map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters, ...(tool.annotations ? { annotations: tool.annotations } : {}), ...(tool.exposure ? { exposure: tool.exposure } : {}) }));
  }

  getActiveTools(): string[] {
    return [...this.tools.keys()].filter((name) => !this.active || this.active.has(name));
  }

  setActiveTools(names: string[]): void {
    this.active = new Set(names);
  }

  /** The tools the Orchestrator's harness is offered over MCP this turn. */
  mcpTools(): McpTool[] {
    return this.getActiveTools().flatMap((name) => {
      const tool = this.tools.get(name);
      if (!tool || tool.exposure === "subagent" || tool.exposure === "hidden") return [];
      const guidelines = tool.promptGuidelines?.length ? `\n\n${tool.promptGuidelines.map((line) => `- ${line}`).join("\n")}` : "";
      return [{ name, description: `${tool.description}${guidelines}`, inputSchema: mcpSchema(JSON.parse(JSON.stringify(tool.parameters))) as Record<string, unknown> }];
    });
  }

  /** One MCP tool call from the Orchestrator: the engine's tool_call guards, the tool, then tool_result. */
  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpResult> {
    const local = localToolName(name);
    const tool = this.tools.get(local);
    if (!tool || !this.getActiveTools().includes(local)) return { content: [{ type: "text", text: `Tool ${local} is not available now.` }], isError: true };
    const toolCallId = `bl_${randomUUID()}`;
    for (const answer of await this.emit("tool_call", { toolName: local, toolCallId, input: args })) {
      const block = answer as { block?: boolean; reason?: string } | undefined;
      if (block?.block) return { content: [{ type: "text", text: block.reason ?? `${local} was blocked.` }], isError: true };
    }
    let result: { content: Content[]; isError: boolean; details?: unknown };
    try {
      const out = await tool.execute(toolCallId, args, signal, undefined, this.ctx);
      result = { content: out.content, isError: out.isError === true, details: out.details };
    } catch (error) {
      result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
    for (const answer of await this.emit("tool_result", { toolName: local, toolCallId, input: args, ...result })) {
      const patch = answer as { content?: Content[]; isError?: boolean } | undefined;
      if (patch?.content) result.content = patch.content;
      if (typeof patch?.isError === "boolean") result.isError = patch.isError;
    }
    return { content: result.content.length ? result.content : [{ type: "text", text: "(no output)" }], isError: result.isError };
  }

  /* --------------------------------------------------------- commands */

  registerCommand(name: string, command: RegisteredCommand): void {
    this.commands.set(name, command);
  }

  registerShortcut(): void {
    // Keyboard shortcuts were pi's terminal; the Lobby in herdr has its own keys.
  }

  getCommands(): SlashCommandInfo[] {
    const own = [...this.commands].map(([name, command]) => ({ name, ...(command.description ? { description: command.description } : {}), source: "extension" }));
    const skills = findSkills(this.options.cwd).map((skill) => ({ name: `skill:${skill.name}`, description: skill.description, source: "skill", sourceInfo: { source: "skill", path: skill.filePath } }));
    return [...own, ...skills];
  }

  /** Run a registered `/command` typed in the Lobby; false when there is none by that name. */
  async runCommand(name: string, args: string): Promise<boolean> {
    const command = this.commands.get(name);
    if (!command) return false;
    await command.handler(args, { ...this.ctx, args });
    return true;
  }

  /* ---------------------------------------------------------- session */

  appendEntry(customType: string, data?: unknown): void {
    this.session.appendCustom(customType, data);
  }

  setSessionName(name: string): void {
    this.session.setName(name);
  }

  getSessionName(): string | undefined {
    return this.session.name();
  }

  async setModel(model: ModelInfo): Promise<boolean> {
    this.model = model;
    return true;
  }

  getThinkingLevel(): ThinkingLevel {
    return this.thinking;
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.thinking = level;
  }

  sessionPath(): string {
    return this.session.getSessionFile() ?? join(this.options.sessionDir, `${this.session.id}.jsonl`);
  }

  /* ----------------------------------------------------- orchestrator */

  sendUserMessage(content: string | Content[], options?: { deliverAs?: "steer" | "followUp" }): void {
    this.enqueue({ content: asContent(content), steer: options?.deliverAs === "steer" });
  }

  sendMessage(message: { customType: string; content: string | Content[]; display?: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void {
    this.session.append({ type: "custom_message", customType: message.customType, content: message.content, display: message.display ?? false, details: message.details });
    if (options?.triggerTurn || options?.deliverAs === "steer" || options?.deliverAs === "followUp") this.enqueue({ content: asContent(message.content), steer: options?.deliverAs === "steer" });
  }

  private enqueue(item: Queued): void {
    if (this.running && item.steer && this.running.steer(item.content)) {
      this.recordUser(item.content);
      return;
    }
    this.queue.push(item);
    if (!this.running) void this.drain();
  }

  abort(): void {
    this.running?.controller.abort(new Error("stopped"));
  }

  private recordUser(content: Content[]): void {
    this.session.appendMessage("user", content);
    void this.emit("message_end", { type: "message_end", message: { role: "user", content } });
  }

  private async drain(): Promise<void> {
    while (!this.running && this.queue.length > 0) {
      const next = this.queue.shift()!;
      await this.runTurn(next.content);
    }
  }

  private async runTurn(content: Content[]): Promise<void> {
    const controller = new AbortController();
    this.running = { controller, steer: () => false };
    const messages: unknown[] = [];
    try {
      const driver = this.options.driver();
      const before: HostEvents["before_agent_start"] = { prompt: textOf(content), messageType: "user", systemPromptOptions: { sections: {} } };
      await this.emit("before_agent_start", before);
      const system = Object.values(before.systemPromptOptions.sections).filter((part): part is string => Boolean(part?.trim())).join("\n\n");
      this.recordUser(content);
      messages.push({ role: "user", content });
      await this.emit("agent_start", {} as HostEvents["agent_start"]);
      if (!driver) {
        const error = "No coding agent found. Install Claude Code, Codex, Gemini CLI or OpenCode.";
        this.finishAssistant("", undefined, error, messages);
        return;
      }
      let streamed = false;
      const sink: TurnSink = {
        text: (delta) => {
          streamed = true;
          void this.emit("message_update", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
        },
        thinking: (delta) => void this.emit("message_update", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta } }),
        thinkingEnd: () => void this.emit("message_update", { type: "message_update", assistantMessageEvent: { type: "thinking_end" } }),
        assistant: (text, usage, error) => {
          this.finishAssistant(text, usage, error, messages);
          streamed = false;
        },
        toolStart: (id, name, args) => void this.emit("tool_execution_start", { type: "tool_execution_start", toolName: localToolName(name), toolCallId: id, args }),
        toolEnd: (id, name, isError) => void this.emit("tool_execution_end", { type: "tool_execution_end", toolName: localToolName(name), toolCallId: id, isError }),
        session: (id, model) => {
          this.session.setHarness({ harness: driver.harness, sessionId: id });
          if (model) this.model = { provider: driver.harness, id: model };
        },
      };
      const resume = this.session.harness();
      const run = driver.turn({
        prompt: content,
        system,
        ...(resume && resume.harness === driver.harness ? { resume: resume.sessionId } : {}),
        tools: this.mcpTools(),
        callTool: (name, args, signal) => this.callTool(name, args, signal),
        sink,
        signal: controller.signal,
      });
      this.running.steer = run.steer;
      try {
        await run.done;
      } catch (error) {
        if (!controller.signal.aborted) this.finishAssistant("", undefined, (error as Error).message, messages);
      }
      if (controller.signal.aborted) this.finishAssistant("", undefined, undefined, messages, "aborted");
      else if (streamed) this.finishAssistant("", undefined, undefined, messages);
    } finally {
      this.running = undefined;
      await this.emit("turn_end", {});
      await this.emit("agent_end", { messages });
      await this.emit("agent_settled", {} as HostEvents["agent_settled"]);
    }
  }

  private finishAssistant(text: string, usage: { input: number; output: number; cost: number } | undefined, error: string | undefined, messages: unknown[], stop?: "aborted"): void {
    const stopReason = stop ?? (error ? "error" : "stop");
    const content = text.trim() ? [{ type: "text" as const, text }] : [];
    const message = { role: "assistant", content, stopReason, ...(error ? { errorMessage: error } : {}), ...(usage ? { usage: { input: usage.input, output: usage.output, cost: { total: usage.cost } } } : {}) };
    if (content.length || error) this.session.appendMessage("assistant", content, { stopReason, ...(error ? { errorMessage: error } : {}) });
    messages.push(message);
    void this.emit("message_end", { type: "message_end", message });
  }
}
