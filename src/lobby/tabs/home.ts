/**
 * The Lobby tab: the status of this session's task on top, then the
 * conversation with the oracle (text only, no tool rows, no thinking), the
 * activity log of plain-words steps from every agent, and the one place where
 * thoughts show up. Pure: the clock arrives as `now`.
 */
import { textWidth } from "../../width.ts";
import type { Task } from "../../schemas/task.ts";
import type { ActivityEntry, ChatEntry, ThoughtEntry } from "../feed.ts";
import type { LobbyPanel } from "../../schemas/configuration.ts";
import { markdownBlocks } from "../markdown.ts";
import { beside, bold, box, clock, fill, fit, italic, markdownLines, notePane, paint, since, spinner, wrap, wrapHanging, type LobbyColor, type LobbyTheme, type PaneLayout, type PaneMark } from "../layout.ts";

/** The Lobby tab's scrollable panes. */
export const HOME_PANES = ["conversation", "activity", "thinking"] as const;
export type HomePane = (typeof HOME_PANES)[number];

export interface HomeInput {
  task?: Task;
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
  /** Each pane's newest entry as the frame before marked it, so the pane can measure what arrived below since. */
  anchors?: ReadonlyMap<string, PaneMark>;
  tick: number;
  now: number;
  /** Which panes show. */
  panels: Record<LobbyPanel, boolean>;
  /** The search in force: panes show only matching entries. */
  query?: string;
  /** Key labels for the pane toggles, shown on the panes. */
  keys?: Record<LobbyPanel, string>;
  /** Another session is shown: its name titles the conversation. */
  title?: string;
  /** What the empty conversation says instead of the default (a session starting, say). */
  emptyNote?: string;
  /** What the empty activity log says instead of "No activity yet.". */
  activityNote?: string;
  /** Tops the conversation when earlier messages are not loaded (scrolling up loads them). */
  olderNote?: string;
}

