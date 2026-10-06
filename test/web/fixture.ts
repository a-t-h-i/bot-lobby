/**
 * The Playwright fixture for the Phase 3 browser checks: the real loopback
 * server (`startWebServer`) backed by a fixture service
 * (`createFixtureService`), one server per worker, reseeded per scenario.
 * The server never touches `web.json` (tests pass an explicit secret).
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, type ConsoleMessage, type Page } from "@playwright/test";
import type { LobbyService } from "../../src/lobby/host.ts";
import { lobbyTopics, type LobbyTopic } from "../../src/lobby/topics.ts";
import { createFixtureService, disposeFixtureService } from "../../src/webui/dev/fake-service.ts";
import { startWebServer } from "../../src/webui/server.ts";

export interface MockServer {
  link: string;
  use: (scenario: string) => void;
  /** Append one activity entry to the live feed, so a test can watch the log react. */
  log: (source: string, text: string) => void;
  bump: (topic: LobbyTopic) => void;
  /** Stop the server, as pi stopping takes it down; the page keeps whatever it shows. */
  stop: () => Promise<void>;
  /** Start it again on the same port and secret, as pi coming back does; `change` adjusts the service first. */
  start: (change?: (service: LobbyService) => void) => Promise<void>;
}

export interface ErrorTrap {
  errors: string[];
  stop: () => void;
}

/** Collect console errors and uncaught page errors until `stop`. */
export function trapErrors(page: Page): ErrorTrap {
  const errors: string[] = [];
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === "error") errors.push(message.text());
  };
  const onCrash = (error: Error): void => {
    errors.push(String(error?.stack ?? error));
  };
  page.on("console", onConsole);
  page.on("pageerror", onCrash);
  return {
    errors,
    stop: () => {
      page.removeListener("console", onConsole);
      page.removeListener("pageerror", onCrash);
    },
  };
}

/** Reseed the worker server and load the page, trapping console errors. */
export async function openScenario(page: Page, server: MockServer, scenario: string): Promise<ErrorTrap> {
  server.use(scenario);
  const trap = trapErrors(page);
  await page.goto(server.link);
  // A question pop-up is modal, so the page behind it is hidden from the accessibility tree: wait on the DOM.
  await page.locator('[role="tablist"]').waitFor();
  return trap;
}

export const test = base.extend<object, { server: MockServer }>({
  page: async ({ page }, use) => {
    await use(page);
    // Finish in-flight response transformations while the request context is alive.
    await page.unrouteAll({ behavior: "wait" });
  },
  server: [
    async ({}, use) => {
      // An empty config directory of our own: the checks must never inherit the
      // developer's real `~/.pi/bot-lobby` (its folded panes would hide panes).
      const configDir = mkdtempSync(join(tmpdir(), "bot-lobby-web-"));
      process.env.BOT_LOBBY_CONFIG_DIR = configDir;
      let current: LobbyService = createFixtureService("full");
      const secret = randomBytes(32);
      let web = await startWebServer({ service: current, port: 0, secret });
      let up = true;
      const port = web.port;
      const mock: MockServer = {
        link: web.link,
        use: (scenario: string) => {
          disposeFixtureService(current);
          current = createFixtureService(scenario);
          web.rebind(current);
        },
        bump: (topic) => { lobbyTopics.bump(topic); },
        stop: async () => {
          if (!up) return;
          up = false;
          await web.close();
        },
        start: async (change) => {
          change?.(current);
          if (up) return;
          web = await startWebServer({ service: current, port, secret });
          up = true;
        },
        log: (source, text) => {
          (current.feed as { log: (source: string, text: string) => void }).log(source, text);
        },
      };
      await use(mock);
      disposeFixtureService(current);
      if (up) await web.close();
      rmSync(configDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
export type { Page };
