import { defineConfig } from "@playwright/test";

// Only Chromium may inherit the container's executable and Chromium flags.
const chromiumLaunch = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] }
  : undefined;

/** Fixture-backed browser checks. Desktop dark keeps its @theme filtering. */
export default defineConfig({
  testDir: "test/web",
  fullyParallel: true,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "light", use: { browserName: "chromium", colorScheme: "light", launchOptions: chromiumLaunch } },
    { name: "dark", grep: /@theme/, use: { browserName: "chromium", colorScheme: "dark", launchOptions: chromiumLaunch } },
  ],
});
