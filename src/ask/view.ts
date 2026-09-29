/**
 * The questionnaire drawn: a chip per question, the question in Markdown, its
 * options (each with its description in Markdown), the row for your own
 * answer, and — when options carry one — the focused option's preview in a
 * box beside them (or under them in a narrow terminal). Pure: state in, lines
 * out, exactly `width` columns and at most `height` rows.
 */
import { basename } from "node:path";
import { textWidth } from "../width.ts";
import { beside, bold, box, fill, fit, markdownLines, paint, wrap, type LobbyTheme } from "../lobby/layout.ts";
import { imageLines, type ImagePreview } from "./image.ts";
import { isAnswered, type AskState } from "./state.ts";
import { OWN_ANSWER, type AskQuestion } from "./types.ts";

/** Terminals at least this wide show the preview beside the options. */
export const SIDE_BY_SIDE_MIN = 96;
/** Rows the preview box keeps at least, and at most. */
const PREVIEW_MIN = 6;
const PREVIEW_MAX = 40;
/** A preview box needs this many inner rows to draw an image in; smaller ones name the file. */
const IMAGE_MIN_ROWS = 6;
/** Option descriptions sit under their label, past the marker and number. */
const DESCRIPTION_INDENT = 7;

const RECOMMENDED = /\s*\(recommended\)\s*$/i;

function chips(state: AskState, theme?: LobbyTheme): string {
  if (state.questions.length === 1) return paint(theme, "muted", state.questions[0]!.header);
  return state.questions
    .map((question, index) => {
      const label = ` ${index + 1} ${question.header}${isAnswered(state, index) ? " ✓" : ""} `;
      if (index === state.tab) return bold(theme, paint(theme, "accent", `[${label.trim()}]`));
      return paint(theme, isAnswered(state, index) ? "success" : "muted", label.trim());
    })
    .join(paint(theme, "dim", "  ·  "));
}

function optionLabel(label: string, focused: boolean, theme?: LobbyTheme): string {
  const recommended = RECOMMENDED.test(label);
  const plain = label.replace(RECOMMENDED, "");
  const text = focused ? bold(theme, plain) : plain;
  return recommended ? `${text} ${paint(theme, "success", "(Recommended)")}` : text;
}

/** The options and the own-answer row, each option with its description beneath. */
function optionLines(state: AskState, question: AskQuestion, width: number, theme?: LobbyTheme): string[] {
  const cursor = state.cursor[state.tab] ?? 0;
  const picked = state.picked[state.tab] ?? [];
  const lines: string[] = [];
  question.options.forEach((option, index) => {
    const focused = cursor === index && !state.editing;
    const pointer = focused ? paint(theme, "accent", "›") : " ";
    const mark = question.multiSelect ? (picked.includes(index) ? "☑" : "☐") : picked.includes(index) ? "●" : "○";
    const lead = `${pointer} ${paint(theme, picked.includes(index) ? "accent" : "dim", mark)} ${paint(theme, "dim", `${index + 1}.`)} `;
    const labelLines = wrap(optionLabel(option.label, focused, theme), Math.max(1, width - textWidth(lead)));
    lines.push(`${lead}${labelLines[0] ?? ""}`, ...labelLines.slice(1).map((line) => `${" ".repeat(textWidth(lead))}${line}`));
    if (option.description?.trim()) {
      const indent = " ".repeat(DESCRIPTION_INDENT);
      for (const line of markdownLines(option.description.trim(), Math.max(1, width - DESCRIPTION_INDENT), theme)) lines.push(line ? `${indent}${paint(theme, "muted", line)}` : "");
    }
  });
  const ownFocused = cursor === question.options.length;
  const pointer = ownFocused || state.editing ? paint(theme, "accent", "›") : " ";
  const own = state.typed[state.tab];
  const lead = `${pointer} ${paint(theme, own ? "accent" : "dim", "✎")}    `;
  const room = Math.max(1, width - textWidth(lead));
  if (state.editing) {
    const draft = wrap(`${state.draft}▏`, room);
    lines.push(`${lead}${paint(theme, "accent", draft[0] ?? "")}`, ...draft.slice(1).map((line) => `${" ".repeat(textWidth(lead))}${paint(theme, "accent", line)}`));
  } else {
    lines.push(`${lead}${own ? paint(theme, "accent", `“${own}”`) : paint(theme, ownFocused ? "text" : "dim", OWN_ANSWER)}`);
  }
  return lines;
}

interface Preview {
  label: string;
  text: string;
  image?: string;
}

