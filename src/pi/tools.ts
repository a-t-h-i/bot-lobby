import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentRun } from "../schemas/findings.ts";
import type { ProcessRunner } from "../execution/pi-runner.ts";
import { inheritThinking } from "../schemas/configuration.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { truncate } from "../text.ts";
import { applyStatus, summarizeRun } from "./ui.ts";
import { isQuiet } from "./quiet.ts";
import {
  ORCHESTRATE_ACTIONS,
  runWorkflowAction,
  type OrchestrateParams,
  type WorkflowDeps,
  type WorkflowResult,
} from "../workflow/workflow.ts";

const OrchestrateSchema = Type.Object({
  action: StringEnum(ORCHESTRATE_ACTIONS, { description: "Workflow step to run" }),
  taskId: Type.Optional(Type.String({ description: "Task id; defaults to the active task" })),
  question: Type.Optional(Type.String({ description: "clarify: question for the user" })),
  options: Type.Optional(Type.Array(Type.String(), { description: "clarify: optional answer choices" })),
  domains: Type.Optional(Type.Array(Type.String(), { description: "scout: any of designer, backend, qa" })),
  instruction: Type.Optional(Type.String({ description: "scout/research: what to investigate (for scout, also used to target-verify a claim)" })),
  proposal: Type.Optional(Type.String({ description: "propose: the user-facing proposal as a short `- ` bullet list, one line per change" })),
  concerns: Type.Optional(Type.Array(Type.String(), { description: "propose: concerns raised while challenging the request" })),
  plan: Type.Optional(Type.String({ description: "plan: the detailed internal plan" })),
  domain: Type.Optional(Type.String({ description: "implement/research: designer, backend, or qa" })),
  task: Type.Optional(Type.String({ description: "implement: the concrete step for that domain's worker" })),
  approvalId: Type.Optional(Type.String({ description: "resolve_approval: the approval id from a worker result" })),
  decision: Type.Optional(
    StringEnum(["approved", "rejected"] as const, { description: "resolve_approval: approve or reject the request" }),
  ),
  note: Type.Optional(Type.String({ description: "resolve_approval: rationale, or what to do instead when rejected" })),
  reason: Type.Optional(Type.String({ description: "block: why the task cannot continue" })),
  text: Type.Optional(Type.String({ description: "decide/complete/knowledge: the decision, completion summary, or knowledge text" })),
  file: Type.Optional(Type.String({ description: "compact: the knowledge file to rewrite, e.g. knowledge.md" })),
  kind: Type.Optional(
    StringEnum(["knowledge", "standard", "decision", "completed"] as const, {
      description: "knowledge: which persistent file the text belongs to",
    }),
  ),
});

const DESCRIPTION = [
  "Drive the bot-lobby multi-agent workflow for the active task.",
  "Actions: clarify (ask the user), scout (domain reconnaissance in parallel), research (summon the",
  "read-only researcher for cited internet evidence on a complex change, tool, plugin, doc set or",
  "dependency), propose (record the proposal and request approval), plan (record the internal",
  "plan), implement (delegate one step to a domain worker), qa (final quality gate and the only",
  "review), knowledge (record approved knowledge or a decision),",
  "compact (replace a knowledge file with a rewritten version, archiving the old one),",
  "resolve_approval (approve or reject a request), complete (declare the task done after the gates",
  "pass), block/resume (escalate or continue), status, cancel.",
  "The engine validates every step against the task state machine, so a rejected action means the workflow is not at that step yet.",
].join(" ");

/** Build the engine dependencies from the current Pi context. `thinking` is the live session level used by agents configured to inherit it. */
export function workflowDeps(
  ctx: ExtensionContext,
  configDir: string,
  signal: AbortSignal | undefined,
  onUpdate: ((run: AgentRun) => void) | undefined,
  runProcess?: ProcessRunner,
  thinking?: string,
): WorkflowDeps {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const hasUI = ctx.hasUI;
  return {
    root,
    configDir,
    cwd: ctx.cwd,
    config: inheritThinking(loadConfig(), thinking),
    sessionId: ctx.sessionManager.getSessionId(),
    signal,
    onUpdate,
    runProcess,
    ask: async (question) => (hasUI ? ctx.ui.input(question) : undefined),
    choose: async (title, options) => (hasUI ? ctx.ui.select(title, options) : undefined),
    notify: (message, level = "info") => {
      if (hasUI) ctx.ui.notify(message, level);
    },
  };
}