/** Wide terminals put the conversation and the activity log side by side. */
export const HOME_COLUMNS_MIN = 100;
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
export function activityLine(entry: ActivityEntry, _width: number, tick: number, theme?: LobbyTheme): string {
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

/**
 * How each speaker is shown: a mark and a name in its colour, and the side of
 * the conversation it speaks from — you on the right, the oracle on the left.
 */
export const SPEAKERS = {
  you: { mark: "●", name: "You", color: "accent", side: "right" },
  oracle: { mark: "◆", name: "Oracle", color: "toolTitle", side: "left" },
  panel: { mark: "◆", name: "Panel", color: "toolTitle", side: "left" },
} as const satisfies Record<string, { mark: string; name: string; color: LobbyColor; side: "left" | "right" }>;
export type Speaker = keyof typeof SPEAKERS;

/** Messages from one speaker within this long of each other share a header. */
const GROUP_MS = 5 * 60_000;
/** The oracle's replies sit under its name, past its mark. */
const BODY_INDENT = 2;
/** Your messages take at most this share of the pane, the oracle's this much, so the two sides read apart. */
const YOU_SHARE = 0.72;
const ORACLE_SHARE = 0.86;
/** Narrower panes give every message (nearly) the full width. */
const NARROW = 48;

/** The widest a message from one side may be in a pane `width` wide. */
function messageWidth(width: number, share: number, margin: number): number {
  return Math.max(1, width < NARROW ? width - margin : Math.floor(width * share));
}

/**
 * Who speaks and when: `◆ Oracle ········ 12:04` on the left for the oracle,
 * `12:04  You ●` on the right for you. `note` is the time, or what the
 * speaker is doing (`⠋ writing`).
 */
export function speakerLine(speaker: Speaker, width: number, theme?: LobbyTheme, note = ""): string {
  const { mark, name, color, side } = SPEAKERS[speaker];
  const who = paint(theme, color, mark);
  const label = bold(theme, paint(theme, color, name));
  const dimmed = note ? paint(theme, "dim", note) : "";
  if (side === "right") {
    const head = dimmed ? `${dimmed}  ${label} ${who}` : `${label} ${who}`;
    return `${" ".repeat(Math.max(0, width - textWidth(head)))}${head}`;
  }
  const left = `${who} ${label}`;
  const gap = width - textWidth(left) - textWidth(dimmed);
  return gap >= 1 && dimmed ? `${left}${" ".repeat(gap)}${dimmed}` : left;
}

/**
 * What you wrote: a bubble on the right, only as wide as its longest line (up
 * to `YOU_SHARE` of the pane), your words in Markdown as pi renders them, in
 * the accent colour on pi's user-message background — or, where the theme
 * has no background, closed by a bar in that colour.
 */
export function youLines(text: string, width: number, theme?: LobbyTheme): string[] {
  const most = Math.max(1, messageWidth(width, YOU_SHARE, 4) - 2);
  // The renderer colours your words itself; without one (tests) they are wrapped and painted here.
  const rendered = theme?.markdown ? markdownLines(text, most, theme, true, "you") : wrap(text, most).map((line) => paint(theme, "accent", line));
  const lines = rendered.length > 0 ? rendered : [""];
  const inner = Math.max(1, ...lines.map((line) => textWidth(line)));
  const pad = " ".repeat(Math.max(0, width - inner - 2));
  const bubble = theme?.bg
    ? (line: string) => theme.bg!("userMessageBg", ` ${fit(line, inner)} `)
    : (line: string) => `${fit(line, inner)} ${paint(theme, "accent", "▐")}`;
  return lines.map((line) => `${pad}${bubble(line)}`);
}

/** The oracle's reply as Markdown on the left, under its name. */
function oracleLines(text: string, width: number, theme?: LobbyTheme, keep = true): string[] {
  const indent = " ".repeat(BODY_INDENT);
  return markdownLines(text, Math.max(1, messageWidth(width, ORACLE_SHARE, 0) - BODY_INDENT), theme, keep).map((line) => (line ? `${indent}${line}` : ""));
}

/** An open block this long is drawn again at most every `BIG_BLOCK_MS` while it grows (a long code block, say). */
const BIG_BLOCK = 1500;
const BIG_BLOCK_MS = 100;
let lastOpen: { text: string; width: number; theme: object; lines: string[]; at: number } | undefined;

/** The block the oracle is writing: drawn afresh (and not cached), except that a big one is redrawn only a few times a second. */
function openBlockLines(text: string, width: number, theme: LobbyTheme | undefined): string[] {
  const now = performance.now();
  const key = theme ?? PLAIN;
  if (text.length > BIG_BLOCK && lastOpen && lastOpen.width === width && lastOpen.theme === key && now - lastOpen.at < BIG_BLOCK_MS && text.startsWith(lastOpen.text)) return lastOpen.lines;
  const lines = oracleLines(text, width, theme, false);
  lastOpen = text.length > BIG_BLOCK ? { text, width, theme: key, lines, at: now } : undefined;
  return lines;
}

/**
 * The reply the oracle is still writing. It is drawn block by block (see
 * `markdownBlocks`): finished blocks come from the Markdown cache and only the
 * one being written is rendered on each frame. It is drawn whole (it is
 * capped at `MAX_REPLY_TEXT`), so the pane knows exactly how far it reaches.
 */
function liveLines(text: string, width: number, theme: LobbyTheme | undefined): string[] {
  const blocks = markdownBlocks(text);
  const lines: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = index === blocks.length - 1 ? openBlockLines(blocks[index]!, width, theme) : oracleLines(blocks[index]!, width, theme);
    if (block.length === 0) continue;
    if (lines.length > 0) lines.push("");
    for (const line of block) lines.push(line);
  }
  return lines;
}

/** An event in the conversation (a task starting, a comment sent) as a centred rule; failures stand out instead. */
export function eventLines(text: string, at: number, width: number, theme?: LobbyTheme): string[] {
  if (text.startsWith("✗")) return wrap(paint(theme, "error", text), width);
  const label = ` ${text}${at > 0 ? ` · ${clock(at)}` : ""} `;
  const room = width - textWidth(label);
  if (room < 6) return wrap(paint(theme, "dim", text), width);
  const left = Math.floor(room / 2);
  return [paint(theme, "dim", `${"─".repeat(left)}${label}${"─".repeat(room - left)}`)];
}

