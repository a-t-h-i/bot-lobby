/**
 * `status.get`: everything the page shell needs before it reads a tab —
 * workspace, session, tabs, shortcuts and open windows. Tab ids and labels
 * come from the shared strings, shortcuts from the shared key map (with the
 * web-only tab cycling defaults), so the page matches the terminal exactly.
 */
import { loadConfig } from "../../state/project.ts";
import { LOBBY_ACTIONS, keyLabel, webKeyMap } from "../../lobby/keys.ts";
import { TAB_LABELS, visibleTabs } from "../../lobby/prompts.ts";
import type { ApiContext } from "./index.ts";
import type { KeyInfo, StatusInfo, TabInfo } from "../protocol.ts";

function tabs(issuesEnabled: boolean): TabInfo[] {
  return visibleTabs(issuesEnabled).map((id, index) => ({ id, label: TAB_LABELS[id], key: `Alt+${index + 1}` }));
}

function keys(overrides: Readonly<Record<string, string>>): KeyInfo[] {
  const map = webKeyMap(overrides);
  return (Object.keys(LOBBY_ACTIONS) as Array<keyof typeof LOBBY_ACTIONS>).map((action) => ({
    action,
    key: map[action],
    label: keyLabel(map[action]),
    help: LOBBY_ACTIONS[action].help,
  }));
}

/** Whether pi itself is asking in the terminal (a later surface reports it; false until one does). */
function terminalDialog(ctx: ApiContext): boolean {
  const extra = ctx.service as unknown as { terminalDialog?: () => boolean };
  try {
    return extra.terminalDialog?.() ?? false;
  } catch {
    return false;
  }
}

/** The page shell's first call. */
export function statusGet(ctx: ApiContext): StatusInfo {
  const service = ctx.service;
  const issuesEnabled = service.issuesEnabled();
  const workspace = service.workspace?.() ?? { name: "bot-lobby" };
  return {
    workspace: { name: workspace.name, ...(workspace.branch ? { branch: workspace.branch } : {}) },
    ...(workspace.branch ? { branch: workspace.branch } : {}),
    sessionId: service.sessionId() ?? undefined,
    sessionName: service.sessionName() ?? undefined,
    busy: service.masterBusy(),
    terminalDialog: terminalDialog(ctx),
    port: ctx.port,
    issuesEnabled,
    tabs: tabs(issuesEnabled),
    keys: keys(loadConfig().lobby.keys),
    windows: [],
  };
}
