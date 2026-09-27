/**
 * The Plan tab: task planning mode with a planning panel. The roster shows
 * each seat — the oracle chairing, DEV, DESIGN, QA and RESEARCH — and what it
 * is doing; the conversation shows every seat's questions, attributed, with
 * their options and your answers; the draft pane shows the plan rendered as
 * Markdown, with a line cursor for commenting on a line, and what each seat
 * said the plan must respect.
 */
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { ORACLE_LABEL, type LineComment, type PanelNote, type PanelQuestion, type PlannerMessage, type PlannerReply, type PlannerSeed, type RoundMode } from "../planner.ts";
import type { PlannedTask } from "../../state/backlog.ts";
import { beside, bold, box, clock, fill, fit, italic, markdownLines, notePane, paint, selectRow, spinner, wrap, wrapHanging, type LobbyTheme, type PaneLayout } from "../layout.ts";
import { sourceColor, speakerLine, tailWindow, youLines } from "./home.ts";

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
  /** Rounds before the oracle finalizes alone; 0 = unlimited. */
  limit?: number;
  /** How the next round will run under the limit. */
  nextMode?: RoundMode;
  seed?: PlannerSeed;
  saved?: PlannedTask;
  title?: string;
  /** The round's questions wait for answers. */
  awaitingAnswers: boolean;
  /** Questionnaires already answered for this round. */
  answeredChunks: number;
  lineComments: readonly LineComment[];
}

/** Where the draft pane landed, so the lobby can map a click or the cursor to a line. */
export interface PlanLayout {
  /** First row of the draft's text inside the tab body, and its left column. */
  draftTop: number;
  draftLeft: number;
  draftWidth: number;
  /** Rows of draft text visible at once. */
  draftRows: number;
  /** Index of the first draft line shown. */
  draftStart: number;
  /** Every draft line, unstyled, in order. */
  draftText: string[];
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
  /** The draft line the cursor is on, while the draft has the focus. */
  cursor?: number;
  tick: number;
  notice?: string;
  query?: string;
  /** Filled with the draft pane's geometry during render. */
  layout?: PlanLayout;
  /** Filled with where the conversation (`talk`) and the draft landed, for scrolling. */
  panes?: PaneLayout;
  /** The key that saves the plan, as the status line names it. */
  saveKey?: string;
  /** The planning round limit before a session exists; 0 = unlimited. */
  limit?: number;
}

export const PLAN_COLUMNS_MIN = 100;
const LABEL_WIDTH = 8;

/** Before a session: one sentence, then who sits on the panel and the model each runs on. */
function intro(input: PlanTabInput, width: number, theme?: LobbyTheme): string[] {
  const rows = input.seats.map((seat) => {
    const name = paint(theme, seat.seated ? sourceColor(seat.label) : "dim", seat.label.padEnd(LABEL_WIDTH + 2));
    const model = seat.label === ORACLE_LABEL ? input.profile : seat.seated ? seat.profile ?? "" : "not seated";
    return fit(`${name}${paint(theme, seat.seated ? "muted" : "dim", model)}`, width);
  });
  const bound = input.limit && input.limit > 0 ? ` (at most ${input.limit} rounds; the last one the oracle settles alone)` : "";
  return [...wrap(bold(theme, `Describe a task below and the panel questions you until the plan is clear${bound}.`), width), "", ...rows];
}

/** `round 3/5`, `final round 5/5` or `round 6 · revising` under a limit; `round 3` without one. */
export function roundLabel(turns: number, limit = 0): string {
  if (limit <= 0) return `round ${turns}`;
  if (turns > limit) return `round ${turns} · past the limit, revising`;
  return turns === limit ? `final round ${turns}/${limit}` : `round ${turns}/${limit}`;
}

function statusLine(view: PlanView, input: PlanTabInput, theme?: LobbyTheme): string {
  const parts: string[] = [];
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (view.busy) parts.push(`${paint(theme, "accent", spinner(input.tick))} ${roundLabel(view.turns, view.limit)}`);
  else if (view.error) parts.push(paint(theme, "error", `✗ ${view.error.split("\n")[0]} — r retries`));
  else if (view.reply?.status === "ready") parts.push(paint(theme, "success", `✓ ready — ${input.saveKey ?? "Ctrl+S"} saves it`));
  else if (view.awaitingAnswers) parts.push(paint(theme, "warning", `● ${count(view.questions.length, "question")} — enter ${view.answeredChunks > 0 ? "resumes" : "answers them"}`));
  if (view.lineComments.length > 0) parts.push(paint(theme, "accent", `◆ ${count(view.lineComments.length, "comment")} to send`));
  if (view.saved) parts.push(paint(theme, "success", `saved as ${view.saved.id}`));
  if (!view.busy && view.turns > 0) parts.push(paint(theme, "dim", roundLabel(view.turns, view.limit)));
  if (!view.busy && view.nextMode === "final") parts.push(paint(theme, "warning", "the next round is the last: the oracle settles the rest"));
  return parts.join(paint(theme, "dim", " · "));
}

