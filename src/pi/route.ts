/**
 * Where a new request goes before any task exists. The classifier (Jev, or
 * the rules while it is off) reads whether one agent can do it alone, right
 * away. When it can, the oracle confirms with `route_request`: the lobby hands
 * the request to the quick-fix agent and shows the Quick fix tab. Otherwise,
 * or when the oracle says it needs the team, the task starts as before.
 *
 * Nothing is routed without the lobby (it runs quick fixes), when routing is
 * off (`workflow.routeQuickFixes`), or for a request the user already placed
 * (`--task`, `--fast`, `--full`) or a planned task.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Domain } from "../schemas/agent.ts";
import type { TaskTriage } from "../schemas/task.ts";
import { chooseRoute, type RequestRoute } from "../workflow/track.ts";
import { triageFor } from "../classifier/instance.ts";
import { ownedTask } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { lobbyFeed } from "../lobby/feed.ts";
import { startTask, type StartOptions } from "./start-task.ts";
import { isQuiet, isSubagentProcess } from "./quiet.ts";

export const ROUTE_TOOL = "route_request";

/**
 * Hands a request to the lobby's quick-fix agent and shows the Quick fix tab;
 * the job's id, or undefined without a lobby. `builder` is set for a quick
 * feature: it runs on that domain's model, thinking and time limit.
 */
export type QuickFixHandoff = (request: string, builder: Domain | undefined, reason: string) => string | undefined;

let handoff: QuickFixHandoff | undefined;

/** The lobby registers its quick-fix hand-off while it runs. */
export function setQuickFixHandoff(next: QuickFixHandoff | undefined): void {
  handoff = next;
}

interface Pending {
  request: string;
  options: StartOptions;
  route: RequestRoute;
  at: number;
}

let pending: Pending | undefined;

/** A request the oracle has not routed in this long is forgotten: the next one starts afresh. */
const STALE_MS = 30 * 60_000;

/** The request waiting for the oracle to route it, if any. */
export function pendingRequest(now = Date.now()): { request: string; route: RequestRoute } | undefined {
  if (pending && now - pending.at >= STALE_MS) pending = undefined;
  return pending ? { request: pending.request, route: pending.route } : undefined;
}

/** A quick feature (bigger than a small change, but self-contained) runs with its builder's settings; a quick fix with the quick-fix agent's. */
function builderFor(route: RequestRoute): Domain | undefined {
  return route.size === "medium" || route.size === "large" ? route.builder : undefined;
}

/** What the oracle is asked: one step, from the request alone. */
export function routeMessage(request: string, route: RequestRoute): string {
  return [
    "bot-lobby: a new request, not a task yet.",
    `Request: ${request}`,
    `Read: a ${builderFor(route) ? "quick feature" : "quick fix"} — ${route.reasons.join("; ")} (${route.source}).`,
    "",
    "Confirm where it goes with route_request, in one step and from the request alone: do not read files, plan or ask.",
    "- to=quickfix: one agent does it now and the lobby shows it on the Quick fix tab. Right for anything one person can just do, even a rich piece of work in one file.",
    "- to=task: the team (bot-lobby's workflow), when it needs several areas agreeing on a contract, a survey of an unfamiliar codebase, a risky change, or decisions the user must make first.",
    "Then tell the user in one line where it went.",
  ].join("\n");
}

export interface RequestOptions extends StartOptions {
  /** `--task`: always a task. */
  task?: boolean;
}

/**
 * A new request from the lobby or `/bot-lobby <request>`: a task at once, or
 * (when it reads as one agent's work) a question to the oracle first.
 * Resolves with what happened.
 */
export async function startRequest(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, request: string, options: RequestOptions = {}): Promise<"task" | "routing" | undefined> {
  const { task: asTask, ...start } = options;
  const config = loadConfig();
  const root = detectProjectRoot(ctx.cwd, configDir);
  const placed = asTask || start.track || start.approvedPlan || !config.workflow.routeQuickFixes || !handoff;
  // A session that already drives a task gets startTask's own warning.
  if (placed || ownedTask(root, configDir, ctx.sessionManager.getSessionId())) {
    return (await startTask(pi, ctx, configDir, request, start)) ? "task" : undefined;
  }
  const triage = await triageFor({ cwd: ctx.cwd, root, configDir }, request);
  const route = chooseRoute(request, triage, config.classifier.thresholds.quickFixAt);
  const read: StartOptions = { ...start, triaged: true, ...(triage ? { triage } : {}) };
  if (route.to === "task") return (await startTask(pi, ctx, configDir, request, read)) ? "task" : undefined;
  pending = { request, options: read, route, at: Date.now() };
  lobbyFeed.log("LOBBY", `reads as a ${builderFor(route) ? "quick feature" : "quick fix"} (${route.source}): ${route.reasons[0]} — the oracle confirms`, "info");
  pi.sendUserMessage(routeMessage(request, route), ctx.isIdle() ? undefined : { deliverAs: "followUp" });
  return "routing";
}

