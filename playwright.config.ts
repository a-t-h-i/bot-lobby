import { defineConfig } from "@playwright/test";

/**
 * Phase 3 browser checks (P3-04/P3-05/P0-01): the shell, the Lobby tab and
 * the questionnaire slideout against the fixture-backed mock server. No
 * `webServer` entry — the fixture in `test/web/fixture.ts` starts the real
 * `startWebServer` with `createFixtureService` in-process, one per worker.
 * Chromium only, at the cached `chromium-1234` revision (`@playwright/test`
 * 1.62.0); four desktop/tablet sizes per check, light plus dark.
 */
export default defineConfig({
  testDir: "test/web",
  fullyParallel: true,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "light", use: { browserName: "chromium", colorScheme: "light" } },
    { name: "dark", use: { browserName: "chromium", colorScheme: "dark" } },
  ],
});
