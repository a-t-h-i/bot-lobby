/**
 * The Lobby tab: the zen scene of this session's task on top, then the
 * conversation with the oracle (text only, no tool rows, no thinking), the
 * activity log of plain-words steps from every agent, and the one place where
 * thoughts show up. Pure: the scene arrives as a callback, the clock as `now`.
 */
import type { Task } from "../../schemas/task.ts";
import type { ActivityEntry, ChatEntry, ThoughtEntry } from "../feed.ts";
import { bold, since, clock, columns, fill, italic, paint, rule, spinner, split, tail, wrap, wrapHanging, type LobbyColor, type LobbyTheme } from "../layout.ts";

export interface HomeInput {
  task?: Task;
  /** Draws the zen scene into at most `height` lines; absent when no task is active. */
  scene?: (width: number, height: number) => string[];
  chat: readonly ChatEntry[];
  /** The oracle's reply while it streams. */
  liveReply?: string;
  activity: readonly ActivityEntry[];
  thoughts: readonly ThoughtEntry[];
  /** The Master's turn is running. */
  busy: boolean;
  /** Active tasks owned by other sessions, and saved plans waiting to start. */
  others: number;
  pending: number;
  /** Lines of conversation scrollback. */
  chatOffset: number;
  tick: number;
  now: number;
}

/** Wide terminals put the conversation and the activity log side by side. */
export const HOME_COLUMNS_MIN = 100;
/** Most lines the scene may take, and its share of the body. */
const SCENE_SHARE = 0.45;
const MAX_SCENE = 36;

const SOURCE_COLORS: Record<string, LobbyColor> = {
  MASTER: "accent",
  DEV: "success",
  DESIGN: "mdHeading",
  QA: "warning",
  RESEARCH: "toolTitle",
  "QUICK FIX": "mdCode",
  PLANNER: "toolTitle",
  LOBBY: "muted",
};

export function sourceColor(source: string): LobbyColor {
  return SOURCE_COLORS[source] ?? "muted";
}

const SOURCE_WIDTH = 9;

/** One activity line: time, who, what; a running step spins, a finished one is marked. */
export function activityLine(entry: ActivityEntry, width: number, tick: number, theme?: LobbyTheme): string {
  const who = paint(theme, sourceColor(entry.source), entry.source.padEnd(SOURCE_WIDTH).slice(0, SOURCE_WIDTH));
  const mark = entry.pending
    ? paint(theme, "accent", spinner(tick))
    : entry.kind === "error"
      ? paint(theme, "error", "✗")
      : entry.kind === "warning"
        ? paint(theme, "warning", "!")
        : entry.kind === "success"
          ? paint(theme, "success", "✓")
          : paint(theme, "dim", "·");
  const text = entry.pending ? `${entry.text}…` : entry.text;
  const body = entry.kind === "error" ? paint(theme, "error", text) : entry.pending ? text : paint(theme, "muted", text);
  return `${paint(theme, "dim", clock(entry.at))} ${who} ${mark} ${body}`;
}

function chatLead(role: ChatEntry["role"], theme?: LobbyTheme): string {
  if (role === "you") return `${bold(theme, paint(theme, "accent", "you"))} ${paint(theme, "dim", "▸")} `;
  if (role === "oracle") return `${bold(theme, paint(theme, "toolTitle", "oracle"))} ${paint(theme, "dim", "▸")} `;
  return `${paint(theme, "dim", "·")} `;
}

/** The conversation as wrapped lines, oldest first, a blank line between turns. */
export function chatLines(chat: readonly ChatEntry[], width: number, theme?: LobbyTheme, live?: string, busy = false, tick = 0): string[] {
  const lines: string[] = [];
  const push = (role: ChatEntry["role"], text: string) => {
    if (lines.length > 0) lines.push("");
    const body = role === "note" ? paint(theme, "dim", text) : text;
    lines.push(...wrapHanging(chatLead(role, theme), body, width));
  };
  for (const entry of chat) push(entry.role, entry.text);
  if (live?.trim()) push("oracle", `${live.trim()} ${paint(theme, "accent", spinner(tick))}`);
  else if (busy) push("oracle", paint(theme, "dim", `${spinner(tick)} working…`));
  return lines;
}

