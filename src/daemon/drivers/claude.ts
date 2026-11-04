/**
 * Claude Code as the Orchestrator: one `claude -p` per turn with stream-json
 * in and out, resuming the Lobby session's Claude session (`--resume`), with
 * Bot Lobby's tools on an MCP server and the engine's prompt appended to
 * Claude Code's own. stdin stays open while the turn runs, so a message sent
 * mid-turn steers it (spike check A4). One-shot calls (`complete`) run with
 * no tools and no saved session.
 *
 * Billing (spike A6): headless runs drew from the plan's limits, not extra
 * usage, on the account tested. Bot Lobby never works around a billing rule.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Complete, Content } from "../../host/api.ts";
import type { OrchestratorDriver, TurnSink } from "../host.ts";
import { claudeMcpConfig, MCP_PREFIX, openMcp } from "../mcp/host.ts";

/** Claude Code's own tools the Orchestrator keeps: it does small changes itself, and delegates the rest. */
const BUILTIN_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"];

/** Variables a parent Claude Code (or a cloud box) sets that must not leak into the Orchestrator's. */
const DROP_ENV = /^(CLAUDECODE|CLAUDE_CODE_(SESSION|REMOTE|CHILD|ENTRYPOINT|SDK|TEE)|CLAUDE_AUTO_BACKGROUND_TASKS|CLAUDE_CODE_BG_TASKS)/;

export interface ClaudeDriverOptions {
  command: string;
  cwd: string;
  /** `--model`; empty keeps Claude Code's default. */
  model?: string;
  /** `--effort` (low, medium, high, xhigh, max). */
  effort?: string;
  /** Extra launch arguments from Settings. */
  launchArgs?: string[];
  env?: Record<string, string | undefined>;
}

function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) if (value !== undefined && !DROP_ENV.test(key)) out[key] = value;
  return out;
}

/** A Lobby message as a stream-json user line (text and images). */
export function userLine(content: Content[]): string {
  const blocks = content.map((part) => (part.type === "text" ? { type: "text", text: part.text } : { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } }));
  return `${JSON.stringify({ type: "user", message: { role: "user", content: blocks } })}\n`;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  event?: { type?: string; index?: number; delta?: { type?: string; text?: string; thinking?: string }; content_block?: { type?: string } };
  message?: { id?: string; model?: string; content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean }> };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  errors?: string[];
}

/** Reads one turn's stream-json and tells the sink. Exported for tests. */
export function claudeTurnReader(sink: TurnSink): { line(text: string): void; finished(): boolean } {
  const tools = new Map<string, string>();
  let thinkingOpen = false;
  let pending = "";
  let finished = false;
  return {
    finished: () => finished,
    line(text) {
      let event: StreamEvent;
      try {
        event = JSON.parse(text) as StreamEvent;
      } catch {
        return;
      }
      if (event.type === "system" && event.subtype === "init" && event.session_id) sink.session(event.session_id, event.model);
      else if (event.type === "stream_event" && event.event?.type === "content_block_delta") {
        const delta = event.event.delta;
        if (delta?.type === "text_delta" && delta.text) {
          if (thinkingOpen) {
            thinkingOpen = false;
            sink.thinkingEnd();
          }
          sink.text(delta.text);
        } else if (delta?.type === "thinking_delta" && delta.thinking) {
          thinkingOpen = true;
          sink.thinking(delta.thinking);
        }
      } else if (event.type === "assistant" && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) pending += block.text;
          else if (block.type === "tool_use" && block.id && block.name) {
            if (thinkingOpen) {
              thinkingOpen = false;
              sink.thinkingEnd();
            }
            // Text said before a tool call is its own message, as pi had it.
            if (pending.trim()) sink.assistant(pending);
            pending = "";
            tools.set(block.id, block.name);
            sink.toolStart(block.id, block.name, block.input ?? {});
          }
        }
      } else if (event.type === "user" && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type !== "tool_result" || !block.tool_use_id) continue;
          const name = tools.get(block.tool_use_id);
          if (!name) continue;
          tools.delete(block.tool_use_id);
          sink.toolEnd(block.tool_use_id, name, block.is_error === true);
        }
      } else if (event.type === "result") {
        if (thinkingOpen) {
          thinkingOpen = false;
          sink.thinkingEnd();
        }
        for (const [id, name] of tools) sink.toolEnd(id, name, true);
        tools.clear();
        const usage = event.usage ?? {};
        const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        const failed = event.is_error === true || (event.subtype !== undefined && event.subtype !== "success");
        const error = failed ? event.result?.trim() || event.errors?.join("; ") || `Claude Code stopped: ${event.subtype ?? "error"}` : undefined;
        sink.assistant(failed ? pending : pending || event.result || "", { input, output: usage.output_tokens ?? 0, cost: event.total_cost_usd ?? 0 }, error);
        pending = "";
        finished = true;
      }
    },
  };
}

