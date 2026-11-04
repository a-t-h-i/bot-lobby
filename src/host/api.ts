/**
 * What Bot Lobby's engine asks of the program that hosts it. It used to be
 * pi's extension API; bot-herdr runs the engine in its own daemon
 * (`bot-lobby serve`) and drives the Orchestrator on an installed coding-agent
 * harness instead. The shapes stay close to what the engine already used
 * (events, tools, a session's entries), so the engine's logic did not change:
 * only where these types come from did.
 */
import type { TSchema } from "typebox";

/** Bot Lobby's own folder name, in the home folder and in each project. */
export const CONFIG_DIR_NAME = ".bot-lobby";

export type NoticeLevel = "info" | "warning" | "error";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface TextContent { type: "text"; text: string }
export interface ImageContent { type: "image"; data: string; mimeType: string }
export type Content = TextContent | ImageContent;

/** A tool's answer: what the model reads, plus details only the engine reads. */
export interface ToolResult<TDetails = unknown> {
  content: Content[];
  details?: TDetails;
  isError?: boolean;
}

export type ToolUpdate = (partial: ToolResult) => void;

/** A tool the Orchestrator (or a worker) can call; served to harnesses over MCP. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = any> {
  name: string;
  label?: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: ToolUpdate | undefined, ctx: HostContext): Promise<ToolResult<TDetails>>;
  /** MCP-style hints (read-only, open-world); passed on where a harness reads them. */
  annotations?: Record<string, unknown>;
  /** Who may see the tool: "subagent" tools are only offered to workers. */
  exposure?: string;
  /** "sequential" runs one call at a time. */
  executionMode?: string;
}

export interface ToolInfo { name: string; description: string; parameters?: unknown; annotations?: Record<string, unknown>; exposure?: string; sourceInfo?: { source?: string; path?: string } }

/** A session's entry, in pi's JSONL session format (kept so old sessions still read). */
export interface SessionEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: { role?: string; content?: unknown; stopReason?: string; errorMessage?: string; [key: string]: unknown };
  customType?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface SessionManager {
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getSessionDir(): string;
  getBranch(): SessionEntry[];
  getLeafId?(): string | undefined;
  buildContextEntries?(): SessionEntry[];
}

/** What the host can show the person: in bot-herdr, the Lobby's notices. */
export interface HostUI {
  notify(message: string, level?: NoticeLevel): void;
  setStatus(key: string, text: string | undefined): void;
  /** Asks in the Lobby's questionnaire; undefined when nobody can answer. */
  select(title: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  getEditorText(): string;
  setEditorText(text: string): void;
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

/** The model the Orchestrator runs on, as far as the engine needs to know it. */
export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

/** One model call with no tools (classifier questions, titles, digests), answered by a harness. */
export interface CompleteRequest {
  system?: string;
  prompt: string;
  /** A harness model id, or `<harness>/<model>`; absent uses the one-shot default. */
  model?: string;
  effort?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CompleteReply {
  text: string;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export type Complete = (request: CompleteRequest) => Promise<CompleteReply>;

export interface HostContext {
  cwd: string;
  hasUI: boolean;
  mode?: string;
  ui: HostUI;
  sessionManager: SessionManager;
  model?: ModelInfo;
  signal?: AbortSignal;
  isIdle(): boolean;
  abort(): void;
  /** Start a fresh Orchestrator session (the Lobby's "new session"). */
  newSession?(): Promise<{ cancelled: boolean }>;
  /** Carry on a saved session in this daemon. */
  switchSession?(file: string): Promise<{ cancelled: boolean }>;
  getContextUsage?(): { tokens: number; contextWindow?: number } | undefined;
  getSystemPrompt?(): string;
  /** A one-shot model call through an installed harness; absent when none is installed. */
  complete?: Complete;
}

export interface HostCommandContext extends HostContext {
  args?: string;
}

export interface RegisteredCommand {
  description?: string;
  getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null;
  handler(args: string | undefined, ctx: HostCommandContext): Promise<void> | void;
}

export interface SlashCommandInfo { name: string; description?: string; source?: string; sourceInfo?: { source?: string; path?: string } }

/** The events the engine listens to. Payloads keep pi's field names. */
export interface HostEvents {
  session_start: { reason?: "startup" | "new" | "resume" | "switch" | "fork" | "reload" };
  session_shutdown: Record<string, never>;
  before_agent_start: { prompt: string; messageType?: string; systemPromptOptions: { sections: Record<string, string | undefined> } };
  agent_start: Record<string, never>;
  agent_end: { messages: unknown[] };
  agent_settled: Record<string, never>;
  turn_end: { message?: SessionEntry["message"]; toolResults?: unknown[] };
  message_update: { type: "message_update"; message?: SessionEntry["message"]; assistantMessageEvent: { type: string; delta?: string; content?: string } };
  message_end: { type: "message_end"; message: NonNullable<SessionEntry["message"]> };
  tool_call: { toolName: string; toolCallId: string; input: Record<string, unknown>; parentToolCallId?: string };
  tool_result: { toolName: string; toolCallId: string; input: Record<string, unknown>; content: Content[]; isError: boolean; details?: unknown; parentToolCallId?: string };
  tool_execution_start: { type: "tool_execution_start"; toolName: string; toolCallId: string; args: unknown };
  tool_execution_end: { type: "tool_execution_end"; toolName: string; toolCallId: string; result?: unknown; isError: boolean };
  ui_prompt_start: { id: string };
  ui_prompt_end: { id: string };
  before_provider_request: { payload: unknown };
  session_before_compact: Record<string, unknown>;
}

/** A listener's answer: `tool_call` may block, `tool_result` may replace the result. */
export type HostEventResult =
  | void
  | undefined
  | { block?: boolean; reason?: string }
  | { content?: Content[]; isError?: boolean; details?: unknown }
  | { cancel?: boolean }
  | Record<string, unknown>;

export type HostHandler<K extends keyof HostEvents> = (event: HostEvents[K], ctx: HostContext) => HostEventResult | Promise<HostEventResult>;

export interface HostAPI {
  on<K extends keyof HostEvents>(event: K, handler: HostHandler<K>): () => void;
  registerTool<TParams extends TSchema = TSchema>(tool: ToolDefinition<TParams>): void;
  registerCommand(name: string, command: RegisteredCommand): void;
  /** Keyboard shortcuts were pi's TUI; the daemon has none, so this is a no-op kept for callers. */
  registerShortcut(key: string, options: { description?: string; handler: (ctx: HostContext) => Promise<void> | void }): void;
  sendUserMessage(content: string | Content[], options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean }): void;
  sendMessage(message: { customType: string; content: string | Content[]; display?: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
  appendEntry(customType: string, data?: unknown): void;
  setSessionName(name: string): void;
  getSessionName(): string | undefined;
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
  getAllTools(): ToolInfo[];
  getCommands(): SlashCommandInfo[];
  setModel(model: ModelInfo): Promise<boolean>;
  getThinkingLevel(): ThinkingLevel;
  setThinkingLevel(level: ThinkingLevel): void;
}
export type ToolCallEvent = HostEvents["tool_call"];