function emptyChat(input: HomeInput, width: number, theme?: LobbyTheme): string[] {
  const lines = input.task
    ? [paint(theme, "dim", "Nothing said yet. Type below to talk to the oracle about this task.")]
    : [
        bold(theme, "No task is running in this session."),
        "",
        "Type a request below and press enter to start one: the oracle scouts, proposes, plans and delegates.",
        `Or plan it first with the planner in ${bold(theme, "3 Plan")}, or make a direct change in ${bold(theme, "4 Quick fix")}.`,
      ];
  const extra: string[] = [];
  if (input.others > 0) extra.push(`${input.others} task${input.others === 1 ? " is" : "s are"} running in other sessions — see ${bold(theme, "2 Tasks")}.`);
  if (input.pending > 0) extra.push(`${input.pending} planned task${input.pending === 1 ? "" : "s"} waiting to start — see ${bold(theme, "2 Tasks")}.`);
  return [...lines.flatMap((line) => wrap(line, width)), ...(extra.length > 0 ? ["", ...extra.flatMap((line) => wrap(paint(theme, "muted", line), width))] : [])];
}

function conversation(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  const all = input.chat.length > 0 || input.liveReply || input.busy ? chatLines(input.chat, width, theme, input.liveReply, input.busy, input.tick) : emptyChat(input, width, theme);
  const shown = tail(all, height, input.chatOffset);
  return fill(shown, height);
}

function activity(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (input.activity.length === 0) return fill([paint(theme, "dim", "No activity yet.")], height);
  const lines = input.activity.slice(-Math.max(height, 1)).map((entry) => activityLine(entry, width, input.tick, theme));
  return fill(tail(lines, height), height);
}

/** The thought to show: a live one first, otherwise the newest. */
export function currentThought(thoughts: readonly ThoughtEntry[]): ThoughtEntry | undefined {
  return [...thoughts].reverse().find((entry) => entry.live) ?? thoughts.at(-1);
}

function thinking(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  const thought = currentThought(input.thoughts);
  const right = thought ? `${thought.source} · ${thought.live ? "thinking" : since(input.now - thought.at)}` : "";
  const header = rule(width, "Thinking", theme, right);
  if (height <= 1) return [header].slice(0, height);
  if (!thought) return fill([header, paint(theme, "dim", "Thoughts from the oracle and every agent appear here, and only here.")], height);
  const body = wrap(thought.text, width).map((line) => italic(theme, paint(theme, "dim", line)));
  return fill([header, ...tail(body, height - 1)], height);
}

function sceneLines(input: HomeInput, width: number, height: number): string[] {
  if (!input.task || !input.scene) return [];
  const budget = Math.min(MAX_SCENE, Math.floor(height * SCENE_SHARE));
  if (budget < 6) return [];
  return input.scene(width, budget).slice(0, budget);
}

/** The whole tab, exactly `height` lines of `width` columns. */
export function renderHome(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const scene = sceneLines(input, width, height);
  const rest = height - scene.length;
  const thinkHeight = rest >= 16 ? Math.max(4, Math.floor(rest * 0.25)) : rest >= 9 ? 3 : 0;
  const main = rest - thinkHeight;
  const chatTitle = input.task ? `Conversation · ${input.task.id}` : "Conversation";
  let body: string[];
  if (width >= HOME_COLUMNS_MIN) {
    const [left, right] = split(width, 0.56);
    const headers = columns([rule(left, chatTitle, theme)], [rule(right, "Activity", theme)], left, right, " ┬ ", theme);
    const rows = columns(conversation(input, left, main - 1, theme), activity(input, right, main - 1, theme), left, right, " │ ", theme);
    body = [...headers, ...rows];
  } else {
    const chatHeight = Math.max(1, Math.ceil(main * 0.6));
    const activityHeight = main - chatHeight;
    body = [
      rule(width, chatTitle, theme),
      ...conversation(input, width, chatHeight - 1, theme),
      ...(activityHeight > 0 ? [rule(width, "Activity", theme), ...activity(input, width, activityHeight - 1, theme)] : []),
    ];
  }
  return fill([...scene, ...fill(body, main), ...thinking(input, width, thinkHeight, theme)], height, width);
}
