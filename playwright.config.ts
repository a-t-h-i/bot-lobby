import { defineConfig } from "@playwright/test";

/**
 * Browser checks: the shell, every tab and the question pop-up against the
 * fixture-backed mock server. No
 * `webServer` entry — the fixture in `test/web/fixture.ts` starts the real
 * `startWebServer` with `createFixtureService` in-process, one per worker.
 * Chromium only, at the cached `chromium-1234` revision (`@playwright/test`
 * 1.62.0); four desktop/tablet sizes per check. Every check runs in light;
 * dark mode only swaps colour tokens, so only the checks tagged `@theme`
 * (colours, contrast, shadows, the theme pickers) run again in dark.
 */
export default defineConfig({
  testDir: "test/web",
  fullyParallel: true,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    trace: "off",
    screenshot: "off",
    video: "off",
    // CHROMIUM_PATH points at a browser installed elsewhere (a container with its own Chromium).
    ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } } : {}),
  },
  projects: [
    { name: "light", use: { browserName: "chromium", colorScheme: "light" } },
    { name: "dark", grep: /@theme/, use: { browserName: "chromium", colorScheme: "dark" } },
    { name: "light-320", testMatch: /(?:refresh|feedback)\.spec\.ts/, use: { browserName: "chromium", colorScheme: "light", viewport: { width: 320, height: 740 }, hasTouch: true } },
  ],
});
