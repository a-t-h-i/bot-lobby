/**
 * The Plan tab: task planning mode. The conversation with the planner on one
 * side (its questions, your answers) and the draft plan converging on the
 * other, with the planner's verdict — still grilling, or ready to save.
 */
import type { PlannerMessage, PlannerReply, PlannerSeed } from "../planner.ts";
import type { PlannedTask } from "../../state/backlog.ts";
import { bold, columns, fill, markdownLines, paint, rule, spinner, split, tail, wrap, wrapHanging, type LobbyTheme } from "../layout.ts";

export interface PlanView {
  messages: readonly PlannerMessage[];
  reply?: PlannerReply;
  busy: boolean;
  step?: string;
  error?: string;
  turns: number;
  seed?: PlannerSeed;
  saved?: PlannedTask;
  title?: string;
}

export interface PlanTabInput {
  session?: PlanView;
  /** `provider/model · thinking` the planner runs on. */
  profile: string;
  offset: number;
  tick: number;
  notice?: string;
}

export const PLAN_COLUMNS_MIN = 100;

function intro(input: PlanTabInput, width: number, theme?: LobbyTheme): string[] {
  const text = [
    bold(theme, "Plan a task before anyone writes code."),
    "",
    "Describe what you want below. The planner reads the codebase and grills you — scope, edge cases, contracts, tests, rollout — a few pointed questions at a time, keeping a draft plan up to date until nothing is left open.",
    "",
    "When it is ready, press s to save it to the pending tasks list; start it from the Tasks tab whenever you like. To plan a GitHub issue, pick it in the Issues tab and press p.",
    "",
    paint(theme, "dim", `planner: ${input.profile}`),
  ];
  return text.flatMap((line) => wrap(line, width));
}

function statusLine(view: PlanView, input: PlanTabInput, theme?: LobbyTheme): string {
  const parts: string[] = [];
  if (view.busy) parts.push(`${paint(theme, "accent", spinner(input.tick))} ${view.step ?? "thinking"}…`);
  else if (view.error) parts.push(paint(theme, "error", `✗ ${view.error.split("\n")[0]} — esc, then r retries`));
  else if (view.reply?.status === "ready") parts.push(paint(theme, "success", "✓ READY — s saves it as a pending task"));
  else if (view.reply) parts.push(paint(theme, "warning", `● GRILLING · ${view.reply.questions.length} open question${view.reply.questions.length === 1 ? "" : "s"}`));
  if (view.saved) parts.push(paint(theme, "success", `saved as ${view.saved.id}`));
  if (view.turns > 0) parts.push(paint(theme, "dim", `round ${view.turns}`));
  return parts.join(paint(theme, "dim", " · ")) || paint(theme, "dim", "Answer below; enter sends.");
}

function conversationLines(view: PlanView, width: number, theme?: LobbyTheme): string[] {
  const lines: string[] = [];
  if (view.seed) {
    lines.push(...wrap(paint(theme, "dim", `from issue #${view.seed.issue.number} — ${view.seed.issue.title}`), width), "");
  }
  for (const message of view.messages) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    const lead = message.role === "you" ? `${bold(theme, paint(theme, "accent", "you"))} ${paint(theme, "dim", "▸")} ` : `${bold(theme, paint(theme, "toolTitle", "planner"))} ${paint(theme, "dim", "▸")} `;
    lines.push(...wrapHanging(lead, message.text, width));
  }
  return lines;
}

function draftLines(view: PlanView, width: number, theme?: LobbyTheme): string[] {
  const plan = view.reply?.plan;
  if (!plan) return wrap(paint(theme, "dim", view.busy ? "The draft appears after the planner's first turn." : "No draft yet."), width);
  return markdownLines(plan, width, theme);
}

export function renderPlan(input: PlanTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const notice = input.notice ? [paint(theme, "accent", input.notice)] : [];
  const view = input.session;
  if (!view) return fill([...notice, rule(width, "Plan", theme, input.profile), ...intro(input, width, theme)], height, width);
  const status = statusLine(view, input, theme);
  const header = [...notice, rule(width, view.title ? `Planning · ${view.title}` : "Planning", theme, input.profile), status];
  const bodyHeight = Math.max(0, height - header.length);
  if (width >= PLAN_COLUMNS_MIN) {
    const [left, right] = split(width, 0.5);
    const talk = fill([rule(left, "Conversation", theme), ...tail(conversationLines(view, left, theme), bodyHeight - 1, input.offset)], bodyHeight);
    const draft = fill([rule(right, view.reply?.status === "ready" ? "Plan ✓" : "Draft plan", theme), ...draftLines(view, right, theme)], bodyHeight);
    return fill([...header, ...columns(talk, draft, left, right, " │ ", theme)], height, width);
  }
  const talkHeight = Math.max(2, Math.ceil(bodyHeight * 0.55));
  const talk = [rule(width, "Conversation", theme), ...fill(tail(conversationLines(view, width, theme), talkHeight - 1, input.offset), talkHeight - 1)];
  const draft = [rule(width, "Draft plan", theme), ...draftLines(view, width, theme)];
  return fill([...header, ...talk, ...draft], height, width);
}
