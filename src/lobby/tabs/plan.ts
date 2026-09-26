/**
 * The Plan tab: task planning mode with a planning panel. The roster shows
 * each seat — the oracle chairing, DEV, DESIGN, QA and RESEARCH — and what it
 * is doing; the conversation shows every seat's questions, attributed, with
 * your answers; the other pane shows the draft plan converging and what each
 * seat said the plan must respect.
 */
import { ORACLE_LABEL, type PanelNote, type PanelQuestion, type PlannerMessage, type PlannerReply, type PlannerSeed } from "../planner.ts";
import type { PlannedTask } from "../../state/backlog.ts";
import { bold, columns, fill, markdownLines, paint, rule, spinner, split, tail, wrap, wrapHanging, type LobbyTheme } from "../layout.ts";
import { sourceColor } from "./home.ts";

export interface SeatView {
  label: string;
  /** Sits on the panel next round. */
  seated: boolean;
  status: "idle" | "thinking" | "done" | "failed";
  step?: string;
  /** Open questions it asked in the latest round. */
  questions: number;
  ready: boolean;
  /** `provider/model · thinking` the seat runs on. */
  profile?: string;
}

export interface PlanView {
  messages: readonly PlannerMessage[];
  reply?: PlannerReply;
  questions: readonly PanelQuestion[];
  notes: readonly PanelNote[];
  seats: readonly SeatView[];
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
  /** `provider/model · thinking` the oracle plans on. */
  profile: string;
  /** The seats as they would sit before a session exists. */
  seats: readonly SeatView[];
  offset: number;
  focus: "talk" | "draft";
  draftOffset: number;
  tick: number;
  notice?: string;
}

export const PLAN_COLUMNS_MIN = 100;
const LABEL_WIDTH = 8;

function intro(input: PlanTabInput, width: number, theme?: LobbyTheme): string[] {
  // The roster leads with the chair; the intro names it separately.
  const members = input.seats.filter((seat) => seat.label !== ORACLE_LABEL);
  const seats = members.filter((seat) => seat.seated).map((seat) => seat.label);
  const text = [
    bold(theme, "Plan a task with the whole team before anyone writes code."),
    "",
    `Describe what you want below. The planning panel — the oracle chairing${seats.length > 0 ? `, with ${seats.join(", ")}` : ""} — reads the codebase and grills you, each seat from its own domain: contracts and data, flows and states, acceptance criteria and tests, libraries and prior art. You answer everyone in one conversation, and the oracle folds every answer into the draft plan, so all the agents start from the same decisions.`,
    "",
    "When the panel agrees the plan is clear, press s to save it to the pending tasks list; start it from the Tasks tab whenever you like. To plan a GitHub issue, pick it in the Issues tab and press p. While browsing (esc), 1-4 seat or unseat DEV, DESIGN, QA and RESEARCH.",
    "",
    paint(theme, "dim", `oracle: ${input.profile}`),
    ...members.map((seat) => paint(theme, "dim", `${seat.label.toLowerCase()}: ${seat.seated ? seat.profile ?? "" : "not seated"}`)),
  ];
  return text.flatMap((line) => wrap(line, width));
}

function statusLine(view: PlanView, input: PlanTabInput, theme?: LobbyTheme): string {
  const parts: string[] = [];
  if (view.busy) parts.push(`${paint(theme, "accent", spinner(input.tick))} round ${view.turns}`);
  else if (view.error) parts.push(paint(theme, "error", `✗ ${view.error.split("\n")[0]} — esc, then r retries`));
  else if (view.reply?.status === "ready") parts.push(paint(theme, "success", "✓ READY — the panel agrees; s saves it as a pending task"));
  else if (view.messages.some((message) => message.role === "planner")) parts.push(paint(theme, "warning", `● GRILLING · ${view.questions.length} open question${view.questions.length === 1 ? "" : "s"}`));
  if (view.saved) parts.push(paint(theme, "success", `saved as ${view.saved.id}`));
  if (!view.busy && view.turns > 0) parts.push(paint(theme, "dim", `round ${view.turns}`));
  return parts.join(paint(theme, "dim", " · ")) || paint(theme, "dim", "Answer below; enter sends.");
}