/** Accumulate agent runs so parallel scouts show as one progress list. */
function runReporter(
  update: AgentToolUpdateCallback<unknown> | undefined,
  refresh: (runs: AgentRun[]) => void,
): (run: AgentRun) => void {
  const runs = new Map<string, AgentRun>();
  return (run) => {
    runs.set(`${run.domain}:${run.role}`, run);
    const current = [...runs.values()];
    refresh(current);
    if (!update) return;
    update({
      content: [{ type: "text", text: current.map(summarizeRun).join("\n") }],
      details: { runs: current },
    });
  };
}

/** TUI-only transcript entries; these never enter the model's context. */
function registerBotLobbyEntries(pi: ExtensionAPI): void {
  pi.registerEntryRenderer("bot-lobby", (entry, { expanded }, theme) => {
    const data = entry.data as { kind?: string; taskId?: string; text?: string } | undefined;
    const header = `bot-lobby ${data?.taskId ?? ""} — ${data?.kind ?? "note"}`.trim();
    const body = data?.text ?? "";
    return new Text(`${theme.fg("accent", theme.bold(header))}\n${theme.fg("toolOutput", expanded ? body : truncate(body, 600))}`, 0, 0);
  });
}

export function registerOrchestrateTool(pi: ExtensionAPI, configDir: string, runProcess?: ProcessRunner): void {
  registerBotLobbyEntries(pi);
  pi.registerTool({
    name: "orchestrate",
    label: "Orchestrate",
    description: DESCRIPTION,
    promptSnippet: "Run a bot-lobby workflow step (clarify, scout, propose, plan, decide, status, cancel)",
    promptGuidelines: [
      "Use orchestrate for every bot-lobby workflow step; it enforces the task state machine and records results.",
    ],
    parameters: OrchestrateSchema,
    // Self shell: an empty renderer then yields zero lines (see quiet.ts).
    renderShell: "self",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const root = detectProjectRoot(ctx.cwd, configDir);
      const deps = workflowDeps(ctx, configDir, signal, runReporter(onUpdate, (runs) => applyStatus(ctx, root, configDir, runs)), runProcess, pi.getThinkingLevel());
      const result = await runWorkflowAction(params as OrchestrateParams, deps);
      if (params.action === "propose" && params.proposal && result.ok) {
        pi.appendEntry("bot-lobby", { kind: "proposal", taskId: params.taskId, text: params.proposal });
      }
      applyStatus(ctx, root, configDir);
      return {
        content: [{ type: "text", text: result.message }],
        details: { ok: result.ok, state: result.state, taskId: result.taskId },
      };
    },
    renderCall(args, theme) {
      if (isQuiet()) return new Container();
      const call = args as OrchestrateParams & { file?: string };
      const target = call.domain ?? call.domains?.join(", ") ?? call.file ?? "";
      const header = `${theme.fg("toolTitle", theme.bold("orchestrate"))} ${theme.fg("accent", call.action)}${target ? ` ${theme.fg("muted", target)}` : ""}`;
      return new Text(header, 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      if (isQuiet()) return new Container();
      const details = result.details as Partial<WorkflowResult> | undefined;
      const body = result.content[0]?.type === "text" ? result.content[0].text : "";
      const icon = details?.ok ? theme.fg("success", "✓") : theme.fg("warning", "!");
      const header = `${icon} ${theme.fg("toolTitle", theme.bold("orchestrate"))} ${theme.fg("accent", details?.taskId ?? "")} ${theme.fg("muted", `→ ${details?.state ?? "?"}`)}`;
      return new Text(expanded && body ? `${header}\n${theme.fg("dim", truncate(body, 2000))}` : header, 0, 0);
    },
  });
}
