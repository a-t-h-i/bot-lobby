/**
 * The Lobby tab: the zen scene of this session's task on top (the oracle
 * and agent animations, or just their status when animations are off), then the
 * conversation with the oracle (text only, no tool rows, no thinking), the
 * activity log of plain-words steps from every agent, and the one place where
 * thoughts show up. Pure: the scene arrives as a callback, the clock as `now`.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Task } from "../../schemas/task.ts";
import type { ActivityEntry, ChatEntry, ThoughtEntry } from "../feed.ts";
import type { LobbyPanel } from "../../schemas/configuration.ts";
import { beside, bold, box, clock, fill, italic, markdownHanging, notePane, paint, since, spinner, wrap, wrapHanging, type LobbyColor, type LobbyTheme, type PaneLayout } from "../layout.ts";

/** The Lobby tab's scrollable panes. */
export const HOME_PANES = ["conversation", "activity", "thinking"] as const;
export type HomePane = (typeof HOME_PANES)[number];

export interface HomeInput {
  task?: Task;
  /** Draws the zen scene into at most `height` lines, animated or still; absent when no task is active. */
  scene?: (width: number, height: number, animated: boolean) => string[];
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
  /** How far each pane is scrolled back, in lines from its newest; 0 follows the newest. */
  offsets?: Partial<Record<HomePane, number>>;
  /** The pane the arrow keys scroll; its border lights up. */
  focus?: HomePane;
  /** Filled with where each pane landed and how much it holds. */
  panes?: PaneLayout;
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
/** Most lines the scene may take, and its share of the body; the still status needs far fewer. */
const SCENE_SHARE = 0.45;
const MAX_SCENE = 36;
const MAX_STILL = 10;

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

function conversation(input: HomeInput, chat: readonly ChatEntry[], width: number, theme?: LobbyTheme): string[] {
  const searching = Boolean(input.query);
  const live = searching ? undefined : input.liveReply;
  const busy = !searching && input.busy;
  return chat.length > 0 || live || busy ? chatLines(chat, width, theme, live, busy, input.tick) : emptyChat(input, width, theme);
}

function activity(input: HomeInput, entries: readonly ActivityEntry[], width: number, theme?: LobbyTheme): string[] {
  if (entries.length === 0) return [paint(theme, "dim", input.query ? `No activity matches "${input.query}".` : "No activity yet.")];
  return entries.map((entry) => activityLine(entry, width, input.tick, theme));
}

/** The last `rows` lines, `offset` lines back from the newest (clamped), and where they start. */
export function tailWindow(lines: readonly string[], rows: number, offset = 0): { shown: string[]; start: number; offset: number } {
  const max = Math.max(0, lines.length - rows);
  const back = Math.min(Math.max(0, offset), max);
  const start = max - back;
  return { shown: lines.slice(start, start + Math.max(0, rows)), start, offset: back };
}

/** The thought to show: a live one first, otherwise the newest. */
export function currentThought(thoughts: readonly ThoughtEntry[]): ThoughtEntry | undefined {
  return [...thoughts].reverse().find((entry) => entry.live) ?? thoughts.at(-1);
}

/** Every thought, oldest first: who thought it, then the thought, dimmed. */
export function thoughtLines(thoughts: readonly ThoughtEntry[], width: number, theme?: LobbyTheme): string[] {
  return thoughts.flatMap((thought) => {
    const lead = `${paint(theme, sourceColor(thought.source), thought.source.padEnd(SOURCE_WIDTH).slice(0, SOURCE_WIDTH))} `;
    return wrapHanging(lead, italic(theme, paint(theme, "dim", thought.text.replace(/\s*\n\s*/g, " "))), width);
  });
}

function thinkingContent(input: HomeInput, thoughts: readonly ThoughtEntry[], width: number, theme?: LobbyTheme): string[] {
  if (thoughts.length > 0) return thoughtLines(thoughts, width, theme);
  return [paint(theme, "dim", input.query ? `No thought matches "${input.query}".` : "Thoughts from the oracle and every agent appear here, and only here.")];
}

/**
 * The scene: the animated oracle and agents, or with animations off (the
 * `scene` panel) only the task's status box, what the agents are doing and
 * the checklist. Its first line names the key that toggles the animations.
 */
function sceneLines(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (!input.task || !input.scene) return [];
  const animated = input.panels.scene;
  const budget = Math.min(animated ? MAX_SCENE : MAX_STILL, Math.floor(height * SCENE_SHARE));
  if (budget < (animated ? 6 : 4)) return [];
  const lines = input.scene(width, budget, animated).slice(0, budget);
  const note = input.keys ? `${input.keys.scene} ${animated ? "hides" : "shows"} animations` : undefined;
  return keyNote(lines, width, note, theme);
}

/** `note` at the right end of the first line, dimmed, when it fits beside what is there. */
function keyNote(lines: readonly string[], width: number, note: string | undefined, theme?: LobbyTheme): string[] {
  const first = lines[0];
  if (!note || first === undefined) return [...lines];
  const gap = width - visibleWidth(first) - visibleWidth(note) - 1;
  if (gap < 2) return [...lines];
  return [`${first}${" ".repeat(gap)}${paint(theme, "dim", note)}`, ...lines.slice(1)];
}

function hiddenHint(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  const keys = input.keys;
  const text = keys
    ? `Every pane is hidden — ${keys.conversation} conversation · ${keys.activity} activity · ${keys.thinking} thinking`
    : "Every pane is hidden.";
  const lines = wrap(paint(theme, "dim", text), width);
  const top = Math.max(0, Math.floor((height - lines.length) / 2));
  return fill([...Array.from({ length: top }, () => ""), ...lines], height, width);
}

/** `↓12` when a pane is scrolled back from its newest line, before the pane's usual note. */
function rightNote(offset: number, note: string | undefined): string | undefined {
  const parts = [offset > 0 ? `↓${offset}` : "", note ?? ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The whole tab, exactly `height` lines of `width` columns; hidden panes give their room to the rest. */
export function renderHome(input: HomeInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const { panels } = input;
  const feed = filterFeed(input);
  const scene = sceneLines(input, width, height, theme);
  const rest = height - scene.length;
  const showMain = panels.conversation || panels.activity;
  const thinkHeight = !panels.thinking ? 0 : !showMain ? rest : rest >= 18 ? Math.max(5, Math.floor(rest * 0.25)) : rest >= 10 ? 4 : 0;
  const main = rest - thinkHeight;
  if (!showMain && !panels.thinking) return fill([...scene, ...hiddenHint(input, width, rest, theme)], height, width);
  const matches = (count: number) => `${count} match${count === 1 ? "" : "es"}`;
  /** One scrollable pane: its lines, tailed to its rows and scrolled back by its offset, in a box that records where it sits. */
  const pane = (name: HomePane, title: string, note: string | undefined, lines: (inner: number) => string[]) => (top: number, left: number, w: number, h: number): string[] => {
    const all = lines(Math.max(1, w - 4));
    const view = tailWindow(all, h - 2, input.offsets?.[name] ?? 0);
    notePane(input.panes, name, top, left, w, h, all.length);
    const right = rightNote(view.offset, note);
    return box(w, h, view.shown, { title, ...(right ? { right } : {}), focused: input.focus === name, scroll: { total: all.length, start: view.start }, theme });
  };
  const chatBox = pane("conversation", input.task ? `Conversation · ${input.task.id}` : "Conversation", input.query ? matches(feed.chat.length) : input.keys?.conversation, (inner) => conversation(input, feed.chat, inner, theme));
  const activityBox = pane("activity", "Activity", input.query ? matches(feed.activity.length) : input.keys?.activity, (inner) => activity(input, feed.activity, inner, theme));
  const thought = currentThought(feed.thoughts);
  const thinkingNote = thought ? `${thought.source} · ${thought.live ? "thinking" : since(input.now - thought.at)}` : input.keys?.thinking;
  const thinkingBox = pane("thinking", "Thinking", thinkingNote, (inner) => thinkingContent(input, feed.thoughts, inner, theme));
  const top = scene.length;
  let body: string[] = [];
  if (main > 0 && panels.conversation && panels.activity) {
    if (width >= HOME_COLUMNS_MIN) {
      const left = Math.round((width - 1) * 0.56);
      body = beside([chatBox(top, 0, left, main), activityBox(top, left + 1, width - 1 - left, main)]);
    } else {
      const chatHeight = Math.max(3, Math.ceil(main * 0.6));
      body = [...chatBox(top, 0, width, chatHeight), ...(main - chatHeight >= 3 ? activityBox(top + chatHeight, 0, width, main - chatHeight) : [])];
    }
  } else if (main > 0 && panels.conversation) body = chatBox(top, 0, width, main);
  else if (main > 0 && panels.activity) body = activityBox(top, 0, width, main);
  const think = thinkHeight >= 3 ? thinkingBox(top + main, 0, width, thinkHeight) : [];
  return fill([...scene, ...fill(body, main), ...think], height, width);
}
