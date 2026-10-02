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

/**
 * Runs in the page: every visible element with its own text whose colour is
 * under 4.5:1 against the background behind it (D-19). Disabled controls and
 * decorative marks (aria-hidden) are exempt, as WCAG exempts them.
 */
function lowContrastText() {
  const parse = (value) => {
    const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return parts ? { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 } : undefined;
  };
  const luminance = ({ r, g, b }) =>
    [r, g, b].map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
  const behind = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) return color;
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255 };
  };
  const low = [];
  for (const element of document.querySelectorAll("body *")) {
    if (![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
    if (element.closest('[aria-hidden="true"], :disabled')) continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1 || getComputedStyle(element).visibility === "hidden") continue;
    const [lighter, darker] = [luminance(parse(getComputedStyle(element).color)), luminance(behind(element))].sort((a, b) => b - a);
    const ratio = (lighter + 0.05) / (darker + 0.05);
    if (ratio < 4.5) low.push(`${element.tagName.toLowerCase()}.${element.className} ${ratio.toFixed(2)} "${element.textContent.trim().slice(0, 24)}"`);
  }
  return low;
}

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
      // While the oracle works the composer has a stop key too; it must still fit.
      const busyOverflow = await page.evaluate((width) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - width, size.width);
      const sendBox = await page.getByTestId("composer-send").boundingBox();
      check(busyOverflow <= 0 && sendBox.x + sendBox.width <= size.width, `${label}: while the oracle works, nothing scrolls sideways and send stays on screen (${busyOverflow}px)`);
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="chat-message"]').length > 0 && [...document.querySelectorAll('[data-testid="chat-message"]')].filter((element) => element.textContent?.includes("Here is the plan")).length > count, before, { timeout: 15_000 });
      const settled = await page
        .getByTestId("chat-reply")
        .waitFor({ state: "detached", timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      check(settled, `${label}: a finished reply is no longer shown as streaming`);
      const last = replies.last();
      check((await last.locator("strong").count()) > 0 && (await last.locator("pre code").count()) > 0 && (await last.locator("table").count()) > 0, `${label}: the reply rendered as Markdown (bold, code block, table)`);
      check((await last.locator("img[onerror]").count()) === 0 && dialogs === 0, `${label}: HTML in the reply did not run`);
      check((await last.locator('a[rel~="noopener"][target="_blank"]').count()) === 1, `${label}: links open in a new tab without the opener`);

      // Against the device's width: on a phone, Chrome widens the layout viewport (innerWidth) to fit content that overflows.
      const overflow = await page.evaluate((width) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - width, size.width);
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
      const lowContrast = await page.evaluate(lowContrastText);
      check(lowContrast.length === 0, `${label}: all text is at least 4.5:1 against its background ${lowContrast.length ? JSON.stringify(lowContrast.slice(0, 5)) : ""}`);
      if (size.width >= 1024) {
        const [title, tab] = await Promise.all([page.locator(".title").boundingBox(), page.locator('.tab[aria-current="page"]').boundingBox()]);
        check(Math.abs(title.y + title.height / 2 - (tab.y + tab.height / 2)) < 4, `${label}: the tabs sit in the title line`);
      }
      await page.screenshot({ path: join(values.out, `${size.name}-${scheme}.png`) });

      await page.getByTestId("composer-input").fill("a draft");
      await page.locator(".tab", { hasText: "Tasks" }).click();
      check(await page.getByText("The Tasks tab is built in a later task").isVisible(), `${label}: another tab opens`);
      await page.locator(".tab", { hasText: "Lobby" }).click();
      check((await page.getByTestId("composer-input").inputValue()) === "a draft", `${label}: a draft in the composer survives a tab switch`);

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
