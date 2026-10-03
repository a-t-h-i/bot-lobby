/**
 * The Playwright fixture for the Phase 3 browser checks: the real loopback
 * server (`startWebServer`) backed by a fixture service
 * (`createFixtureService`), one server per worker, reseeded per scenario.
 * The server never touches `web.json` (tests pass an explicit secret).
 */
import { randomBytes } from "node:crypto";
import { test as base, type ConsoleMessage, type Page } from "@playwright/test";
import type { LobbyService } from "../../src/lobby/host.ts";
import { createFixtureService, disposeFixtureService } from "../../src/webui/dev/fake-service.ts";
import { startWebServer } from "../../src/webui/server.ts";

export interface MockServer {
  link: string;
  use: (scenario: string) => void;
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
  server: [
    async ({}, use) => {
      let current: LobbyService = createFixtureService("full");
      const web = await startWebServer({ service: current, port: 0, secret: randomBytes(32) });
      const mock: MockServer = {
        link: web.link,
        use: (scenario: string) => {
          disposeFixtureService(current);
          current = createFixtureService(scenario);
          web.rebind(current);
        },
      };
      await use(mock);
      disposeFixtureService(current);
      await web.close();
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
export type { Page };
