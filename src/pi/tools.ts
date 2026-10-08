import { StringEnum } from "@earendil-works/pi-ai";
import { getMarkdownTheme, type AgentToolUpdateCallback, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentRun } from "../schemas/findings.ts";
import type { ProcessRunner } from "../execution/pi-runner.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { classifier, effortFor, hintsFor, knowledgeFor, triageFor } from "../classifier/instance.ts";
import { truncate } from "../text.ts";
import { applyStatus, reportRuns, summarizeRun } from "./ui.ts";
import { whileAsking } from "../state/budget.ts";
import { askChoice, askText, askUser, canAsk } from "../ask/web.ts";
import type { AskQuestion } from "../ask/types.ts";
import { unescapeBreaks } from "../lobby/blocks.ts";
import { isQuiet } from "./quiet.ts";
import { checkThinking, createProfileResolver, modelRef, type ModelLookup } from "./model-support.ts";
import { agentName, describeRun } from "./run-summary.ts";
import { lintFeed } from "../workflow/lint.ts";
import { qaRiskLine } from "../classifier/qa-risk.ts";
import { lobbyFeed } from "../lobby/feed.ts";
import {
  ORCHESTRATE_ACTIONS,
  runWorkflowAction,
  type OrchestrateParams,
  type WorkflowDeps,
  type WorkflowResult,
} from "../workflow/workflow.ts";

