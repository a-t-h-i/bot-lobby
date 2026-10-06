/**
 * Bot-lobby on or off for this pi session. A session starts off, so pi is
 * plain pi: no oracle prompt, no web lobby, no browser opening. It starts on
 * only when `lobby.startOn` says so, or when the session already drives a task
 * that is still under way (a resumed session picks its task back up).
 * Ctrl+Shift+M and `/bot-lobby on|off` switch it; starting a task, opening the
 * web lobby or answering a task's proposal turns it on. Off stops the web
 * lobby too, and anything it runs (a quick fix, a review, a planning round)
 * stops with it, so the user is asked first when something is running.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { currentLobbyService, lobbyWorkRunning, servesPage, startLobbyService, stopLobbyService } from "../lobby/runtime.ts";
import { activeTask } from "../state/persistence.ts";
import { workToCarryOn } from "../lobby/recovery.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { stopWebServer, webSessionStarted } from "../webui/command.ts";
import { isSubagentProcess } from "./quiet.ts";
import { applyStatus, isMinimized, setMinimized } from "./ui.ts";

export const SWITCH_KEY = "ctrl+shift+m";

export function isOn(): boolean {
  return !isMinimized();
}

/**
 * Whether a new session starts on: when settings say so, when it owns a task
 * still under way, or when a window in the project stopped unexpectedly and
 * its work is waiting to carry on.
 */
export function startsOn(ctx: ExtensionContext, configDir: string): boolean {
  if (loadConfig().lobby.startOn) return true;
  const root = detectProjectRoot(ctx.cwd, configDir);
  return Boolean(activeTask(root, configDir, ctx.sessionManager.getSessionId())) || (servesPage(ctx) && workToCarryOn(root, configDir));
}

/** Turn bot-lobby on: the oracle's prompt comes back and the web lobby starts (opening the browser if settings say so). */
export function turnOn(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, quiet = false): void {
  const was = isOn();
  setMinimized(false);
  if (!isSubagentProcess() && servesPage(ctx) && !currentLobbyService()) {
    startLobbyService(pi, ctx, configDir);
    webSessionStarted(ctx);
  }
  applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir);
  if (!was && !quiet) ctx.ui.notify(`bot-lobby on — ${SWITCH_KEY} or /bot-lobby off turns it off`, "info");
}

/** Turn bot-lobby off: pi is plain pi until it is turned on again. Returns false when the user kept it on. */
export async function turnOff(ctx: ExtensionContext, configDir: string): Promise<boolean> {
  const running = lobbyWorkRunning();
  if (running && ctx.hasUI && !(await ctx.ui.confirm("Turn bot-lobby off?", `${running} is running in the lobby and stops with it.`))) return false;
  setMinimized(true);
  stopLobbyService();
  await stopWebServer(ctx);
  applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir);
  ctx.ui.notify(`bot-lobby off — pi is plain pi; ${SWITCH_KEY} or /bot-lobby on turns it on`, "info");
  return true;
}

export async function toggleBotLobby(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string): Promise<void> {
  if (isOn()) await turnOff(ctx, configDir);
  else turnOn(pi, ctx, configDir);
}

/** Ctrl+Shift+M switches bot-lobby on and off for this session. */
export function registerSwitch(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  pi.registerShortcut(Key.ctrlShift("m"), {
    description: "bot-lobby: turn bot-lobby on or off for this session",
    handler: (ctx) => toggleBotLobby(pi, ctx, configDir),
  });
}
