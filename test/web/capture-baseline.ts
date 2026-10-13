/**
 * Larger-screen reference captures, before the phone redesign.
 * Run: npm run web:build && node test/web/capture-baseline.ts
 * After-shots: OUT_DIR=/tmp/phone-after node test/web/capture-baseline.ts
 * Uses the existing Playwright config and signed-in fixture server, Chromium only.
 * Height is always 900px; internal scroll panes remain at their initial position.
 * Issues uses the `issues` scenario (it is disabled in `full`); others use `full`.
 * No sound controls are exercised; Chromium audio output is muted.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Match the existing browser tests' DOM ambient (the root tsconfig has no DOM lib).
declare const document: any;
declare const window: any;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultOutDir = join(root, "test/web/phone-baseline");
const outDir = resolve(process.env.OUT_DIR ?? defaultOutDir);
const widths = [768, 800, 1024, 1280, 1440];
const themes = ["light", "dark"] as const;
const screens = ["lobby", "tasks", "plan", "git/issues", "quickfix", "git", "knowledge", "metrics", "settings", "sessions"];
const content: Record<string, string> = {
  lobby: "We need an offline mock",
  tasks: "Add offline mock fixtures",
  plan: "Plan dark mode for the lobby",
  issues: "Dark mode flashes white on load",
  quickfix: "Fix the typo in the header",
  git: "Add the dark mode toggle",
  knowledge: "Engineering standards",
  metrics: "mock-model",
  sessions: "Mock background task",
};

function verifyRegistry(): void {
  const registry = readFileSync(join(root, "webui/src/tabs/registry.tsx"), "utf8");
  const tabs = [...registry.matchAll(/case "([a-z]+)":/g)].map((match) => match[1]!);
  const expected = [...tabs, "settings", "sessions"].sort();
  if (JSON.stringify(expected) !== JSON.stringify([...screens].sort())) {
    throw new Error(`Update the capture inventory to match registry screens: ${expected.join(", ")}`);
  }
}

function runPlaywright(): void {
  const temporary = mkdtempSync(join(tmpdir(), "phone-baseline-"));
  const configPath = join(temporary, "capture.config.ts");
  const original = join(root, "playwright.config.ts");
  const config = `import original from ${JSON.stringify(original)};
const chromiumLaunch = original.projects?.find(project => project.use?.browserName === "chromium")?.use?.launchOptions;
export default {
  ...original,
  testDir: ${JSON.stringify(join(root, "test/web"))},
  testMatch: "capture-baseline.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: ${JSON.stringify(join(temporary, "results"))},
  projects: ["light", "dark"].map(name => ({
    name,
    use: {
      ...original.use,
      browserName: "chromium",
      colorScheme: name,
      launchOptions: {
        ...chromiumLaunch,
        args: [...(chromiumLaunch?.args ?? []), "--mute-audio"],
      },
    },
  })),
};
`;
  try {
    writeFileSync(configPath, config);
    const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
    const result = spawnSync(process.execPath, [cli, "test", "--config", configPath], {
      cwd: root, stdio: "inherit", env: { ...process.env, OUT_DIR: outDir, PHONE_BASELINE_RUNNER: "1" }, timeout: 600_000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

verifyRegistry();
if (process.env.PHONE_BASELINE_RUNNER === "1") {
  const { expect, openScenario, test } = await import("./fixture.ts");
  for (const width of widths) {
    test(`larger-screen baseline ${width}px`, async ({ page, server }, info) => {
      test.setTimeout(180_000);
      const theme = info.project.name;
      mkdirSync(outDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      for (const screen of screens) {
        const capturePath = join(outDir, `${width}-${theme}-${screen}.png`);
        if (outDir === defaultOutDir && existsSync(capturePath) && statSync(capturePath).size > 0) continue;
        await test.step(`${theme} ${screen}`, async () => {
          const trap = await openScenario(page, server, screen === "issues" ? "issues" : "full");
          await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
          if (screen === "settings" || screen === "sessions") {
            await page.evaluate((id) => { window.location.hash = `#/${id}`; }, screen);
          } else {
            const tab = page.locator(`#tab-${screen}`);
            await tab.click();
            await expect(tab).toHaveAttribute("aria-selected", "true");
          }
          await expect(page).toHaveURL(new RegExp(`#/${screen}$`));
          if (screen === "settings") {
            await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
          } else {
            await expect(page.locator("#main")).toContainText(content[screen]!);
          }
          await page.evaluate(async () => { await document.fonts.ready; });
          // Allow the existing tab pour, icon and page entrance animations to finish.
          await page.mouse.move(width - 1, 899);
          await page.waitForTimeout(1000);
          expect(trap.errors, `${screen}: no console/page errors`).toEqual([]);
          trap.stop();
          await page.screenshot({ path: capturePath, fullPage: true });
        });
      }
    });
  }
} else {
  runPlaywright();
  if (!process.exitCode) {
    for (const width of widths) for (const theme of themes) for (const screen of screens) {
      const path = join(outDir, `${width}-${theme}-${screen}.png`);
      if (statSync(path).size === 0) throw new Error(`Empty capture: ${path}`);
    }
    console.log(`Verified ${widths.length * themes.length * screens.length} non-empty PNGs in ${outDir}`);
  }
}