const OrchestrateSchema = Type.Object({
  action: StringEnum(ORCHESTRATE_ACTIONS, { description: "Workflow step to run" }),
  taskId: Type.Optional(Type.String({ description: "Task id; defaults to the active task. For knowledge/compact, omit to update project facts without changing a task." })),
  question: Type.Optional(Type.String({ description: "clarify: question for the user" })),
  options: Type.Optional(Type.Array(Type.String(), { description: "clarify: optional answer choices, neutral and unranked; mark one (Recommended) only when the answer is quite obvious" })),
  domains: Type.Optional(Type.Array(Type.String(), { description: "scout: any of designer, backend, qa" })),
  instruction: Type.Optional(Type.String({ description: "scout/research: a self-contained brief: the specific questions, where to look, the answer format you want (paths, names, versions, evidence) and what you will do with it. The agent may be a small model: assume nothing" })),
  proposal: Type.Optional(Type.String({ description: "propose: the user-facing proposal as a short `- ` bullet list, one line per change" })),
  concerns: Type.Optional(Type.Array(Type.String(), { description: "propose: concerns raised while challenging the request" })),
  plan: Type.Optional(Type.String({ description: "plan: the detailed internal plan (while implementing or reviewing, the full revised plan that replaces it). Every step names its files, its concrete actions and its done criteria, and the contracts between domains are written out; no decision is left to the workers" })),
  domain: Type.Optional(Type.String({ description: "implement/research: designer, backend, or qa" })),
  task: Type.Optional(Type.String({ description: "implement: a self-contained brief for that domain's worker (which may be a small, literal model): Goal, exact Files, numbered What to do with names/shapes/values, Contracts, Constraints, Done when (checkable criteria and commands), If stuck. Decide everything yourself; leave nothing to be assumed" })),
  assignments: Type.Optional(
    Type.Array(
      Type.Object({
        domain: Type.String({ description: "designer, backend, or qa" }),
        task: Type.String({ description: "a self-contained brief for that domain's worker: Goal, exact Files, numbered What to do, Contracts (in full), Constraints, Done when, If stuck. No assumptions" }),
        minutes: Type.Optional(Type.Number({ description: "under a time budget: minutes for this worker, by its scope" })),
      }),
      { description: "implement: run several domains in parallel (distinct domains); workers share files through the file desk" },
    ),
  ),
  minutes: Type.Optional(Type.Number({ description: "implement (under a time budget): minutes for this step, by its scope; budget: more minutes to ask the user for" })),
  approvalId: Type.Optional(Type.String({ description: "resolve_approval: the approval id from a worker result" })),
  decision: Type.Optional(
    StringEnum(["approved", "rejected"] as const, { description: "resolve_approval: approve or reject the request" }),
  ),
  note: Type.Optional(Type.String({ description: "resolve_approval: rationale, or what to do instead when rejected" })),
  reason: Type.Optional(Type.String({ description: "block: why the task cannot continue; budget: why the task needs more time; track: why the task takes that path or needs those members" })),
  track: Type.Optional(
    StringEnum(["fast", "full"] as const, { description: "track: fast (straight to the roster's agents, no scouts, proposal or plan; QA only for tests) or full (the whole workflow)" }),
  ),
  roster: Type.Optional(Type.Array(Type.String(), { description: "track: who takes part — any of designer, backend, qa, researcher" })),
  text: Type.Optional(Type.String({ description: "decide/complete/knowledge: the decision, completion summary, or knowledge text" })),
  file: Type.Optional(Type.String({ description: "compact: the knowledge file to rewrite, e.g. knowledge.md" })),
  name: Type.Optional(Type.String({ description: "whiteboard: name for the new Excalidraw session" })),
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
  "plan, or amend it later with the full revised plan), implement (delegate a step to a domain worker, or several domains in parallel with assignments), qa (final quality gate and the only",
  "review), knowledge (record approved project knowledge or a decision; works without a task),",
  "compact (replace a knowledge file with a rewritten version, archiving the old one; works without a task; disperse domain-relevant facts to action=knowledge (domain=designer|backend|qa) first), whiteboard (create your own Excalidraw session and assign it to yourself),",
  "resolve_approval (approve or reject a request), complete (declare the task done after the gates",
  "pass), block/resume (escalate or continue), budget (under a time budget: where it stands, or ask the",
  "user for more minutes with a reason), track (the task's path and who takes part: show it, or correct it with",
  "track=fast|full, roster and a reason), status, cancel.",
  "Every instruction you give an agent is read by a possibly smaller, cheaper model that cannot infer intent: write each one as a complete, explicit brief with the goal, files, actions, contracts, constraints and done criteria, then check the report against it.",
  "The engine validates every step against the task state machine, so a rejected action means the workflow is not at that step yet.",
].join(" ");

/** Resolve a `provider/id` (or bare id) against the models this session knows. */
export function modelLookup(ctx: ExtensionContext): ModelLookup {
  return (ref) => {
    const slash = ref.indexOf("/");
    if (slash > 0) return ctx.modelRegistry.find(ref.slice(0, slash), ref.slice(slash + 1));
    return ctx.modelRegistry.getAvailable().find((model) => model.id === ref);
  };
}

/** Build the engine dependencies from the current Pi context; every agent's model and thinking come from settings. */
export function workflowDeps(
  ctx: ExtensionContext,
  configDir: string,
  signal: AbortSignal | undefined,
  onUpdate: ((run: AgentRun) => void) | undefined,
  runProcess?: ProcessRunner,
): WorkflowDeps {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const hasUI = ctx.hasUI;
  const config = loadConfig();
  const warn = (message: string) => {
    if (hasUI) ctx.ui.notify(message, "warning");
  };
  return {
    root,
    configDir,
    cwd: ctx.cwd,
    config,
    profile: createProfileResolver(config, {
      lookup: modelLookup(ctx),
      sessionModel: ctx.model ? modelRef(ctx.model) : undefined,
      warn,
    }),
    sessionId: ctx.sessionManager.getSessionId(),
    signal,
    onUpdate,
    runProcess,
    hints: hintsFor({ cwd: ctx.cwd, root, configDir }),
    knowledge: knowledgeFor(),
    classifier: classifier(),
    triage: (request, triageSignal) => triageFor({ cwd: ctx.cwd, root, configDir }, request, triageSignal),
    effort: effortFor((model, thinking) => checkThinking(modelLookup(ctx)(model), thinking).level),
    // Time spent waiting on the user is not the task's: its budget clock waits too.
    // The questions go to the web page, where a free-text answer may run to several lines.
    ask: async (question) => (canAsk() ? whileAsking(() => askText(question)) : undefined),
    choose: async (title, options) => (canAsk() ? whileAsking(() => askChoice(title, options)) : undefined),
    // An agent's own questions (the designer's), relayed as the questionnaire.
    ...(canAsk() ? { askQuestions: (questions: AskQuestion[], from: string, askSignal?: AbortSignal) => whileAsking(() => askUser(questions, ctx, askSignal, from)) } : {}),
    notify: (message, level = "info") => {
      if (hasUI) ctx.ui.notify(message, level);
    },
    // Each new lint result on a task's touched files is a line in the lobby's activity log.
    onLint: (taskId, report) => {
      const line = lintFeed(taskId, report);
      lobbyFeed.log("LINT", line.text, line.kind);
    },
    // Jev's QA risk read of each task's change, as the QA gate starts.
    onQaRisk: (taskId, assessment) => lobbyFeed.log("CLASSIFIER", `${taskId} ${qaRiskLine(assessment)}`, "info"),
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

/** A header line over Markdown, rendered as pi renders its own messages (a proposal's bullets, a report's code spans). */
function headedMarkdown(header: string, body: string, color: (text: string) => string): Container {
  const box = new Container();
  box.addChild(new Text(header, 0, 0));
  if (body.trim()) box.addChild(new Markdown(unescapeBreaks(body), 0, 0, getMarkdownTheme(), { color }));
  return box;
}

/** TUI-only transcript entries; these never enter the model's context. */
function registerBotLobbyEntries(pi: ExtensionAPI): void {
  pi.registerEntryRenderer("bot-lobby", (entry, { expanded }, theme) => {
    const data = entry.data as { kind?: string; taskId?: string; text?: string; ok?: boolean } | undefined;
    if (data?.kind === "run") {
      // One compact line per finished subagent run.
      return new Text(theme.fg(data.ok ? "dim" : "warning", data.text ?? ""), 0, 0);
    }
    const header = `bot-lobby ${data?.taskId ?? ""} — ${data?.kind ?? "note"}`.trim();
    const body = data?.text ?? "";
    return headedMarkdown(theme.fg("accent", theme.bold(header)), expanded ? body : truncate(body, 600), (text) => theme.fg("toolOutput", text));
  });
}

/** A transcript line per finished run, plus a warning for anything that stalled or ran out of time. */
function reportFinishedRuns(pi: ExtensionAPI, ctx: ExtensionContext, result: WorkflowResult): void {
  for (const run of result.runs ?? []) {
    const ok = run.status === "success" && !run.wrappedUp;
    pi.appendEntry("bot-lobby", { kind: "run", taskId: result.taskId, text: describeRun(run), ok });
    if (!ctx.hasUI) continue;
    if (run.stalled) ctx.ui.notify(`bot-lobby: ${agentName(run)} ${run.role} stalled — ${run.error ?? "no output"}`, "warning");
    else if (run.status === "timeout") ctx.ui.notify(`bot-lobby: ${agentName(run)} ${run.role} ${run.error ?? "hit its time limit"}`, "warning");
  }
}

export function registerOrchestrateTool(pi: ExtensionAPI, configDir: string, runProcess?: ProcessRunner): void {
  registerBotLobbyEntries(pi);
  pi.registerTool({
    name: "orchestrate",
    label: "Orchestrate",
    description: DESCRIPTION,
    promptSnippet: "Run a bot-lobby workflow step (clarify, scout, propose, plan, implement, track, decide, status, cancel)",
    promptGuidelines: [
      "Use orchestrate for every bot-lobby workflow step; it enforces the task state machine and records results.",
    ],
    parameters: OrchestrateSchema,
    // Self shell: an empty renderer then yields zero lines (see quiet.ts).
    renderShell: "self",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const root = detectProjectRoot(ctx.cwd, configDir);
      const deps = workflowDeps(ctx, configDir, signal, runReporter(onUpdate, (runs) => reportRuns(ctx, root, configDir, runs)), runProcess);
      const result = await runWorkflowAction(params as OrchestrateParams, deps);
      if (params.action === "propose" && params.proposal && result.ok) {
        pi.appendEntry("bot-lobby", { kind: "proposal", taskId: params.taskId, text: params.proposal });
      }
      reportFinishedRuns(pi, ctx, result);
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
      return expanded && body ? headedMarkdown(header, truncate(body, 2000), (text) => theme.fg("dim", text)) : new Text(header, 0, 0);
    },
  });
}
