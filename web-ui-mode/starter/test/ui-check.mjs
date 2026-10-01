/**
 * The page in a real Chromium at phone, tablet and desktop sizes, against
 * the fake oracle: sign in through the link, send a message, watch the reply
 * stream in as Markdown, and check what must never happen (a horizontal page
 * scroll, a script from the reply running, the token left in the address bar,
 * a console error). Saves a screenshot per size and theme.
 *
 *   npm run build && npm run ui-check            (CHROMIUM_PATH names a Chromium; else Playwright's)
 *   node test/ui-check.mjs --out shots/
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { out: { type: "string", default: join(root, "shots") } } });
await mkdir(values.out, { recursive: true });

const SIZES = [
  { name: "phone", width: 360, height: 780, touch: true },
  { name: "phone-large", width: 412, height: 915, touch: true },
  { name: "tablet-portrait", width: 800, height: 1280, touch: true },
  { name: "tablet-landscape", width: 1280, height: 800, touch: true },
  { name: "desktop", width: 1440, height: 900, touch: false },
];

const server = spawn(process.execPath, [join(root, "server/dev.ts")], { stdio: ["ignore", "pipe", "inherit"] });
const link = await new Promise((resolve, reject) => {
  server.stdout.on("data", (chunk) => {
    const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\/#token=[\w-]+/);
    if (match) resolve(match[0]);
  });
  setTimeout(() => reject(new Error("the dev server printed no link")), 10_000);
});

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

try {
  for (const size of SIZES) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch && size.width < 1000, colorScheme: scheme });
      const page = await context.newPage();
      const errors = [];
      let dialogs = 0;
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("dialog", (dialog) => {
        dialogs += 1;
        void dialog.dismiss();
      });
      const label = `${size.name} ${scheme}`;

      await page.goto(link);
      await page.getByTestId("app").waitFor({ timeout: 10_000 });
      check(!page.url().includes("token="), `${label}: the token left the address bar`);

      // The fake oracle keeps one conversation for every run, so wait for this run's reply to be added.
      const replies = page.getByTestId("chat-message").filter({ hasText: "Here is the plan" });
      const before = await replies.count();
      await page.getByTestId("composer-input").fill("Plan dark mode, please.");
      await page.getByTestId("composer-send").click();
      await page.getByTestId("chat-reply").waitFor({ timeout: 5000 });
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="chat-message"]').length > 0 && [...document.querySelectorAll('[data-testid="chat-message"]')].filter((element) => element.textContent?.includes("Here is the plan")).length > count, before, { timeout: 15_000 });
      const last = replies.last();
      check((await last.locator("strong").count()) > 0 && (await last.locator("pre code").count()) > 0 && (await last.locator("table").count()) > 0, `${label}: the reply rendered as Markdown (bold, code block, table)`);
      check((await last.locator("img[onerror]").count()) === 0 && dialogs === 0, `${label}: HTML in the reply did not run`);
      check((await last.locator('a[rel~="noopener"][target="_blank"]').count()) === 1, `${label}: links open in a new tab without the opener`);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, `${label}: no horizontal page scroll (${overflow}px)`);

      if (size.width < 1024) {
        await page.getByTestId("pane-activity").click();
        check(await page.getByTestId("activity-row").first().isVisible(), `${label}: the activity pane opens`);
        await page.screenshot({ path: join(values.out, `${size.name}-${scheme}-activity.png`) });
        await page.getByRole("tab", { name: "Conversation" }).click();
      } else {
        check(await page.getByTestId("activity-row").first().isVisible(), `${label}: the activity log sits beside the conversation`);
      }
      const tapTargets = await page.evaluate(() => [...document.querySelectorAll("button:not([disabled]), textarea")].filter((element) => element.getBoundingClientRect().height > 0 && element.getBoundingClientRect().height < 36).length);
      check(tapTargets === 0, `${label}: every button and field is at least 36px tall`);
      await page.screenshot({ path: join(values.out, `${size.name}-${scheme}.png`) });

      await page.reload();
      await page.getByTestId("app").waitFor({ timeout: 10_000 });
      check(true, `${label}: a reload stays signed in (cookie)`);
      check(errors.length === 0, `${label}: no console errors ${errors.length ? JSON.stringify(errors) : ""}`);
      await context.close();
    }
  }

  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto(link.replace(/#token=.*/, ""));
  await page.getByTestId("signed-out").waitFor({ timeout: 10_000 });
  check(true, "without the link's token the page asks for it");
  const wrong = await stranger.newPage();
  await wrong.goto(link.replace(/#token=.*/, "#token=wrong"));
  await wrong.getByTestId("signed-out").waitFor({ timeout: 10_000 });
  check(true, "a wrong token is refused");
  await stranger.close();
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exitCode = failures.length ? 1 : 0;