export function claudeDriver(options: ClaudeDriverOptions): OrchestratorDriver {
  const complete: Complete = (request) =>
    new Promise((resolve, reject) => {
      const args = ["-p", "--output-format", "json", "--no-session-persistence", "--tools", "", ...(options.launchArgs ?? [])];
      const model = request.model?.includes("/") ? request.model.slice(request.model.indexOf("/") + 1) : request.model;
      if (model) args.push("--model", model);
      if (request.system) args.push("--system-prompt", request.system);
      const child = spawn(options.command, args, { cwd: options.cwd, env: cleanEnv(options.env), stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = request.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), request.timeoutMs) : undefined;
      const onAbort = () => child.kill("SIGTERM");
      request.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        try {
          const reply = JSON.parse(out) as StreamEvent;
          if (reply.is_error || reply.subtype !== "success") return reject(new Error(reply.result || `Claude Code stopped: ${reply.subtype}`));
          const usage = reply.usage ?? {};
          resolve({ text: reply.result ?? "", model: `claude/${model || "default"}`, usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 } });
        } catch {
          reject(new Error(err.trim().split("\n").slice(-2).join(" ") || `Claude Code exited with code ${code}`));
        }
      });
      child.stdin.end(request.prompt);
    });

  return {
    harness: "claude",
    complete,
    turn({ prompt, system, resume, tools, callTool, sink, signal }) {
      let steer: (content: Content[]) => boolean = () => false;
      const done = (async () => {
        const mcp = await openMcp({ tools: () => tools, call: callTool });
        const dir = mkdtempSync(join(tmpdir(), "bot-lobby-orchestrator-"));
        try {
          const configFile = join(dir, "mcp.json");
          writeFileSync(configFile, JSON.stringify(claudeMcpConfig(mcp.launch)), { mode: 0o600 });
          const promptFile = join(dir, "system.md");
          writeFileSync(promptFile, system, { mode: 0o600 });
          const allowed = [...BUILTIN_TOOLS, ...tools.map((tool) => `${MCP_PREFIX}${tool.name}`)];
          const args = [
            "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--include-partial-messages",
            "--mcp-config", configFile, "--strict-mcp-config",
            "--tools", BUILTIN_TOOLS.join(","), "--allowedTools", allowed.join(","),
            "--permission-mode", "bypassPermissions",
            ...(system.trim() ? ["--append-system-prompt-file", promptFile] : []),
            ...(resume ? ["--resume", resume] : []),
            ...(options.model ? ["--model", options.model] : []),
            ...(options.effort ? ["--effort", options.effort] : []),
            ...(options.launchArgs ?? []),
          ];
          const child = spawn(options.command, args, { cwd: options.cwd, env: cleanEnv(options.env), stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
          const reader = claudeTurnReader(sink);
          let stderr = "";
          let open = true;
          steer = (content) => {
            if (!open || reader.finished()) return false;
            child.stdin.write(userLine(content));
            return true;
          };
          const stop = () => {
            open = false;
            try {
              if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGINT");
              else child.kill("SIGINT");
            } catch {
              // Already gone.
            }
          };
          signal.addEventListener("abort", stop, { once: true });
          child.stderr.on("data", (chunk: Buffer) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-8000);
          });
          createInterface({ input: child.stdout }).on("line", (line) => {
            reader.line(line);
            if (reader.finished() && open) {
              open = false;
              child.stdin.end();
            }
          });
          child.stdin.on("error", () => {});
          child.stdin.write(userLine(prompt));
          const code = await new Promise<number | null>((resolve, reject) => {
            child.on("error", reject);
            child.on("close", resolve);
          });
          signal.removeEventListener("abort", stop);
          if (!reader.finished() && !signal.aborted) throw new Error(stderr.trim().split("\n").slice(-3).join(" ") || `Claude Code exited with code ${code}`);
        } finally {
          mcp.close();
          rmSync(dir, { recursive: true, force: true });
        }
      })();
      return { done, steer: (content) => steer(content) };
    },
  };
}
