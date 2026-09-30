/**
 * The Excalidraw tab: the shared sessions the user has added (five at most),
 * on the left, and the picked one on the right — its link, whether agents may
 * draw in it, the last check of it, and every agent it can be assigned to as a
 * checklist. Assigned agents get the Excalidraw tools and join the room under
 * their own name.
 */
import { AGENT_LABELS, EXCALIDRAW_AGENTS, MAX_SESSIONS, type ExcalidrawSession } from "../../excalidraw/sessions.ts";
import { bold, columns, fill, paint, rule, selectRow, spinner, split, spread, windowStart, wrap, type LobbyTheme } from "../layout.ts";

/** What the last check of a session found. */
export interface SessionCheck {
  ok: boolean;
  text: string;
}

export interface ExcalidrawTabInput {
  sessions: readonly ExcalidrawSession[];
  selected: number;
  focus: "list" | "detail";
  /** The agent under the cursor in the checklist. */
  agent: number;
  checks: ReadonlyMap<string, SessionCheck>;
  /** Ids of the sessions being checked now. */
  checking: ReadonlySet<string>;
  tick: number;
}

export const EXCALIDRAW_COLUMNS_MIN = 90;

function agentCount(session: ExcalidrawSession): string {
  const count = session.agents.length;
  return count === 0 ? "no agents" : `${count} agent${count === 1 ? "" : "s"}`;
}

/** The sessions, the selected one in view. */
export function sessionRows(input: ExcalidrawTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  const rows = input.sessions.map((session, index) => {
    const selected = index === input.selected;
    const mark = input.checking.has(session.id) ? paint(theme, "accent", spinner(input.tick)) : input.checks.get(session.id)?.ok === false ? paint(theme, "warning", "!") : input.checks.has(session.id) ? paint(theme, "success", "✓") : " ";
    const facts = paint(theme, session.agents.length > 0 ? "accent" : "dim", agentCount(session));
    return selectRow(theme, spread(`${mark} ${selected ? bold(theme, session.name) : session.name}`, facts, width - 2), width, selected, input.focus === "list");
  });
  return rows.slice(windowStart(input.selected, rows.length, height), windowStart(input.selected, rows.length, height) + height);
}

function emptyLines(width: number, theme?: LobbyTheme): string[] {
  return [
    ...wrap(paint(theme, "dim", "No sessions yet. A session is a live Excalidraw room that you and your agents draw in together."), width),
    "",
    ...wrap(`${paint(theme, "accent", "a")}  add one: in Excalidraw, Share → Live collaboration → Start session, then paste the link`, width),
    ...wrap(`${paint(theme, "accent", "n")}  or make a new room here and open its link in Excalidraw`, width),
    "",
    ...wrap(paint(theme, "dim", `Up to ${MAX_SESSIONS} sessions; each can be assigned to one agent or several.`), width),
  ];
}

/** The picked session: its link and state, then the agents it can be assigned to. */
export function detailLines(input: ExcalidrawTabInput, width: number, theme?: LobbyTheme): string[] {
  const session = input.sessions[input.selected];
  if (!session) return [];
  const lines: string[] = [];
  lines.push(...wrap(paint(theme, "muted", session.link), width));
  lines.push(paint(theme, session.contribute ? "success" : "warning", session.contribute ? "agents may draw here (w: look only)" : "agents may only look (w: let them draw)"));
  const check = input.checks.get(session.id);
  if (input.checking.has(session.id)) lines.push(paint(theme, "accent", `${spinner(input.tick)} checking the room…`));
  else if (check) lines.push(...wrap(paint(theme, check.ok ? "success" : "warning", `${check.ok ? "✓" : "!"} ${check.text}`), width));
  else lines.push(paint(theme, "dim", "t checks that the room can be reached"));
  lines.push("", rule(width, "Assigned to", theme, agentCount(session)));
  EXCALIDRAW_AGENTS.forEach((agent, index) => {
    const on = session.agents.includes(agent);
    const picked = input.focus === "detail" && index === input.agent;
    const box = on ? paint(theme, "success", "[x]") : paint(theme, "dim", "[ ]");
    const cursor = picked ? paint(theme, "accent", "▸") : " ";
    const label = on ? AGENT_LABELS[agent] : paint(theme, "muted", AGENT_LABELS[agent]);
    lines.push(selectRow(theme, `${cursor} ${box} ${picked ? bold(theme, label) : label}`, width, picked, true));
  });
  lines.push("", ...wrap(paint(theme, "dim", "Assigned agents read the board and draw on it with excalidraw_read and excalidraw_draw, and appear in the room under their own name."), width));
  return lines;
}

export function renderExcalidraw(input: ExcalidrawTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  const count = `${input.sessions.length}/${MAX_SESSIONS}`;
  if (input.sessions.length === 0) return fill([rule(width, "Excalidraw", theme, count), ...emptyLines(width, theme)], height, width);
  const selected = Math.min(Math.max(0, input.selected), input.sessions.length - 1);
  const view = { ...input, selected };
  const wide = width >= EXCALIDRAW_COLUMNS_MIN;
  const [listWidth, detailWidth] = wide ? split(width, 0.34, 3, 44) : [width, width];
  const listPane = fill([rule(listWidth, "Sessions", theme, count), ...sessionRows(view, listWidth, height - 1, theme)], height);
  const session = input.sessions[selected]!;
  const detailPane = fill([rule(detailWidth, `${session.name}${input.focus === "detail" ? " ◂" : ""}`, theme), ...detailLines(view, detailWidth, theme)], height);
  if (!wide) return fill(input.focus === "detail" ? detailPane : listPane, height, width);
  return fill(columns(listPane, detailPane, listWidth, detailWidth, " │ ", theme), height, width);
}