/** One seat on the roster: a spinner and its step while it works, then ready, its question count or a failure. */
function seatCell(seat: SeatView, tick: number, theme?: LobbyTheme): string {
  const name = paint(theme, seat.seated ? sourceColor(seat.label) : "dim", seat.label);
  if (!seat.seated) return `${name} ${paint(theme, "dim", "off")}`;
  if (seat.status === "thinking") return `${name} ${paint(theme, "accent", spinner(tick))} ${paint(theme, "muted", seat.step ?? "thinking")}`;
  if (seat.status === "failed") return `${name} ${paint(theme, "error", "✗ failed — r retries")}`;
  if (seat.status === "idle") return `${name} ${paint(theme, "dim", "·")}`;
  if (seat.ready) return `${name} ${paint(theme, "success", "✓ ready")}`;
  return `${name} ${paint(theme, "warning", `${seat.questions} question${seat.questions === 1 ? "" : "s"}`)}`;
}

/** The panel roster; while working, each seat's current step, so one busy seat does not look like a hang. */
export function rosterLines(view: PlanView, width: number, tick: number, theme?: LobbyTheme): string[] {
  const cells = view.seats.map((seat) => seatCell(seat, tick, theme));
  return wrap(`${paint(theme, "dim", "panel")}  ${cells.join(paint(theme, "dim", " · "))}`, width);
}

function questionLines(questions: readonly PanelQuestion[], width: number, theme?: LobbyTheme): string[] {
  return questions.flatMap((question, index) => {
    const lead = `${paint(theme, "dim", `${String(index + 1).padStart(2)}.`)} ${bold(theme, paint(theme, sourceColor(question.from), question.from.padEnd(LABEL_WIDTH)))} `;
    return wrapHanging(lead, question.text, width);
  });
}

export function conversationLines(view: PlanView, width: number, theme?: LobbyTheme): string[] {
  const lines: string[] = [];
  if (view.seed) {
    lines.push(...wrap(paint(theme, "dim", `from issue #${view.seed.issue.number} — ${view.seed.issue.title}`), width), "");
  }
  for (const message of view.messages) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    if (message.role === "you") {
      lines.push(...wrapHanging(`${bold(theme, paint(theme, "accent", "you"))} ${paint(theme, "dim", "▸")} `, message.text, width));
      continue;
    }
    lines.push(`${bold(theme, paint(theme, "toolTitle", "panel"))} ${paint(theme, "dim", "▸")}`);
    lines.push(...(message.questions && message.questions.length > 0 ? questionLines(message.questions, width, theme) : wrap(message.text, width)));
  }
  return lines;
}

export function draftLines(view: PlanView, width: number, theme?: LobbyTheme): string[] {
  const plan = view.reply?.plan;
  const lines = plan ? markdownLines(plan, width, theme) : wrap(paint(theme, "dim", view.busy ? "The draft appears after the panel's first round." : "No draft yet."), width);
  if (view.notes.length === 0) return lines;
  lines.push("", rule(width, "What each seat needs", theme));
  for (const note of view.notes) lines.push(...wrapHanging(`${paint(theme, sourceColor(note.from), note.from.padEnd(LABEL_WIDTH))} `, note.text, width));
  return lines;
}

export function renderPlan(input: PlanTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const notice = input.notice ? [paint(theme, "accent", input.notice)] : [];
  const view = input.session;
  if (!view) return fill([...notice, rule(width, "Plan", theme, input.profile), ...intro(input, width, theme)], height, width);
  const header = [
    ...notice,
    rule(width, view.title ? `Planning · ${view.title}` : "Planning", theme, input.profile),
    statusLine(view, input, theme),
    ...rosterLines(view, width, input.tick, theme),
  ];
  const bodyHeight = Math.max(0, height - header.length);
  const draftTitle = `${view.reply?.status === "ready" ? "Plan ✓" : "Draft plan"}${input.focus === "draft" ? " ◂" : ""}`;
  const talkTitle = `Conversation${input.focus === "talk" ? " ◂" : ""}`;
  if (width >= PLAN_COLUMNS_MIN) {
    const [left, right] = split(width, 0.5);
    const talk = fill([rule(left, talkTitle, theme), ...tail(conversationLines(view, left, theme), bodyHeight - 1, input.offset)], bodyHeight);
    const draft = draftLines(view, right, theme);
    const draftPane = fill([rule(right, draftTitle, theme), ...draft.slice(Math.max(0, Math.min(input.draftOffset, draft.length - 1)))], bodyHeight);
    return fill([...header, ...columns(talk, draftPane, left, right, " │ ", theme)], height, width);
  }
  const talkHeight = Math.max(2, Math.ceil(bodyHeight * 0.55));
  const talk = [rule(width, talkTitle, theme), ...fill(tail(conversationLines(view, width, theme), talkHeight - 1, input.offset), talkHeight - 1)];
  const draft = draftLines(view, width, theme);
  return fill([...header, ...talk, rule(width, draftTitle, theme), ...draft.slice(Math.max(0, Math.min(input.draftOffset, draft.length - 1)))], height, width);
}
