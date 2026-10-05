/**
 * The loopback server from Pi. It starts with every interactive session
 * (`webSessionStarted`), opens the browser once and shows its address in
 * pi's status line. `/bot-lobby web` opens the page again and prints the
 * link; `web link` prints only the link, `web stop` frees the port until the
 * next session, `web reset` mints a new secret and returns the new link.
 * Errors become a notice, never a throw; the link itself carries the secret,
 * so notices never name it beyond the link.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../state/project.ts";
import { currentLobbyService, servesPage } from "../lobby/runtime.ts";
import type { LobbyService } from "../lobby/host.ts";
import { isSubagentProcess } from "../pi/quiet.ts";
import { heartbeat } from "../pi/owner.ts";
import { currentWebServer, startWebServer } from "./server.ts";
import { openBrowser } from "./open.ts";

export type WebSubcommand = "start" | "stop" | "link" | "reset";

/** The status-line entry that shows where the page is. */
export const WEB_STATUS_KEY = "bot-lobby-web";

export interface WebCommandDeps {
  service?: LobbyService;
  open?: (url: string) => boolean;
}

/**
 * The freshest link: the server's `link` is the one it started with, so a
 * `reset` after it would leave `link`/`web link` printing the old secret.
 * The commands below keep the newest link here instead.
 */
let latestLink: string | undefined;

/** The link to print: the newest one from this module, else the server's own. */
export function webLink(): string | undefined {
  const running = currentWebServer();
  if (!running) {
    latestLink = undefined;
    return undefined;
  }
  return latestLink ?? running.link;
}

/** The subcommand of `web stop|link|reset` (bare `web` opens the page); undefined when the word is none of those. */
export function webAction(word: string | undefined): WebSubcommand | undefined {
  if (!word) return "start";
  if (word === "stop" || word === "link" || word === "reset") return word;
  return undefined;
}

function resolveService(deps?: WebCommandDeps): LobbyService | undefined {
  return deps?.service ?? currentLobbyService();
}

function openLink(url: string, deps?: WebCommandDeps): void {
  if (!loadConfig().lobby.web.openBrowser) return;
  try {
    (deps?.open ?? openBrowser)(url);
  } catch {
    // A browser that will not open only means the link stays on screen.
  }
}

async function startCommand(ctx: ExtensionCommandContext, deps?: WebCommandDeps): Promise<void> {
  const running = currentWebServer();
  if (running) {
    ctx.ui.notify(`bot-lobby web: ${webLink()}`, "info");
    openLink(webLink() ?? running.link, deps);
    return;
  }
  const service = resolveService(deps);
  if (!service) {
    ctx.ui.notify("bot-lobby web needs an interactive pi session.", "warning");
    return;
  }
  const server = await startWebServer({ service, port: loadConfig().lobby.web.port });
  latestLink = server.link;
  heartbeat();
  showAddress(ctx, server.port);
  ctx.ui.notify(`bot-lobby web: ${server.link}`, "info");
  openLink(server.link, deps);
}

/** pi's status line names the page's address (not its secret: the link was printed once). */
function showAddress(ctx: ExtensionContext, port: number | undefined): void {
  ctx.ui.setStatus(WEB_STATUS_KEY, port ? `bot-lobby web ui: http://127.0.0.1:${port}` : undefined);
}

function linkCommand(ctx: ExtensionCommandContext): void {
  const link = webLink();
  if (link) ctx.ui.notify(`bot-lobby web: ${link}`, "info");
  else ctx.ui.notify("bot-lobby web is not running; /bot-lobby web starts it.", "warning");
}

async function stopCommand(ctx: ExtensionCommandContext): Promise<void> {
  const running = currentWebServer();
  if (!running) {
    ctx.ui.notify("bot-lobby web is not running.", "warning");
    return;
  }
  await running.close();
  latestLink = undefined;
  heartbeat();
  showAddress(ctx, undefined);
  ctx.ui.notify("bot-lobby web stopped; it starts again with the next session.", "info");
}

function resetCommand(ctx: ExtensionCommandContext): void {
  const running = currentWebServer();
  if (!running) {
    ctx.ui.notify("bot-lobby web is not running; /bot-lobby web starts it.", "warning");
    return;
  }
  const link = running.reset();
  latestLink = link;
  heartbeat();
  ctx.ui.notify(`bot-lobby web: the link changed: ${link}`, "info");
}

/** Close the page's server when bot-lobby is turned off; quiet, and nothing when it is not running. */
export async function stopWebServer(ctx: ExtensionContext): Promise<void> {
  const running = currentWebServer();
  if (!running) return;
  await running.close();
  latestLink = undefined;
  heartbeat();
  showAddress(ctx, undefined);
}

/** Run one `web` subcommand; a failure is a notice, never a throw. */
export async function webCommand(ctx: ExtensionCommandContext, word: string | undefined, deps?: WebCommandDeps): Promise<void> {
  const action = webAction(word);
  if (!action) {
    ctx.ui.notify("Usage: /bot-lobby web [stop|link|reset]", "warning");
    return;
  }
  try {
    if (action === "start") await startCommand(ctx, deps);
    else if (action === "stop") await stopCommand(ctx);
    else if (action === "reset") resetCommand(ctx);
    else linkCommand(ctx);
  } catch (error) {
    ctx.ui.notify(`bot-lobby web failed — ${(error as Error).message}`, "warning");
  }
}

/**
 * On `session_start` (and when bot-lobby is turned on): follow the fresh
 * lobby service, and start the server (the first time) with the browser
 * opening on it. The page runs while bot-lobby is on in an interactive
 * session; off, a subagent or a one-shot run serves nothing.
 */
export function webSessionStarted(ctx: ExtensionContext, deps?: WebCommandDeps): void {
  if (isSubagentProcess() || !servesPage(ctx)) return;
  const service = resolveService(deps);
  const running = currentWebServer();
  if (running) {
    if (service) running.rebind(service);
    return;
  }
  if (!service) return;
  startWebServer({ service, port: loadConfig().lobby.web.port })
    .then((server) => {
      latestLink = server.link;
      heartbeat();
      showAddress(ctx, server.port);
      ctx.ui.notify(`bot-lobby web: ${server.link}`, "info");
      openLink(server.link, deps);
    })
    .catch((error: Error) => ctx.ui.notify(`bot-lobby web could not start — ${error.message}`, "warning"));
}

/** Wire the web server's lifecycle; called with the other session wiring. */
export function registerWebServer(pi: ExtensionAPI): void {
  if (isSubagentProcess()) return;
  pi.on("session_start", (_event, ctx) => webSessionStarted(ctx));
}