/** The preview to show: the focused option's, when any option in the question has one (Markdown or an image). */
function previewOf(state: AskState, question: AskQuestion): Preview | undefined {
  if (!question.options.some((option) => option.preview?.trim() || option.image?.trim())) return undefined;
  const cursor = state.cursor[state.tab] ?? 0;
  const option = question.options[cursor];
  if (!option) return { label: OWN_ANSWER, text: "" };
  return { label: option.label.replace(RECOMMENDED, ""), text: option.preview?.trim() ?? "", ...(option.image?.trim() ? { image: option.image.trim() } : {}) };
}

/** The image part of a preview: drawn when the box has room, else named. It never takes the box's last rows from the text entirely. */
function imageBlock(preview: Preview, inner: number, innerRows: number, textRows: number, frame: AskFrame, theme?: LobbyTheme): string[] {
  if (!preview.image) return [];
  const loaded = frame.images?.get(preview.image);
  const textRoom = textRows > 0 ? Math.min(textRows + 1, Math.max(2, Math.floor(innerRows / 3))) : 0;
  const rows = innerRows - textRoom;
  if (!loaded) return [paint(theme, "muted", `Image: ${preview.image}`)];
  if (rows < IMAGE_MIN_ROWS) return [paint(theme, "muted", `Image: ${basename(preview.image)} (the terminal is too small to draw it)`)];
  return imageLines(loaded, inner, rows, theme);
}

/** The preview in a box at most `rows` tall; an image keeps within `fits` rows, which the terminal surely shows. */
function previewBox(preview: Preview, width: number, rows: number, theme: LobbyTheme | undefined, frame: AskFrame, fits = rows): string[] {
  const inner = Math.max(1, width - 4);
  const text = preview.text ? markdownLines(preview.text, inner, theme) : [];
  const image = imageBlock(preview, inner, Math.min(rows, fits) - 2, text.length, frame, theme);
  const joined = [...image, ...(image.length > 0 && text.length > 0 ? [""] : []), ...text];
  const body = joined.length > 0 ? joined : [paint(theme, "dim", "No preview for this one.")];
  const height = Math.max(3, Math.min(rows, body.length + 2));
  const more = body.length > height - 2 ? `${body.length - (height - 2)} more lines` : "";
  return box(width, height, body, { title: `Preview · ${preview.label}`, ...(more ? { right: more } : {}), theme });
}

function hints(state: AskState, question: AskQuestion, width: number, theme?: LobbyTheme): string[] {
  if (state.leaving) return wrap(paint(theme, "warning", "Leave without answering? The oracle will not guess for you. enter leaves · any other key keeps answering"), width);
  const parts = state.editing
    ? ["enter keep it", "esc back to the options"]
    : [
        "↑↓ move",
        question.multiSelect ? "space pick · enter next" : "enter choose",
        `1-${question.options.length} pick`,
        ...(state.questions.length > 1 ? ["←→ questions"] : []),
        "esc leave",
      ];
  return wrap(paint(theme, "dim", parts.join(" · ")), width);
}

/** Around the questions: who is asking (an agent the oracle relays for), and the option images, read beforehand. */
export interface AskFrame {
  from?: string;
  images?: ReadonlyMap<string, ImagePreview>;
}

/** The whole questionnaire in a box, `width` wide and at most `height` rows. */
export function renderAsk(state: AskState, width: number, height: number, theme?: LobbyTheme, frame: AskFrame = {}): string[] {
  const question = state.questions[state.tab];
  if (!question || width < 20 || height < 6) return [];
  const inner = width - 4;
  const head = [chips(state, theme), "", ...markdownLines(question.question, inner, theme), ""];
  const foot = ["", ...hints(state, question, inner, theme)];
  const preview = previewOf(state, question);
  let body: string[];
  if (preview && inner >= SIDE_BY_SIDE_MIN) {
    const left = Math.floor(inner * 0.42);
    const options = optionLines(state, question, left, theme);
    const rows = Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, height - 2 - head.length - foot.length));
    const side = previewBox(preview, inner - left - 2, Math.max(rows, Math.min(options.length, PREVIEW_MAX)), theme, frame, rows);
    body = beside([fill(options, Math.max(options.length, side.length), left), side], "  ");
  } else {
    const options = optionLines(state, question, inner, theme);
    const room = height - 2 - head.length - foot.length - options.length - 1;
    body = preview && room >= 3 ? [...options, "", ...previewBox(preview, inner, Math.min(PREVIEW_MAX, room), theme, frame)] : options;
  }
  const content = [...head, ...body, ...foot];
  // Too tall for the terminal: the question and hints stay, the middle is cut.
  const fitted = content.length > height - 2 ? [...content.slice(0, height - 2 - foot.length), ...foot] : content;
  const count = state.questions.length > 1 ? `Question ${state.tab + 1} of ${state.questions.length}` : "Question";
  const title = frame.from ? `${frame.from} asks · ${count}` : count;
  return box(width, fitted.length + 2, fitted.map((line) => fit(line, inner)), { title, focused: true, theme });
}
