/**
 * Putting questions to the user. In pi's terminal the questionnaire opens as
 * an overlay (over the lobby too) with Markdown throughout and each option's
 * preview beside it. Where pi cannot draw one — RPC mode, which background
 * sessions and editor hosts run in — the same questions go through pi's own
 * select and input dialogs, which those hosts do forward.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import type { LobbyTheme } from "../lobby/layout.ts";
import { lobbyTheme } from "../lobby/theme.ts";
import { initialState, step, type AskKey, type AskState } from "./state.ts";
import { renderAsk } from "./view.ts";
import type { AskAnswer, AskQuestion, AskResult } from "./types.ts";

/** Puts up to `MAX_QUESTIONS` questions to the user and returns what they chose. */
export type Asker = (questions: readonly AskQuestion[], ctx: ExtensionContext, signal?: AbortSignal) => Promise<AskResult>;

/** Share of the terminal the overlay may take. */
const OVERLAY_HEIGHT = 0.9;

/** A key press as the questionnaire reads it; undefined for keys it ignores. */
export function readKey(data: string): AskKey | undefined {
  if (matchesKey(data, Key.up)) return { type: "up" };
  if (matchesKey(data, Key.down)) return { type: "down" };
  if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) return { type: "left" };
  if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) return { type: "right" };
  if (matchesKey(data, Key.enter)) return { type: "enter" };
  if (matchesKey(data, Key.escape)) return { type: "escape" };
  if (matchesKey(data, Key.backspace)) return { type: "backspace" };
  if (data === " ") return { type: "space" };
  if (/^[1-9]$/.test(data)) return { type: "digit", value: Number(data) };
  // Typed or pasted text: anything printable (control sequences are dropped).
  const text = [...data].filter((char) => char >= " " && char !== "\x7f").join("");
  if (text && !data.startsWith("\x1b")) return { type: "text", value: text };
  return undefined;
}

/** The questionnaire as a pi component: keys step its state, each frame draws it. */
export class AskDialog implements Component {
  private state: AskState;
  private readonly tui: TUI;
  private readonly theme: LobbyTheme;
  private readonly done: (result: AskResult) => void;

  constructor(tui: TUI, theme: LobbyTheme, questions: readonly AskQuestion[], done: (result: AskResult) => void) {
    this.tui = tui;
    this.theme = theme;
    this.state = initialState(questions);
    this.done = done;
  }

  handleInput(data: string): void {
    const key = readKey(data);
    if (!key) return;
    this.state = step(this.state, key);
    if (this.state.result) this.done(this.state.result);
    else this.tui.requestRender();
  }

  /** Put the questions away from outside (the turn was aborted). */
  cancel(): void {
    if (!this.state.result) this.handleInput("\x1b");
  }

  render(width: number): string[] {
    return renderAsk(this.state, width, Math.max(8, Math.floor(this.tui.terminal.rows * OVERLAY_HEIGHT)), this.theme);
  }

  invalidate(): void {}
}

/**
 * The questions in pi's terminal, or through its plain dialogs where it
 * cannot draw the questionnaire. Without any UI nobody can answer: the
 * result says the questions were put away.
 */
export const askUser: Asker = async (questions, ctx, signal) => {
  if (!ctx.hasUI || questions.length === 0) return { answers: [], cancelled: true };
  if ((ctx as { mode?: string }).mode === "rpc") return dialogAsker(questions, ctx, signal);
  let dialog: AskDialog | undefined;
  const onAbort = () => dialog?.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await ctx.ui.custom<AskResult>((tui, theme, _keys, done) => {
      dialog = new AskDialog(tui, lobbyTheme(theme), questions, done);
      if (signal?.aborted) queueMicrotask(onAbort);
      return dialog;
    }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center", margin: 1 } });
    // A host that cannot draw custom components resolves at once with nothing.
    return result ?? dialogAsker(questions, ctx, signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
};

const TYPE_ANSWER = "Type an answer…";
const SKIP = "Skip";
const DONE = "Done";
/** Longest description or preview folded into a plain dialog's title. */
const MAX_FOLDED = 600;

/** A question as one plain dialog's title: the question, then each option's description and preview. */
function dialogTitle(question: AskQuestion, index: number, total: number): string {
  const details = question.options
    .map((option) => [option.description?.trim() ? `${option.label}: ${option.description.trim()}` : "", option.preview?.trim() ? `--- ${option.label} ---\n${option.preview.trim().slice(0, MAX_FOLDED)}` : ""].filter(Boolean).join("\n"))
    .filter(Boolean);
  return [`${question.header} · ${index + 1}/${total}`, question.question, ...details].join("\n\n");
}

/** The same questions through pi's select and input dialogs: pick, type an answer, or skip; esc stops. */
export const dialogAsker: Asker = async (questions, ctx) => {
  const answers: AskAnswer[] = [];
  for (const [index, question] of questions.entries()) {
    const title = dialogTitle(question, index, questions.length);
    if (question.multiSelect) {
      const selected: string[] = [];
      for (;;) {
        const left = question.options.map((option) => option.label).filter((label) => !selected.includes(label));
        const choice = await ctx.ui.select(`${title}${selected.length > 0 ? `\n\nPicked: ${selected.join(", ")}` : ""}`, [...left, TYPE_ANSWER, selected.length > 0 ? DONE : SKIP]);
        if (choice === undefined) return { answers, cancelled: true };
        if (choice === DONE || choice === SKIP) break;
        if (choice === TYPE_ANSWER) {
          const typed = await ctx.ui.input(question.question, "your answer");
          if (typed === undefined) return { answers, cancelled: true };
          if (typed.trim()) selected.push(typed.trim());
          break;
        }
        selected.push(choice);
        if (left.length === 1) break;
      }
      if (selected.length > 0) answers.push({ questionIndex: index, question: question.question, kind: "multi", answer: selected.join(", "), selected });
      continue;
    }
    const choice = await ctx.ui.select(title, [...question.options.map((option) => option.label), TYPE_ANSWER, SKIP]);
    if (choice === undefined) return { answers, cancelled: true };
    if (choice === SKIP) continue;
    if (choice === TYPE_ANSWER) {
      const typed = await ctx.ui.input(question.question, "your answer");
      if (typed === undefined) return { answers, cancelled: true };
      if (typed.trim()) answers.push({ questionIndex: index, question: question.question, kind: "custom", answer: typed.trim() });
      continue;
    }
    answers.push({ questionIndex: index, question: question.question, kind: "option", answer: choice });
  }
  return { answers, cancelled: false };
};
