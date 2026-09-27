/**
 * The Lobby tab: the zen scene of this session's task on top, then the
 * conversation with the oracle (text only, no tool rows, no thinking), the
 * activity log of plain-words steps from every agent, and the one place where
 * thoughts show up. Pure: the scene arrives as a callback, the clock as `now`.
 */
import type { Task } from "../../schemas/task.ts";
import type { ActivityEntry, ChatEntry, ThoughtEntry } from "../feed.ts";
import type { LobbyPanel } from "../../schemas/configuration.ts";
import { beside, bold, box, clock, fill, italic, markdownHanging, paint, since, spinner, tail, wrap, wrapHanging, type LobbyColor, type LobbyTheme } from "../layout.ts";

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
  /** Which panes show. */
  panels: Record<LobbyPanel, boolean>;
  /** The search in force: panes show only matching entries. */
  query?: string;
  /** Key labels for the pane toggles, shown on the panes. */
  keys?: Record<LobbyPanel, string>;
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
  ORACLE: "accent",
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
    // The oracle writes Markdown; what you typed and notes are shown as written.
    if (role === "oracle") lines.push(...markdownHanging(chatLead(role, theme), text, width, theme));
    else lines.push(...wrapHanging(chatLead(role, theme), role === "note" ? paint(theme, "dim", text) : text, width));
  };
  for (const entry of chat) push(entry.role, entry.text);
  if (live?.trim()) {
    push("oracle", live.trim());
    lines[lines.length - 1] = `${lines.at(-1)!.trimEnd()} ${paint(theme, "accent", spinner(tick))}`;
  } else if (busy) {
    if (lines.length > 0) lines.push("");
    lines.push(...wrapHanging(chatLead("oracle", theme), paint(theme, "dim", `${spinner(tick)} working…`), width));
  }
  return lines;
}

function emptyChat(input: HomeInput, width: number, theme?: LobbyTheme): string[] {
  if (input.query) return wrap(paint(theme, "dim", `Nothing in the conversation matches "${input.query}".`), width);
  const lines = input.task
    ? [paint(theme, "dim", "Nothing said yet. Type below to talk to the oracle about this task.")]
    : [
        bold(theme, "No task is running in this session."),
        "",
        "Type a request below and press enter to start one: the oracle scouts, proposes, plans and delegates.",
        `Or plan it first with the whole planning panel in ${bold(theme, "3 Plan")}, or make a direct change in ${bold(theme, "4 Quick fix")}.`,
      ];
  const extra: string[] = [];
  if (input.others > 0) extra.push(`${input.others} task${input.others === 1 ? " is" : "s are"} running in other sessions — see ${bold(theme, "2 Tasks")}.`);
  if (input.pending > 0) extra.push(`${input.pending} planned task${input.pending === 1 ? "" : "s"} waiting to start — see ${bold(theme, "2 Tasks")}.`);
  return [...lines.flatMap((line) => wrap(line, width)), ...(extra.length > 0 ? ["", ...extra.flatMap((line) => wrap(paint(theme, "muted", line), width))] : [])];
}

function matches(text: string, query: string | undefined): boolean {
  return !query || text.toLowerCase().includes(query.toLowerCase());
}

/** The feed as the search narrows it: only entries whose text (or source) contains the query. */
export function filterFeed(input: Pick<HomeInput, "chat" | "activity" | "thoughts" | "query">): { chat: ChatEntry[]; activity: ActivityEntry[]; thoughts: ThoughtEntry[] } {
  const query = input.query?.trim();
  return {
    chat: input.chat.filter((entry) => matches(entry.text, query)),
    activity: input.activity.filter((entry) => matches(`${entry.source} ${entry.text}`, query)),
    thoughts: input.thoughts.filter((entry) => matches(`${entry.source} ${entry.text}`, query)),
  };
}

function conversation(input: HomeInput, chat: readonly ChatEntry[], width: number, height: number, theme?: LobbyTheme): string[] {
  const searching = Boolean(input.query);
  const live = searching ? undefined : input.liveReply;
  const busy = !searching && input.busy;
  const all = chat.length > 0 || live || busy ? chatLines(chat, width, theme, live, busy, input.tick) : emptyChat(input, width, theme);
  return tail(all, height, input.chatOffset);
}

