import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentRun } from "../schemas/findings.ts";
import type { ProcessRunner } from "../execution/pi-runner.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
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
  instruction: Type.Optional(Type.String({ description: "scout: what to investigate (also used to target-verify a claim)" })),
  proposal: Type.Optional(Type.String({ description: "propose: the user-facing proposal, at most one paragraph" })),
  concerns: Type.Optional(Type.Array(Type.String(), { description: "propose: concerns raised while challenging the request" })),
  plan: Type.Optional(Type.String({ description: "plan: the detailed internal plan" })),
  domain: Type.Optional(Type.String({ description: "implement: designer, backend, or qa" })),
  task: Type.Optional(Type.String({ description: "implement: the concrete step for that domain's worker" })),
  approvalId: Type.Optional(Type.String({ description: "resolve_approval: the approval id from a worker result" })),
  decision: Type.Optional(
    StringEnum(["approved", "rejected"] as const, { description: "resolve_approval: approve or reject the request" }),
  ),
  note: Type.Optional(Type.String({ description: "resolve_approval: rationale, or what to do instead when rejected" })),
  reason: Type.Optional(Type.String({ description: "block: why the task cannot continue" })),
  text: Type.Optional(Type.String({ description: "decide: the decision and its rationale" })),
});

const DESCRIPTION = [
  "Drive the dev-house multi-agent workflow for the active task.",
  "Actions: clarify (ask the user), scout (domain reconnaissance in parallel), propose (record the",
  "proposal and request approval), plan (record the internal plan), implement (delegate one step to a",
  "domain worker), review (independent verification of the current diff), resolve_approval (approve or",
  "reject a dependency/architecture request), block/resume (escalate or continue), decide (record a",
  "decision), status, cancel.",
  "The engine validates every step against the task state machine, so a rejected action means the",
  "workflow is not at that step yet.",
].join(" ");

/** Build the engine dependencies from the current Pi context. */
export function workflowDeps(
  ctx: ExtensionContext,
  configDir: string,
  signal: AbortSignal | undefined,
  onUpdate: ((run: AgentRun) => void) | undefined,
  runProcess?: ProcessRunner,
): WorkflowDeps {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const hasUI = ctx.hasUI;
  return {
    root,
    configDir,
    cwd: ctx.cwd,
    config: loadConfig(root, configDir),
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

function summarizeRun(run: AgentRun): string {
  const icon = run.status === "running" ? "⏳" : run.status === "success" ? "✓" : "✗";
  return `${icon} ${run.domain}/${run.role}${run.status === "running" ? "" : ` (${run.status})`}`;
}

/** Accumulate agent runs so parallel scouts show as one progress list. */
function runReporter(update: AgentToolUpdateCallback<unknown> | undefined): (run: AgentRun) => void {
  const runs = new Map<string, AgentRun>();
  return (run) => {
    runs.set(`${run.domain}:${run.role}`, run);
    if (!update) return;
    update({
      content: [{ type: "text", text: [...runs.values()].map(summarizeRun).join("\n") }],
      details: { runs: [...runs.values()] },
    });
  };
}

export function registerOrchestrateTool(pi: ExtensionAPI, configDir: string, runProcess?: ProcessRunner): void {
  pi.registerTool({
    name: "orchestrate",
    label: "Orchestrate",
    description: DESCRIPTION,
    promptSnippet: "Run a dev-house workflow step (clarify, scout, propose, plan, decide, status, cancel)",
    promptGuidelines: [
      "Use orchestrate for every dev-house workflow step; it enforces the task state machine and records results.",
    ],
    parameters: OrchestrateSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const deps = workflowDeps(ctx, configDir, signal, runReporter(onUpdate), runProcess);
      const result = await runWorkflowAction(params as OrchestrateParams, deps);
      return {
        content: [{ type: "text", text: result.ok ? result.message : `${result.message}` }],
        details: { ok: result.ok, state: result.state, taskId: result.taskId },
      };
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as Partial<WorkflowResult> | undefined;
      const body = result.content[0]?.type === "text" ? result.content[0].text : "";
      const icon = details?.ok ? theme.fg("success", "✓") : theme.fg("warning", "!");
      const header = `${icon} ${theme.fg("toolTitle", theme.bold("orchestrate"))} ${theme.fg("accent", details?.taskId ?? "")} ${theme.fg("muted", `→ ${details?.state ?? "?"}`)}`;
      const shown = expanded ? body : body.split("\n").slice(0, 6).join("\n");
      return new Text(`${header}\n${theme.fg("dim", shown)}`, 0, 0);
    },
  });
}