/** The newest lines of a pane, and how many it holds in all (estimated when only the newest were drawn). */
export interface PaneLines {
  lines: string[];
  total: number;
  /** The newest entry and how many lines run from its first line to the end, for the next frame to measure against. */
  mark?: PaneMark;
  /** Lines that arrived below the anchor passed in since it was marked; absent when it is no longer there. */
  grew?: number;
}

/**
 * Where the anchor (an entry the frame before marked) sits in `entries`, so
 * drawing goes on at least that far back; `entries.length` when it is gone.
 * It is nearly always the last entry, so the search from the end is short.
 */
function reachOf<T extends object>(entries: readonly T[], anchor: PaneMark | undefined): { found: number; reach: number } {
  const found = anchor ? entries.lastIndexOf(anchor.entry as T) : -1;
  return { found, reach: found < 0 ? entries.length : found };
}

/** A message's drawn lines, kept until the pane's width, the theme or its grouping changes. */
interface Block {
  width: number;
  grouped: boolean;
  lines: string[];
}

/**
 * Drawn messages, per theme and per message: a message is drawn once (its
 * Markdown is the costly part) and reused on every later frame. Messages
 * that leave the feed are forgotten with it.
 */
const blocks = new WeakMap<object, WeakMap<ChatEntry, Block>>();
const PLAIN = {};

/** Whether `entry` shares the speaker line of the message before it (same speaker, within minutes). */
function isGrouped(entry: ChatEntry, before: ChatEntry | undefined): boolean {
  return entry.role !== "note" && before !== undefined && before.role === entry.role && entry.at >= before.at && entry.at - before.at < GROUP_MS;
}

function entryBlock(entry: ChatEntry, before: ChatEntry | undefined, width: number, theme?: LobbyTheme): string[] {
  const grouped = isGrouped(entry, before);
  let cache = blocks.get(theme ?? PLAIN);
  if (!cache) {
    cache = new WeakMap();
    blocks.set(theme ?? PLAIN, cache);
  }
  const hit = cache.get(entry);
  if (hit && hit.width === width && hit.grouped === grouped) return hit.lines;
  const lines = entry.role === "note"
    ? eventLines(entry.text, entry.at, width, theme)
    : [
        ...(grouped ? [] : [speakerLine(entry.role, width, theme, entry.at > 0 ? clock(entry.at) : "")]),
        ...(entry.role === "you" ? youLines(entry.text, width, theme) : oracleLines(entry.text, width, theme)),
      ];
  cache.set(entry, { width, grouped, lines });
  return lines;
}

export interface ChatTailOptions {
  /** The reply the oracle is still writing. */
  live?: string;
  /** The oracle's turn is running. */
  busy?: boolean;
  tick?: number;
  /** Tops a conversation that has earlier messages still to load. */
  older?: string;
  /** The newest message as the frame before marked it: drawing reaches at least back to it, to measure what arrived below. */
  anchor?: PaneMark;
}

/**
 * The newest `need` lines of the conversation, like a chat: your messages as
 * bubbles on the right, the oracle's replies in Markdown on the left, each
 * turn under a line naming its speaker and time, events as centred rules,
 * and while the oracle works its header says so (streaming the reply under
 * it). Only the messages those lines reach are drawn — scrolling back draws
 * more — and each is drawn once; the total is estimated from them until the
 * whole conversation has been drawn. `older` tops a conversation that has
 * earlier messages still to load.
 */
