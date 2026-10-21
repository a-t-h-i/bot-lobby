/**
 * Claude Code: `claude -p` with stream-json in and out, so a steering message
 * can be sent while the agent works. Bot Lobby's instructions are appended to
 * Claude Code's own system prompt from a file; read-only roles get only the
 * matching tools and `dontAsk`, so anything else is refused.
 *
 * The flag set follows T3 Code's `apps/server/src/textGeneration/ClaudeTextGeneration.ts`
 * (`--tools`, `--allowedTools`, `--permission-mode dontAsk`, `--effort`,
 * `--settings`) and the auto-compact window of
 * `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`.
 */
import type { HarnessDriver, HarnessIO } from "./process.ts";
import type { HarnessAccess, HarnessCollector, HarnessPlan } from "./runner.ts";

/** A day: a bridged tool call ends when pi's tool does, not on a clock. */
const BRIDGE_TOOL_TIMEOUT_MS = 86_400_000;

/** pi's tool names and Claude Code's for the same job. */
const CLAUDE_TOOLS: Record<string, string> = {
  read: "Read",
  grep: "Grep",
  find: "Glob",
  ls: "Glob",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  web_search: "WebSearch",
  fetch_content: "WebFetch",
};

/** Claude Code's tool names as pi's, for the activity line and the edit log. */
const PI_NAMES: Record<string, string> = {
  Read: "read",
  Grep: "grep",
  Glob: "find",
  LS: "ls",
  Bash: "bash",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "write",
  NotebookEdit: "edit",
  WebSearch: "web_search",
  WebFetch: "fetch_content",
};

/** The Claude Code tools a read-only role may use, from its pi allowlist. */
export function claudeTools(tools: readonly string[]): string[] {
  return [...new Set(tools.map((tool) => CLAUDE_TOOLS[tool]).filter((tool): tool is string => Boolean(tool)))];
}

export function claudeArgs(plan: HarnessPlan, access: HarnessAccess, launchArgs: string[], promptFile: string | undefined): { args: string[]; env: Record<string, string> } {
  const { settings } = plan.harness;
  const args = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--no-session-persistence", ...launchArgs];
  if (plan.model) args.push("--model", plan.model);
  if (plan.effort) args.push("--effort", plan.effort);
  if (promptFile) args.push("--append-system-prompt-file", promptFile);
  if (plan.mcp) {
    // The oracle bridge: only pi's tools, over MCP; Claude Code's own are switched off.
    const config = { mcpServers: { [plan.mcp.name]: { type: "stdio", command: plan.mcp.command, args: plan.mcp.args } } };
    args.push("--mcp-config", JSON.stringify(config), "--strict-mcp-config", "--tools", "", "--allowedTools", `mcp__${plan.mcp.name}`, "--permission-mode", "dontAsk");
  } else if (access.writes) args.push("--permission-mode", "bypassPermissions");
  else {
    const tools = claudeTools(access.tools ?? []).join(",");
    args.push("--tools", tools, "--allowedTools", tools, "--permission-mode", "dontAsk");
  }
  if (plan.autoCompact !== false && settings.compactAt > 0) args.push("--settings", JSON.stringify({ autoCompactWindow: settings.compactAt }));
  const env: Record<string, string> = {};
  if (plan.autoCompact === false) env.DISABLE_AUTO_COMPACT = "1";
  // A bridged tool can wait on the user (a question) or a whole task: no MCP time limit.
  if (plan.mcp) env.MCP_TOOL_TIMEOUT = String(BRIDGE_TOOL_TIMEOUT_MS);
  if (settings.modelProvider === "bedrock") env.CLAUDE_CODE_USE_BEDROCK = "1";
  if (settings.modelProvider === "vertex") env.CLAUDE_CODE_USE_VERTEX = "1";
  return { args, env };
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface ClaudeEvent {
  type?: string;
  subtype?: string;
  model?: string;
  message?: { id?: string; model?: string; content?: ContentBlock[] | string };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  errors?: string[];
}

function userMessage(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}

function toolArgs(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const path = input.file_path ?? input.notebook_path ?? input.path;
  return { ...input, ...(typeof path === "string" ? { path } : {}) };
}

export function claudeDriver(io: HarnessIO, prompt: string, collector: HarnessCollector): HarnessDriver {
  const tools = new Map<string, string>();
  let message: string | undefined;
  return {
    start() {
      io.write(userMessage(prompt));
    },
    steer(text) {
      io.write(userMessage(text));
    },
    line(text) {
      let event: ClaudeEvent;
      try {
        event = JSON.parse(text) as ClaudeEvent;
      } catch {
        return;
      }
      if (event.type === "system" && event.subtype === "init" && event.model) collector.model = event.model;
      else if (event.type === "system" && event.subtype === "compact_boundary") {
        io.emit({ type: "compaction" });
        io.emit({ type: "compaction_end" });
      } else if (event.type === "assistant" && Array.isArray(event.message?.content)) {
        if (event.message.id && event.message.id !== message) {
          message = event.message.id;
          io.emit({ type: "turn_start" });
        }
        if (event.message.model) collector.model = event.message.model;
        for (const block of event.message.content) {
          if (block.type === "thinking" && block.thinking?.trim()) {
            io.emit({ type: "thought", text: block.thinking.trim().slice(0, 1500) });
            collector.onDelta?.("thinking", block.thinking);
          } else if (block.type === "text" && block.text?.trim()) {
            io.emit({ type: "writing" });
            collector.text = block.text;
            collector.onDelta?.("text", block.text);
          } else if (block.type === "tool_use" && block.id && block.name) {
            const name = PI_NAMES[block.name] ?? block.name;
            tools.set(block.id, name);
            io.emit({ type: "tool_execution_start", toolName: name, args: toolArgs(block.input) });
          }
        }
      } else if (event.type === "user" && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type !== "tool_result" || !block.tool_use_id) continue;
          const name = tools.get(block.tool_use_id);
          if (!name) continue;
          tools.delete(block.tool_use_id);
          io.emit({ type: "tool_execution_end", toolName: name, isError: block.is_error === true });
        }
      } else if (event.type === "result") {
        const usage = event.usage ?? {};
        const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        const output = usage.output_tokens ?? 0;
        const cost = event.total_cost_usd ?? 0;
        collector.addUsage(input, output, cost, collector.model);
        io.emit({ type: "usage", input, output, cost, ...(collector.model ? { model: collector.model } : {}) });
        if (event.is_error || (event.subtype && event.subtype !== "success")) collector.error = event.result?.trim() || event.errors?.join("; ") || `Claude Code stopped: ${event.subtype ?? "error"}`;
        else if (typeof event.result === "string" && event.result.trim()) collector.text = event.result;
        // Claude Code exits once its input is closed and nothing it was sent is left to answer.
        io.closeInput();
      }
    },
  };
}
