/**
 * The questionnaire as state and keys, with no terminal in sight: each key
 * press is one pure step, so every path (pick, toggle, type your own answer,
 * move between questions, submit, cancel) is tested directly.
 *
 * Every question lists its options, then a row for the user's own answer.
 * Enter on an option answers a single-choice question and moves on; space
 * toggles options of a multi-choice one and enter moves on. Answering the
 * last question submits; ←/→ move between questions first. Esc stops typing,
 * or puts the questions away.
 */
import type { AskAnswer, AskQuestion, AskResult } from "./types.ts";

export type AskKey =
  | { type: "up" }
  | { type: "down" }
  | { type: "left" }
  | { type: "right" }
  | { type: "enter" }
  | { type: "space" }
  | { type: "escape" }
  | { type: "backspace" }
  /** 1-9: pick (or toggle) that option. */
  | { type: "digit"; value: number }
  /** Typed or pasted text, only used while writing an answer. */
  | { type: "text"; value: string };

export interface AskState {
  questions: readonly AskQuestion[];
  /** The question in view. */
  tab: number;
  /** The focused row of each question: an option index, or `options.length` for the own-answer row. */
  cursor: number[];
  /** Options picked in each question (one for a single-choice question). */
  picked: number[][];
  /** The user's own answer to each question, when they wrote one. */
  typed: Array<string | undefined>;
  /** Writing the own answer of the question in view. */
  editing: boolean;
  draft: string;
  /** Esc was pressed: asked whether to leave without answering; enter leaves, any other key keeps answering. */
  leaving?: boolean;
  /** Set once the user submits or puts the questions away. */
  result?: AskResult;
}

/** The questions put away, with what was answered so far (also when something outside ends them). */
export function putAway(state: AskState): AskState {
  return { ...state, editing: false, draft: "", leaving: false, result: { answers: answersOf(state), cancelled: true } };
}

export function initialState(questions: readonly AskQuestion[]): AskState {
  return {
    questions,
    tab: 0,
    cursor: questions.map(() => 0),
    picked: questions.map(() => []),
    typed: questions.map(() => undefined),
    editing: false,
    draft: "",
  };
}

/** Whether a question has an answer yet. */
export function isAnswered(state: AskState, index: number): boolean {
  return (state.picked[index]?.length ?? 0) > 0 || Boolean(state.typed[index]?.trim());
}

/** The answers given, in the order asked; unanswered questions are left out. */
export function answersOf(state: AskState): AskAnswer[] {
  const answers: AskAnswer[] = [];
  state.questions.forEach((question, index) => {
    const picked = (state.picked[index] ?? []).map((option) => question.options[option]!.label);
    const own = state.typed[index]?.trim();
    if (question.multiSelect) {
      const selected = own ? [...picked, own] : picked;
      if (selected.length > 0) answers.push({ questionIndex: index, question: question.question, kind: "multi", answer: selected.join(", "), selected });
    } else if (own) answers.push({ questionIndex: index, question: question.question, kind: "custom", answer: own });
    else if (picked[0]) answers.push({ questionIndex: index, question: question.question, kind: "option", answer: picked[0] });
  });
  return answers;
}

function set<T>(list: readonly T[], index: number, value: T): T[] {
  const next = [...list];
  next[index] = value;
  return next;
}

/** The next question, or the submitted result after the last one. */
function advance(state: AskState): AskState {
  if (state.tab < state.questions.length - 1) return { ...state, tab: state.tab + 1, editing: false, draft: "" };
  return { ...state, editing: false, draft: "", result: { answers: answersOf(state), cancelled: false } };
}

function choose(state: AskState, option: number): AskState {
  const question = state.questions[state.tab]!;
  if (option < 0 || option >= question.options.length) return state;
  if (question.multiSelect) {
    const picked = state.picked[state.tab] ?? [];
    const next = picked.includes(option) ? picked.filter((entry) => entry !== option) : [...picked, option].sort((a, b) => a - b);
    return { ...state, cursor: set(state.cursor, state.tab, option), picked: set(state.picked, state.tab, next) };
  }
  // One answer to a single-choice question: picking an option replaces any words of the user's own.
  return advance({ ...state, cursor: set(state.cursor, state.tab, option), picked: set(state.picked, state.tab, [option]), typed: set(state.typed, state.tab, undefined) });
}

function typing(state: AskState, key: AskKey): AskState {
  switch (key.type) {
    case "text":
      return { ...state, draft: state.draft + key.value.replace(/[\r\n\t]+/g, " ") };
    case "space":
      return { ...state, draft: `${state.draft} ` };
    case "digit":
      return { ...state, draft: state.draft + String(key.value) };
    case "backspace":
      return { ...state, draft: [...state.draft].slice(0, -1).join("") };
    case "escape":
      return { ...state, editing: false, draft: "" };
    case "enter": {
      const own = state.draft.trim();
      const question = state.questions[state.tab]!;
      const typed = set(state.typed, state.tab, own || undefined);
      // Your own words answer a single-choice question instead of a picked option.
      const picked = own && !question.multiSelect ? set(state.picked, state.tab, []) : state.picked;
      const next = { ...state, typed, picked, editing: false, draft: "" };
      return own ? advance(next) : next;
    }
    default:
      return state;
  }
}

/** One key press. */
export function step(state: AskState, key: AskKey): AskState {
  if (state.result) return state;
  // Esc asks first: leaving the questions unanswered lets the oracle carry on without you, so it takes a second key.
  if (state.leaving) return key.type === "enter" || (key.type === "text" && key.value.toLowerCase() === "y") ? putAway(state) : { ...state, leaving: false };
  if (state.editing) return typing(state, key);
  const question = state.questions[state.tab];
  if (!question) return { ...state, result: { answers: [], cancelled: false } };
  const rows = question.options.length + 1;
  const cursor = state.cursor[state.tab] ?? 0;
  switch (key.type) {
    case "up":
      return { ...state, cursor: set(state.cursor, state.tab, (cursor - 1 + rows) % rows) };
    case "down":
      return { ...state, cursor: set(state.cursor, state.tab, (cursor + 1) % rows) };
    case "left":
      return state.tab > 0 ? { ...state, tab: state.tab - 1 } : state;
    case "right":
      return state.tab < state.questions.length - 1 ? { ...state, tab: state.tab + 1 } : state;
    case "digit":
      return choose(state, key.value - 1);
    case "space":
      return cursor < question.options.length && question.multiSelect ? choose(state, cursor) : state;
    case "enter": {
      if (cursor === question.options.length) return { ...state, editing: true, draft: state.typed[state.tab] ?? "" };
      if (!question.multiSelect) return choose(state, cursor);
      // A multi-choice question moves on with what is picked; with nothing picked, enter picks the focused option.
      if (!isAnswered(state, state.tab)) return advance(choose(state, cursor));
      return advance(state);
    }
    case "escape":
      return { ...state, leaving: true };
    default:
      return state;
  }
}