const RouteSchema = Type.Object({
  to: StringEnum(["quickfix", "task"] as const, { description: "quickfix: one agent does it now, on the lobby's Quick fix tab; task: the team (bot-lobby's workflow)" }),
  reason: Type.Optional(Type.String({ description: "one line: why it goes there" })),
  request: Type.Optional(Type.String({ description: "the request as it should be done, when the user refined it since; their words otherwise" })),
});

/** The oracle's answer to a routing question: the quick-fix agent, or a task. */
export async function routeRequest(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, params: { to: "quickfix" | "task"; reason?: string; request?: string }): Promise<{ ok: boolean; text: string }> {
  const waiting = pendingRequest();
  if (!waiting || !pending) return { ok: false, text: "No request is waiting to be routed. Start a task with /bot-lobby <request>." };
  const { options, route } = pending;
  const request = params.request?.trim() || pending.request;
  pending = undefined;
  const why = params.reason?.trim();
  if (params.to === "quickfix") {
    const id = handoff?.(request, builderFor(route), why || route.reasons[0] || "one agent can do it alone");
    if (id) {
      lobbyFeed.log("LOBBY", `the oracle sent it to the quick-fix agent: ${id}${why ? ` — ${why}` : ""}`, "success");
      return { ok: true, text: `${id} is running on the lobby's Quick fix tab, which is now open. Tell the user in one line that this looks like a ${builderFor(route) ? "quick feature" : "quick fix"} and the quick-fix agent is on it; nothing else to do.` };
    }
    // No lobby to run it any more: it becomes a task.
  }
  lobbyFeed.log("LOBBY", `the oracle sent it to the team${why ? ` — ${why}` : ""}`, "info");
  const task = await startTask(pi, ctx, configDir, request, { ...options, routed: true });
  return task
    ? { ok: true, text: `Started ${task.id} as a task; its kickoff follows as the next message. Say nothing more now.` }
    : { ok: false, text: "Could not start a task: this session already drives one (finish or cancel it first)." };
}

/**
 * `route_request`, active only while a request waits for the oracle, so it
 * never sits in the tool list of plain pi or of a running task.
 */
export function registerRouteTool(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  pi.on("session_start", () => {
    pending = undefined;
  });
  pi.on("before_agent_start", () => {
    const active = pi.getActiveTools();
    const want = Boolean(pendingRequest());
    if (want === active.includes(ROUTE_TOOL)) return;
    pi.setActiveTools(want ? [...active, ROUTE_TOOL] : active.filter((name) => name !== ROUTE_TOOL));
  });
  pi.registerTool({
    name: ROUTE_TOOL,
    label: "Route request",
    description: "Send a new bot-lobby request to the quick-fix agent (to=quickfix: one agent does it now, shown on the lobby's Quick fix tab) or to the team (to=task: bot-lobby's workflow). Only while a request waits to be routed.",
    promptSnippet: "Route a new bot-lobby request: quickfix (one agent now) or task (the team)",
    parameters: RouteSchema,
    renderShell: "self",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await routeRequest(pi, ctx, configDir, params as { to: "quickfix" | "task"; reason?: string; request?: string });
      return { content: [{ type: "text", text: result.text }], details: { ok: result.ok, to: (params as { to: string }).to } };
    },
    renderCall(args, theme) {
      if (isQuiet()) return new Container();
      const call = args as { to?: string };
      return new Text(`${theme.fg("toolTitle", theme.bold("route_request"))} ${theme.fg("accent", call.to ?? "")}`, 0, 0);
    },
    renderResult(result, _options, theme) {
      if (isQuiet()) return new Container();
      const details = result.details as { ok?: boolean; to?: string } | undefined;
      const icon = details?.ok ? theme.fg("success", "✓") : theme.fg("warning", "!");
      return new Text(`${icon} ${theme.fg("toolTitle", theme.bold("route_request"))} ${theme.fg("muted", `→ ${details?.to === "quickfix" ? "Quick fix tab" : "a task"}`)}`, 0, 0);
    },
  });
}

/** Tests: forget any request waiting for the oracle. */
export function clearPendingRequest(): void {
  pending = undefined;
}
