/**
 * Open DSH Web, dismiss the first-run notice, open the plugin's page from the
 * left sidebar, and check that it rendered without console errors.
 *
 *   node scripts/dsh/ui-check.mjs [url] [--label "Bot Lobby"] [--testid bot-lobby-page] [--shot ui-check.png]
 *
 * Without a URL it reads the tokenized one from $DSH_HOME/web.log, which
 * start-web.sh writes. Needs `playwright-core` (a devDependency) and a Chromium:
 * CHROMIUM_PATH names one, otherwise Playwright's own is used. Exits 1 when the
 * test id is missing or the page logged errors, so CI can gate on it.
 *
 * Adapted from the check that verified the probe plugin in DSH 0.2.0-rc.2. That
 * check opened the panel through `ctx.layout.selectPanel()` exposed on window;
 * this one clicks the sidebar entry by its label, which is what a user does.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: "string", default: "Bot Lobby" },
    testid: { type: "string", default: "bot-lobby-page" },
    shot: { type: "string", default: "ui-check.png" },
    settle: { type: "string", default: "6000" },
  },
});

function urlFromLog() {
  const home = process.env.DSH_HOME ?? join(repo, ".dsh-home");
  try {
    return readFileSync(join(home, "web.log"), "utf8").match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)?.[0];
  } catch {
    return undefined;
  }
}

const url = positionals[0] ?? urlFromLog();
if (!url) {
  console.error("No DSH URL: pass one, or start DSH with start-web.sh first.");
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(Number(values.settle));
  // The first run of a DSH home shows a Preview Notice; Continue dismisses it.
  const notice = page.getByRole("button", { name: "Continue" });
  if (await notice.count()) await notice.first().click();
  await page.getByText(values.label, { exact: true }).first().click();
  await page.waitForTimeout(2500);
  const found = await page.locator(`[data-testid="${values.testid}"]`).count();
  const models = await page.locator('[data-testid="bot-lobby-models"] li').count();
  await page.screenshot({ path: values.shot });
  console.log(`page: ${found} | models listed: ${models} | screenshot: ${values.shot}`);
  console.log(`errors: ${JSON.stringify(errors)}`);
  process.exitCode = found > 0 && errors.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