function activity(input: HomeInput, entries: readonly ActivityEntry[], width: number, height: number, theme?: LobbyTheme): string[] {
  if (entries.length === 0) return [paint(theme, "dim", input.query ? `No activity matches "${input.query}".` : "No activity yet.")];
  return tail(entries.slice(-Math.max(height, 1)).map((entry) => activityLine(entry, width, input.tick, theme)), height);
}

/** The thought to show: a live one first, otherwise the newest. */
export function currentThought(thoughts: readonly ThoughtEntry[]): ThoughtEntry | undefined {
  return [...thoughts].reverse().find((entry) => entry.live) ?? thoughts.at(-1);
}

function thinking(input: HomeInput, thoughts: readonly ThoughtEntry[], width: number, height: number, theme?: LobbyTheme): string[] {
  const thought = currentThought(thoughts);
  const right = thought ? `${thought.source} · ${thought.live ? "thinking" : since(input.now - thought.at)}` : input.keys?.thinking;
  const inner = Math.max(1, width - 4);
  const body = thought
    ? tail(wrap(thought.text, inner).map((line) => italic(theme, paint(theme, "dim", line))), height - 2)
    : [paint(theme, "dim", input.query ? `No thought matches "${input.query}".` : "Thoughts from the oracle and every agent appear here, and only here.")];
  return box(width, height, body, { title: "Thinking", ...(right ? { right } : {}), theme });
}

function sceneLines(input: HomeInput, width: number, height: number): string[] {
  if (!input.task || !input.scene || !input.panels.scene) return [];
  const budget = Math.min(MAX_SCENE, Math.floor(height * SCENE_SHARE));
  if (budget < 6) return [];
  return input.scene(width, budget).slice(0, budget);
}

function hiddenHint(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  const keys = input.keys;
  const text = keys
    ? `Every pane is hidden — ${keys.conversation} conversation · ${keys.activity} activity · ${keys.thinking} thinking${input.task ? ` · ${keys.scene} scene` : ""}`
    : "Every pane is hidden.";
  const lines = wrap(paint(theme, "dim", text), width);
  const top = Math.max(0, Math.floor((height - lines.length) / 2));
  return fill([...Array.from({ length: top }, () => ""), ...lines], height, width);
}

/** The whole tab, exactly `height` lines of `width` columns; hidden panes give their room to the rest. */
export function renderHome(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const { panels } = input;
  const feed = filterFeed(input);
  const scene = sceneLines(input, width, height);
  const rest = height - scene.length;
  const showMain = panels.conversation || panels.activity;
  const thinkHeight = !panels.thinking ? 0 : !showMain ? rest : rest >= 18 ? Math.max(5, Math.floor(rest * 0.25)) : rest >= 10 ? 4 : 0;
  const main = rest - thinkHeight;
  if (!showMain && !panels.thinking) return fill([...scene, ...hiddenHint(input, width, rest, theme)], height, width);
  const searchNote = input.query ? `${feed.chat.length} match${feed.chat.length === 1 ? "" : "es"}` : input.keys?.conversation;
  const chatTitle = input.task ? `Conversation · ${input.task.id}` : "Conversation";
  const chatBox = (w: number, h: number) => box(w, h, conversation(input, feed.chat, w - 4, h - 2, theme), { title: chatTitle, ...(searchNote ? { right: searchNote } : {}), theme });
  const activityNote = input.query ? `${feed.activity.length} match${feed.activity.length === 1 ? "" : "es"}` : input.keys?.activity;
  const activityBox = (w: number, h: number) => box(w, h, activity(input, feed.activity, w - 4, h - 2, theme), { title: "Activity", ...(activityNote ? { right: activityNote } : {}), theme });
  let body: string[] = [];
  if (main > 0 && panels.conversation && panels.activity) {
    if (width >= HOME_COLUMNS_MIN) {
      const left = Math.round((width - 1) * 0.56);
      body = beside([chatBox(left, main), activityBox(width - 1 - left, main)]);
    } else {
      const chatHeight = Math.max(3, Math.ceil(main * 0.6));
      body = [...chatBox(width, chatHeight), ...(main - chatHeight >= 3 ? activityBox(width, main - chatHeight) : [])];
    }
  } else if (main > 0 && panels.conversation) body = chatBox(width, main);
  else if (main > 0 && panels.activity) body = activityBox(width, main);
  const think = thinkHeight >= 3 ? thinking(input, feed.thoughts, width, thinkHeight, theme) : [];
  return fill([...scene, ...fill(body, main), ...think], height, width);
}