/** One seat on the roster: a spinner and its step while it works, then ready, its question count or a failure. */
function seatCell(seat: SeatView, tick: number, theme?: LobbyTheme): string {
  const name = paint(theme, seat.seated ? sourceColor(seat.label) : "dim", seat.label);
  if (!seat.seated) return `${name} ${paint(theme, "dim", "off")}`;
  if (seat.status === "thinking") return `${name} ${paint(theme, "accent", spinner(tick))} ${paint(theme, "muted", seat.step ?? "thinking")}`;
  if (seat.status === "failed") return `${name} ${paint(theme, "error", "✗ failed — r retries")}`;
  if (seat.status === "idle") return `${name} ${paint(theme, "dim", "·")}`;
  if (seat.ready) return `${name} ${paint(theme, "success", "✓ ready")}`;
  // A seat whose questions the oracle settled itself has nothing waiting on you.
  if (seat.questions === 0) return `${name} ${paint(theme, "dim", "done")}`;
  return `${name} ${paint(theme, "warning", `${seat.questions} question${seat.questions === 1 ? "" : "s"}`)}`;
}

/** The panel roster; while working, each seat's current step, so one busy seat does not look like a hang. */
export function rosterLines(view: PlanView, width: number, tick: number, theme?: LobbyTheme): string[] {
  const cells = view.seats.map((seat) => seatCell(seat, tick, theme));
  return wrap(`${paint(theme, "dim", "panel")}  ${cells.join(paint(theme, "dim", " · "))}`, width);
}

/** Each question numbered as the panel asked it (a search may show only some), with its options beneath. */
function questionLines(questions: ReadonlyArray<{ question: PanelQuestion; number: number }>, width: number, theme?: LobbyTheme): string[] {
  return questions.flatMap(({ question, number }) => {
    const lead = `${paint(theme, "dim", `${String(number).padStart(2)}.`)} ${bold(theme, paint(theme, sourceColor(question.from), question.from.padEnd(LABEL_WIDTH)))} `;
    const indent = " ".repeat(4 + LABEL_WIDTH);
    const options = question.options.map((option) => wrapHanging(`${indent}${paint(theme, "dim", "○")} `, `${option.label}${option.description ? paint(theme, "dim", ` — ${option.description}`) : ""}`, width)).flat();
    return [...wrapHanging(lead, question.text, width), ...options];
  });
}

function matches(text: string, query: string | undefined): boolean {
  return !query || text.toLowerCase().includes(query.toLowerCase());
}

export function conversationLines(view: PlanView, width: number, theme?: LobbyTheme, query?: string): string[] {
  const lines: string[] = [];
  if (view.seed) {
    lines.push(...wrap(paint(theme, "dim", `from issue #${view.seed.issue.number} — ${view.seed.issue.title}`), width), "");
  }
  for (const message of view.messages) {
    const questions = (message.questions ?? [])
      .map((question, index) => ({ question, number: index + 1 }))
      .filter(({ question }) => matches(`${question.from} ${question.text} ${question.options.map((option) => option.label).join(" ")}`, query));
    if (message.role === "you" ? !matches(message.text, query) : message.questions?.length ? questions.length === 0 : !matches(message.text, query)) continue;
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    // The same turns as the Lobby's conversation: who speaks and when, your words in a band.
    const time = message.at > 0 ? clock(message.at) : "";
    if (message.role === "you") {
      lines.push(speakerLine("you", width, theme, time), ...youLines(message.text, width, theme));
      continue;
    }
    lines.push(speakerLine("panel", width, theme, time));
    lines.push(...(questions.length > 0 ? questionLines(questions, width, theme) : wrap(message.text, width).map((line) => (line ? `  ${line}` : ""))));
  }
  if (query && lines.length === 0) return wrap(paint(theme, "dim", `Nothing in the conversation matches "${query}".`), width);
  return lines;
}

interface DraftLine {
  text: string;
  plain: string;
}

