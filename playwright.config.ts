import { defineConfig, type Project } from "@playwright/test";

// Only Chromium may inherit the container's executable and Chromium flags.
const chromiumLaunch = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] }
  : undefined;
const phoneFiles = /phone-(carousel|screens)\.spec\.ts/;
const phoneProjects: Project[] = ["chromium", "webkit"].flatMap((browser) =>
  (["light", "dark"] as const).flatMap((colorScheme) =>
    [320, 390, 767].map((width) => ({
      name: `phone-${browser}-${colorScheme}-${width}`,
      testMatch: phoneFiles,
      use: {
        browserName: browser as "chromium" | "webkit",
        colorScheme,
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        ...(browser === "chromium" ? { launchOptions: chromiumLaunch } : {}),
      },
    })),
  ),
);

/** Fixture-backed browser checks. Desktop dark keeps its @theme filtering;
 * dedicated phone projects run every phone contract in both themes. */
export default defineConfig({
  testDir: "test/web",
  fullyParallel: true,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "light", testIgnore: phoneFiles, use: { browserName: "chromium", colorScheme: "light", launchOptions: chromiumLaunch } },
    { name: "dark", testIgnore: phoneFiles, grep: /@theme/, use: { browserName: "chromium", colorScheme: "dark", launchOptions: chromiumLaunch } },
    { name: "light-320", testIgnore: phoneFiles, testMatch: /(?:refresh|feedback)\.spec\.ts/, use: { browserName: "chromium", colorScheme: "light", viewport: { width: 320, height: 740 }, hasTouch: true, launchOptions: chromiumLaunch } },
    ...phoneProjects,
  ],
});
