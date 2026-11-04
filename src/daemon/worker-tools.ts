/**
 * Bot Lobby's tools for one worker, as a stdio MCP server the worker's
 * coding agent starts. It runs with the worker's environment (task id, file
 * desk and board addresses, delegation, the role's tool list), exactly as
 * Bot Lobby's extension once ran inside each pi worker, and registers the
 * same worker tools: the file desk, the task board, find_relevant_files, the
 * knowledge catalogue, delegate, and ask_user_question (relayed to the
 * daemon, which puts the questions to the person).
 *
 * What it cannot do any more: refuse the harness's own Edit or Bash calls
 * (pi's tool_call guards). The desk's claim rule and an assignment's
 * allowlist are now instructions plus the harness's tool list (gaps.md H5).
 */
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { Content, HostAPI, HostContext, HostEvents, ToolDefinition } from "../host/api.ts";
import { SessionFile } from "../host/session-store.ts";
import { registerDeskClient } from "../desk/client-extension.ts";
import { registerBoardClient } from "../desk/board-client.ts";
import { registerClassifierTools } from "../classifier/tools.ts";
import { registerKnowledgeTools } from "../knowledge/catalog-tools.ts";
import { registerAskTool } from "../ask/tool.ts";
import { registerDelegation } from "../pi/delegation.ts";
import { registerClassifier } from "../classifier/instance.ts";
import { CONFIG_DIR_NAME } from "../host/api.ts";
import { mcpSchema } from "./host.ts";
import { RELAY_ENV, TOOLS_ENV } from "../harness/worker-mcp.ts";


type Listener = (event: unknown, ctx: HostContext) => unknown;

/** Ask the daemon over its MCP socket: one `tools/call` of `relay_ask`. */
function relay(title: string, prefill: string): Promise<string | undefined> {
  const target = process.env[RELAY_ENV];
  if (!target) return Promise.resolve(undefined);
  const [path, token] = target.split(" ");
  return new Promise((resolve) => {
    const socket = connect(path!);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ bridge: token })}\n`);
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "relay_ask", arguments: { title, prefill } } })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const line = buffer.split("\n").find((entry) => entry.includes('"id":1'));
      if (!line) return;
      socket.end();
      try {
        const reply = JSON.parse(line) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } };
        resolve(reply.result?.isError ? undefined : reply.result?.content?.[0]?.text);
      } catch {
        resolve(undefined);
      }
    });
    socket.on("error", () => resolve(undefined));
  });
}

class WorkerToolHost implements HostAPI {
  readonly tools = new Map<string, ToolDefinition>();
  private readonly listeners = new Map<string, Listener[]>();
  readonly ctx: HostContext;

  constructor(cwd: string) {
    const session = SessionFile.create(cwd, cwd);
    this.ctx = {
      cwd,
      hasUI: false,
      mode: "worker",
      sessionManager: session,
      isIdle: () => true,
      abort: () => {},
      ui: {
        notify: (message) => process.stderr.write(`bot-lobby worker: ${message}\n`),
        setStatus: () => {},
        select: async () => undefined,
        confirm: async () => false,
        editor: (title, prefill) => relay(title, prefill ?? ""),
        getEditorText: () => "",
        setEditorText: () => {},
        getToolsExpanded: () => false,
        setToolsExpanded: () => {},
      },
    };
  }

  on<K extends keyof HostEvents>(event: K, handler: (event: HostEvents[K], ctx: HostContext) => unknown): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler as Listener);
    this.listeners.set(event, list);
    return () => {};
  }

  async emit(event: keyof HostEvents, payload: unknown): Promise<void> {
    for (const listener of this.listeners.get(event) ?? []) await listener(payload, this.ctx);
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerCommand(): void {}
  registerShortcut(): void {}
  sendUserMessage(): void {}
  sendMessage(): void {}
  appendEntry(): void {}
  setSessionName(): void {}
  getSessionName(): string | undefined {
    return undefined;
  }
  getActiveTools(): string[] {
    return [...this.tools.keys()];
  }
  setActiveTools(): void {}
  getAllTools() {
    return [...this.tools.values()].map((tool) => ({ name: tool.name, description: tool.description }));
  }
  getCommands() {
    return [];
  }
  async setModel(): Promise<boolean> {
    return false;
  }
  getThinkingLevel() {
    return "medium" as const;
  }
  setThinkingLevel(): void {}
}

function allowedTools(): Set<string> | undefined {
  const raw = process.env[TOOLS_ENV];
  if (!raw) return undefined;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? new Set(list.filter((entry): entry is string => typeof entry === "string")) : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  process.env.BOT_LOBBY_SUBAGENT = "1";
  const host = new WorkerToolHost(process.cwd());
  registerClassifier(host, CONFIG_DIR_NAME);
  registerDelegation(host);
  registerDeskClient(host);
  registerBoardClient(host);
  registerClassifierTools(host);
  registerKnowledgeTools(host, CONFIG_DIR_NAME);
  registerAskTool(host, undefined, CONFIG_DIR_NAME);
  await host.emit("session_start", { reason: "startup" });
  const allowed = allowedTools();
  const tools = [...host.tools.values()].filter((tool) => !allowed || allowed.has(tool.name));

  const send = (message: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    let message: { id?: number | string; method?: string; params?: Record<string, unknown> };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (message.id === undefined || !message.method) return;
    const id = message.id;
    if (message.method === "initialize") return send({ id, result: { protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "bot-lobby", version: "1" } } });
    if (message.method === "ping") return send({ id, result: {} });
    if (message.method === "tools/list") {
      return send({ id, result: { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: mcpSchema(JSON.parse(JSON.stringify(tool.parameters))) })) } });
    }
    if (message.method === "tools/call") {
      const name = String(message.params?.name ?? "");
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) return send({ id, result: { content: [{ type: "text", text: `No tool ${name} for this agent.` }], isError: true } });
      void (async () => {
        try {
          const result = await tool.execute(`bl_${randomUUID()}`, args, undefined, undefined, host.ctx);
          const content: Content[] = result.content.length ? result.content : [{ type: "text", text: "(no output)" }];
          send({ id, result: { content, isError: result.isError === true } });
        } catch (error) {
          send({ id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } });
        }
      })();
      return;
    }
    send({ id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  });
  input.on("close", () => {
    void host.emit("session_shutdown", {}).finally(() => process.exit(0));
  });
}

void main();