/** The draft as lines: the plan in Markdown, commented lines marked with their comments beneath, then each seat's needs. */
export function draftLines(view: PlanView, width: number, theme?: LobbyTheme): DraftLine[] {
  const plan = view.reply?.plan;
  const line = (text: string): DraftLine => ({ text, plain: stripTerminalSequences(text).trimEnd() });
  if (!plan) return wrap(paint(theme, "dim", view.busy ? "The draft appears after the panel's first round." : "No draft yet."), width).map(line);
  const comments = new Map<string, string[]>();
  for (const comment of view.lineComments) comments.set(comment.line, [...(comments.get(comment.line) ?? []), comment.text]);
  const lines: DraftLine[] = [];
  for (const rendered of markdownLines(plan, Math.max(1, width - 2), theme)) {
    const entry = line(rendered);
    const notes = comments.get(entry.plain.trim());
    lines.push({ text: `${notes ? paint(theme, "warning", "◆") : " "} ${rendered}`, plain: entry.plain });
    for (const note of notes ?? []) {
      for (const wrapped of wrap(italic(theme, paint(theme, "accent", `↳ ${note}`)), Math.max(1, width - 4))) lines.push({ text: `    ${wrapped}`, plain: entry.plain });
    }
  }
  if (view.notes.length > 0) {
    lines.push(line(""), line(bold(theme, paint(theme, "mdHeading", "What each seat needs"))));
    for (const note of view.notes) for (const wrapped of wrapHanging(`${paint(theme, sourceColor(note.from), note.from.padEnd(LABEL_WIDTH))} `, note.text, width)) lines.push(line(wrapped));
  }
  return lines;
}

export function renderPlan(input: PlanTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const notice = input.notice ? [paint(theme, "accent", input.notice)] : [];
  const view = input.session;
  if (!view) return fill([...notice, ...box(width, height - notice.length, intro(input, width - 4, theme), { title: "Plan", theme })], height, width);
  const header = [
    ...notice,
    ...wrap(`${bold(theme, view.title ? `Planning · ${view.title}` : "Planning")}  ${statusLine(view, input, theme)}`, width),
    ...rosterLines(view, width, input.tick, theme),
  ];
  const bodyHeight = Math.max(0, height - header.length);
  const wide = width >= PLAN_COLUMNS_MIN;
  const talkWidth = wide ? Math.round((width - 1) * 0.46) : width;
  const draftWidth = wide ? width - 1 - talkWidth : width;
  const talkHeight = wide ? bodyHeight : Math.max(3, Math.ceil(bodyHeight * 0.5));
  const draftHeight = wide ? bodyHeight : bodyHeight - talkHeight;
  const talkLines = conversationLines(view, talkWidth - 4, theme, input.query);
  const talkView = tailWindow(talkLines, talkHeight - 2, input.offset);
  const talkNote = [talkView.offset > 0 ? `↓${talkView.offset}` : "", input.query ? "filtered" : ""].filter(Boolean).join(" · ");
  const talk = box(talkWidth, talkHeight, talkView.shown, { title: "Conversation", ...(talkNote ? { right: talkNote } : {}), focused: input.focus === "talk", scroll: { total: talkLines.length, start: talkView.start }, theme });
  notePane(input.panes, "talk", header.length, 0, talkWidth, talkHeight, talkLines.length);
  const draft = draftLines(view, draftWidth - 4, theme);
  const rows = Math.max(0, draftHeight - 2);
  const start = Math.max(0, Math.min(input.draftOffset, Math.max(0, draft.length - rows)));
  const cursor = input.focus === "draft" ? input.cursor : undefined;
  const shown = draft.slice(start, start + rows).map((entry, index) => selectRow(theme, entry.text, draftWidth - 4, start + index === cursor, true));
  const draftTitle = view.reply?.status === "ready" ? "Plan ✓" : "Draft plan";
  const position = draft.length > rows ? `${start + 1}-${Math.min(draft.length, start + rows)}/${draft.length}` : "";
  const draftPane = draftHeight >= 3 ? box(draftWidth, draftHeight, shown, { title: draftTitle, ...(position ? { right: position } : {}), focused: input.focus === "draft", scroll: { total: draft.length, start }, theme }) : [];
  if (draftHeight >= 3) notePane(input.panes, "draft", header.length + (wide ? 0 : talkHeight), wide ? talkWidth + 1 : 0, draftWidth, draftHeight, draft.length);
  if (input.layout) {
    Object.assign(input.layout, {
      draftTop: header.length + (wide ? 0 : talkHeight) + 1,
      draftLeft: (wide ? talkWidth + 1 : 0) + 2,
      draftWidth: draftWidth - 4,
      draftRows: rows,
      draftStart: start,
      draftText: draft.map((entry) => entry.plain),
    } satisfies PlanLayout);
  }
  const body = wide ? beside([talk, draftPane]) : [...talk, ...draftPane];
  return fill([...header, ...body], height, width);
}
