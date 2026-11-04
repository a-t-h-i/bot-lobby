/**
 * Codex CLI: one `codex exec --json` run per step. The prompt goes over
 * stdin, Bot Lobby's instructions as `developer_instructions`, and the JSONL
 * events (`thread.started`, `item.*`, `turn.completed`) become the same
 * stream events a pi subagent sends.
 *
 * The flag set follows T3 Code's `apps/server/src/textGeneration/CodexTextGeneration.ts`
 * (`exec`, `--skip-git-repo-check`, `-s`, `--model`, `model_reasoning_effort`)
 * and `apps/server/src/provider/codexLaunchArgs.ts`.
 */
import type { HarnessDriver, HarnessIO } from "./process.ts";
import type { HarnessAccess, HarnessCollector, HarnessPlan } from "./runner.ts";

/** Longest instructions passed on the command line; longer ones lead the prompt instead. */
const MAX_ARG_BYTES = 100_000;
/** "Never" for Codex's compaction threshold, which cannot be switched off. */
const NO_COMPACTION = 1_000_000_000_000;
const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio"]);

/** A TOML basic string: JSON's escapes are valid TOML. */
export function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function codexArgs(plan: HarnessPlan, access: HarnessAccess, launchArgs: string[]): { args: string[]; promptPrefix: string } {
  const { settings } = plan.harness;
  const args = ["exec", ...launchArgs, "--json", "--skip-git-repo-check", "-s", access.writes ? "workspace-write" : "read-only", "-c", 'approval_policy="never"'];
  if (plan.model) args.push("--model", plan.model);
  if (plan.effort) args.push("-c", `model_reasoning_effort=${tomlString(plan.effort)}`);
  const provider = settings.modelProvider;
  if (LOCAL_PROVIDERS.has(provider)) args.push("--oss", "--local-provider", provider);
  else if (provider) args.push("-c", `model_provider=${tomlString(provider)}`);
  if (plan.autoCompact === false) args.push("-c", `model_auto_compact_token_limit=${NO_COMPACTION}`);
  else if (settings.compactAt > 0) args.push("-c", `model_auto_compact_token_limit=${settings.compactAt}`);
  let promptPrefix = "";
  if (plan.instructions) {
    if (Buffer.byteLength(plan.instructions) <= MAX_ARG_BYTES) args.push("-c", `developer_instructions=${tomlString(plan.instructions)}`);
    else promptPrefix = plan.instructions;
  }
  args.push("-");
  return { args, promptPrefix };
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  exit_code?: number | null;
  status?: string;
  changes?: Array<{ path?: string; kind?: string }>;
  server?: string;
  tool?: string;
  query?: string;
  message?: string;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  message?: string;
}

function toolOf(item: CodexItem): { name: string; args: Record<string, unknown> } | undefined {
  switch (item.type) {
    case "command_execution":
      return { name: "bash", args: { command: item.command ?? "" } };
    case "mcp_tool_call":
      return { name: `mcp__${item.server ?? "server"}__${item.tool ?? "tool"}`, args: {} };
    case "web_search":
      return { name: "web_search", args: { query: item.query ?? "" } };
    default:
      return undefined;
  }
}

export function codexDriver(io: HarnessIO, plan: HarnessPlan, prompt: string, collector: HarnessCollector): HarnessDriver {
  const started = new Set<string>();
  const onItem = (phase: "started" | "updated" | "completed", item: CodexItem) => {
    if (item.type === "agent_message" && phase === "completed") {
      io.emit({ type: "writing" });
      if (item.text?.trim()) collector.text = item.text;
      return;
    }
    if (item.type === "reasoning" && phase === "completed") {
      if (item.text?.trim()) io.emit({ type: "thought", text: item.text.trim().slice(0, 1500) });
      return;
    }
    if (item.type === "file_change" && phase === "completed") {
      for (const change of item.changes ?? []) {
        if (!change.path) continue;
        const name = change.kind === "add" ? "write" : "edit";
        io.emit({ type: "tool_execution_start", toolName: name, args: { path: change.path } });
        io.emit({ type: "tool_execution_end", toolName: name, isError: item.status === "failed" });
      }
      return;
    }
    if (item.type === "error" && item.message) {
      collector.warning = item.message;
      return;
    }
    const tool = toolOf(item);
    if (!tool) return;
    const id = item.id ?? `${tool.name}:${started.size}`;
    if (!started.has(id)) {
      started.add(id);
      io.emit({ type: "tool_execution_start", toolName: tool.name, args: tool.args });
      if (phase !== "completed") return;
    }
    if (phase === "completed") io.emit({ type: "tool_execution_end", toolName: tool.name, isError: item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0) });
  };
  return {
    start() {
      io.write(prompt);
      io.closeInput();
    },
    line(text) {
      let event: CodexEvent;
      try {
        event = JSON.parse(text) as CodexEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case "thread.started":
          collector.session = event.thread_id;
          return;
        case "turn.started":
          io.emit({ type: "turn_start" });
          return;
        case "item.started":
        case "item.updated":
        case "item.completed":
          if (event.item) onItem(event.type.slice("item.".length) as "started" | "updated" | "completed", event.item);
          return;
        case "turn.completed": {
          const input = (event.usage?.input_tokens ?? 0);
          const output = event.usage?.output_tokens ?? 0;
          collector.addUsage(input, output, 0, plan.model || undefined);
          io.emit({ type: "usage", input, output, cost: 0, ...(plan.model ? { model: plan.model } : {}) });
          return;
        }
        case "turn.failed":
          collector.error = event.error?.message ?? "Codex reported a failed turn";
          return;
        case "error":
          if (event.message) collector.warning = event.message;
          return;
      }
    },
  };
}
