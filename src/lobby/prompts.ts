/**
 * Strings the terminal lobby and the web lobby share: tab metadata and the
 * short status lines shown while a question is answered elsewhere. Pure on
 * purpose (no `node:*`, no `@earendil-works/pi-tui`): the web page imports
 * this file directly.
 */

export const TAB_IDS = ["lobby", "tasks", "plan", "quickfix", "issues", "metrics", "git", "knowledge", "excalidraw"] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TAB_LABELS: Record<TabId, string> = {
  lobby: "Lobby",
  tasks: "Tasks",
  plan: "Plan",
  quickfix: "Quick fix",
  issues: "Issues",
  metrics: "Metrics",
  git: "Git",
  knowledge: "Knowledge",
  excalidraw: "Excalidraw",
};

/** The tabs on show: Issues only while `lobby.issues` switches it on. */
export function visibleTabs(issues: boolean): TabId[] {
  return TAB_IDS.filter((tab) => issues || tab !== "issues");
}

/** A question answered in the terminal while the web lobby watched it. */
export const ANSWERED_IN_TERMINAL = "already answered in the terminal";

/** Pi itself is asking in the terminal; the web lobby waits. */
export const PI_ASKING_IN_TERMINAL = "pi is asking in the terminal";

/** The window is too narrow to show the lobby. */
export const NARROW_WINDOW = "the window is too narrow to show the lobby";
