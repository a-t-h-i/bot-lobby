/**
 * Strings the server and the page share: tab metadata and the short line
 * shown when a question was answered elsewhere. Pure on purpose (no
 * `node:*`): the web page imports this file directly.
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

/** A question answered in another window of the page (or put away) before this one's answer arrived. */
export const ANSWERED_ELSEWHERE = "already answered in another window";

/** Opens the list of files a message carries (see src/webui/uploads.ts); the page shows them as thumbnails and chips. */
export const ATTACHMENTS_MARK = "Attached files:";