export function chatTail(chat: readonly ChatEntry[], width: number, theme: LobbyTheme | undefined, need: number, options: ChatTailOptions = {}): PaneLines {
  const { live, busy = false, tick = 0, older, anchor } = options;
  const parts: string[][] = [];
  let count = 0;
  const add = (lines: string[]) => {
    if (lines.length === 0) return;
    count += lines.length + (parts.length > 0 ? 1 : 0);
    parts.push(lines);
  };
  if (live?.trim()) add([speakerLine("oracle", width, theme, `${spinner(tick)} writing`), ...liveLines(live.trim(), width, theme)]);
  else if (busy) add([speakerLine("oracle", width, theme, `${spinner(tick)} working…`)]);
  const { found, reach } = reachOf(chat, anchor);
  let mark: PaneMark | undefined;
  let grew: number | undefined;
  let index = chat.length - 1;
  for (; index >= 0 && (count < need || index >= reach); index -= 1) {
    const entry = chat[index]!;
    add(entryBlock(entry, chat[index - 1], width, theme));
    if (index === chat.length - 1) mark = { entry, below: count };
    if (index === found) grew = count - anchor!.below;
  }
  const drawn = chat.length - 1 - index;
  if (index < 0 && older) add(wrap(paint(theme, "dim", older), width));
  const lines: string[] = [];
  for (let part = parts.length - 1; part >= 0; part -= 1) {
    if (lines.length > 0) lines.push("");
    for (const line of parts[part]!) lines.push(line);
  }
  // Messages not drawn yet count at the average height of those that were.
  const rest = index + 1;
  const total = rest > 0 && drawn > 0 ? lines.length + Math.ceil((rest * lines.length) / drawn) : lines.length;
  return { lines, total, ...(mark ? { mark } : {}), ...(grew !== undefined ? { grew } : {}) };
}

/** The whole conversation drawn (the session browser's preview and tests; the Lobby tab draws only what shows). */
export function chatLines(chat: readonly ChatEntry[], width: number, theme?: LobbyTheme, live?: string, busy = false, tick = 0): string[] {
  return chatTail(chat, width, theme, Number.POSITIVE_INFINITY, { ...(live ? { live } : {}), busy, tick }).lines;
}

function emptyChat(input: HomeInput, width: number, theme?: LobbyTheme): string[] {
  if (input.query) return wrap(paint(theme, "dim", `Nothing in the conversation matches "${input.query}".`), width);
  if (input.emptyNote) return wrap(paint(theme, "dim", input.emptyNote), width);
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

function whole(lines: string[]): PaneLines {
  return { lines, total: lines.length };
}

function conversation(input: HomeInput, chat: readonly ChatEntry[], width: number, need: number, anchor: PaneMark | undefined, theme?: LobbyTheme): PaneLines {
  const searching = Boolean(input.query);
  const live = searching ? undefined : input.liveReply;
  const busy = !searching && input.busy;
  if (chat.length === 0 && !live && !busy) return whole(emptyChat(input, width, theme));
  const older = searching ? undefined : input.olderNote;
  return chatTail(chat, width, theme, need, { ...(live ? { live } : {}), busy, tick: input.tick, ...(older ? { older } : {}), ...(anchor ? { anchor } : {}) });
}

/** The newest `need` activity lines (one per entry), drawn only as far back as the pane shows. */
function activity(input: HomeInput, entries: readonly ActivityEntry[], width: number, need: number, anchor: PaneMark | undefined, theme?: LobbyTheme): PaneLines {
  if (entries.length === 0) return whole(wrap(paint(theme, "dim", input.query ? `No activity matches "${input.query}".` : input.activityNote ?? "No activity yet."), width));
  const shown = Number.isFinite(need) ? entries.slice(-Math.max(0, need)) : entries;
  // One line per entry: where the anchor sits is a count, nothing needs drawing to find it.
  const { found } = reachOf(entries, anchor);
  return {
    lines: shown.map((entry) => activityLine(entry, width, input.tick, theme)),
    total: entries.length,
    mark: { entry: entries.at(-1)!, below: 1 },
    ...(found >= 0 ? { grew: entries.length - found - anchor!.below } : {}),
  };
}

/** The last `rows` lines, `offset` lines back from the newest (clamped), and where they start. */
export function tailWindow(lines: readonly string[], rows: number, offset = 0): { shown: string[]; start: number; offset: number } {
  return paneWindow({ lines: [...lines], total: lines.length }, rows, offset);
}

/**
 * `rows` lines of a pane `offset` lines back from its newest (clamped), when
 * only its newest lines were drawn: where they start in the whole pane, for
 * the scrollbar.
 */
export function paneWindow(content: PaneLines, rows: number, offset = 0): { shown: string[]; start: number; offset: number } {
  const { lines } = content;
  const total = Math.max(content.total, lines.length);
  const height = Math.max(0, rows);
  const back = Math.min(Math.max(0, offset), Math.max(0, total - height));
  const end = Math.max(0, lines.length - back);
  const begin = Math.max(0, end - height);
  return { shown: lines.slice(begin, end), start: Math.max(0, total - back - height), offset: back };
}

/** The thought to show: a live one first, otherwise the newest. */
export function currentThought(thoughts: readonly ThoughtEntry[]): ThoughtEntry | undefined {
  return [...thoughts].reverse().find((entry) => entry.live) ?? thoughts.at(-1);
}

/**
 * Drawn thoughts, per theme and per thought, kept while the thought's text
 * and the width stay the same (a live thought grows, so it is drawn again as
 * it streams; settled ones are wrapped once).
 */
const thoughtBlocks = new WeakMap<object, WeakMap<ThoughtEntry, { width: number; text: string; lines: string[]; at: number }>>();

/** A live thought this long is wrapped again at most every `LONG_THOUGHT_MS` while it streams; rendered as Markdown (costlier), from `LONG_THOUGHT_MARKDOWN`. */
const LONG_THOUGHT = 1000;
const LONG_THOUGHT_MARKDOWN = 300;
const LONG_THOUGHT_MS = 150;

function thoughtBlock(thought: ThoughtEntry, width: number, theme?: LobbyTheme): string[] {
  let cache = thoughtBlocks.get(theme ?? PLAIN);
  if (!cache) {
    cache = new WeakMap();
    thoughtBlocks.set(theme ?? PLAIN, cache);
  }
  const hit = cache.get(thought);
  const now = performance.now();
  const long = theme?.markdown ? LONG_THOUGHT_MARKDOWN : LONG_THOUGHT;
  if (hit && hit.width === width && (hit.text === thought.text || (thought.live && thought.text.length > long && now - hit.at < LONG_THOUGHT_MS))) return hit.lines;
  const lead = `${paint(theme, sourceColor(thought.source), thought.source.padEnd(SOURCE_WIDTH).slice(0, SOURCE_WIDTH))} `;
  const lines = theme?.markdown ? thoughtMarkdown(lead, thought, width, theme) : wrapHanging(lead, italic(theme, paint(theme, "dim", thought.text.replace(/\s*\n\s*/g, " "))), width);
  cache.set(thought, { width, text: thought.text, lines, at: now });
  return lines;
}

/**
 * A thought in Markdown as pi shows thinking (dimmed, in italics), after who
 * thought it: a model's `**Checking the plan**` reads bold, not starred. The
 * pane is small, so the blank lines between paragraphs are left out. A live
 * thought is not kept in the renderer's cache; it changes as it streams.
 */
function thoughtMarkdown(lead: string, thought: ThoughtEntry, width: number, theme: LobbyTheme): string[] {
  const indent = " ".repeat(textWidth(lead));
  const body = markdownLines(thought.text, Math.max(1, width - textWidth(lead)), theme, !thought.live, "thought").filter((line) => line.trim());
  if (body.length === 0) return [lead];
  return body.map((line, index) => `${index === 0 ? lead : indent}${line}`);
}

/** The newest `need` lines of the thoughts, oldest first: only the thoughts they reach are drawn (and back to `anchor`), and the rest estimated. */
export function thoughtTail(thoughts: readonly ThoughtEntry[], width: number, theme: LobbyTheme | undefined, need: number, anchor?: PaneMark): PaneLines {
  const parts: string[][] = [];
  let count = 0;
  const { found, reach } = reachOf(thoughts, anchor);
  let mark: PaneMark | undefined;
  let grew: number | undefined;
  let index = thoughts.length - 1;
  for (; index >= 0 && (count < need || index >= reach); index -= 1) {
    const thought = thoughts[index]!;
    const lines = thoughtBlock(thought, width, theme);
    parts.push(lines);
    count += lines.length;
    if (index === thoughts.length - 1) mark = { entry: thought, below: count };
    if (index === found) grew = count - anchor!.below;
  }
  const lines: string[] = [];
  for (let part = parts.length - 1; part >= 0; part -= 1) for (const line of parts[part]!) lines.push(line);
  const rest = index + 1;
  const drawn = parts.length;
  const total = rest > 0 && drawn > 0 ? lines.length + Math.ceil((rest * lines.length) / drawn) : lines.length;
  return { lines, total, ...(mark ? { mark } : {}), ...(grew !== undefined ? { grew } : {}) };
}

/** Every thought, oldest first: who thought it, then the thought, dimmed. */
export function thoughtLines(thoughts: readonly ThoughtEntry[], width: number, theme?: LobbyTheme): string[] {
  return thoughtTail(thoughts, width, theme, Number.POSITIVE_INFINITY).lines;
}

function thinkingContent(input: HomeInput, thoughts: readonly ThoughtEntry[], width: number, need: number, anchor: PaneMark | undefined, theme?: LobbyTheme): PaneLines {
  if (thoughts.length > 0) return thoughtTail(thoughts, width, theme, need, anchor);
  return whole([paint(theme, "dim", input.query ? `No thought matches "${input.query}".` : "Thoughts from the oracle and every agent appear here, and only here.")]);
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
  const rest = height;
  const showMain = panels.conversation || panels.activity;
  const thinkHeight = !panels.thinking ? 0 : !showMain ? rest : rest >= 18 ? Math.max(5, Math.floor(rest * 0.25)) : rest >= 10 ? 4 : 0;
  const main = rest - thinkHeight;
  if (!showMain && !panels.thinking) return fill(hiddenHint(input, width, rest, theme), height, width);
  const matches = (count: number) => `${count} match${count === 1 ? "" : "es"}`;
  /**
   * One scrollable pane: only the lines it shows are drawn — its newest, or
   * as far back as it is scrolled — in a box that records where it sits, and
   * how many lines arrived below since the frame before.
   */
  const pane = (name: HomePane, title: string, note: string | undefined, content: (inner: number, need: number, anchor: PaneMark | undefined) => PaneLines) => (top: number, left: number, w: number, h: number): string[] => {
    const rows = Math.max(0, h - 2);
    const offset = input.offsets?.[name] ?? 0;
    const drawn = content(Math.max(1, w - 4), rows + offset, input.anchors?.get(name));
    const view = paneWindow(drawn, rows, offset);
    const total = Math.max(drawn.total, drawn.lines.length);
    notePane(input.panes, name, top, left, w, h, total, { ...(drawn.mark ? { mark: drawn.mark } : {}), grew: drawn.grew ?? 0 });
    const right = rightNote(view.offset, note);
    return box(w, h, view.shown, { title, ...(right ? { right } : {}), focused: input.focus === name, scroll: { total, start: view.start }, theme });
  };
  const chatBox = pane("conversation", input.title ? `Conversation · ${input.title}` : "Conversation", input.query ? matches(feed.chat.length) : input.keys?.conversation, (inner, need, anchor) => conversation(input, feed.chat, inner, need, anchor, theme));
  const activityBox = pane("activity", "Activity", input.query ? matches(feed.activity.length) : input.keys?.activity, (inner, need, anchor) => activity(input, feed.activity, inner, need, anchor, theme));
  const thought = currentThought(feed.thoughts);
  const thinkingNote = thought ? `${thought.source} · ${thought.live ? "thinking" : since(input.now - thought.at)}` : input.keys?.thinking;
  const thinkingBox = pane("thinking", "Thinking", thinkingNote, (inner, need, anchor) => thinkingContent(input, feed.thoughts, inner, need, anchor, theme));
  const top = 0;
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
  return fill([...fill(body, main), ...think], height, width);
}
