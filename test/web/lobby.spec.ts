/**
 * Browser checks: the shell, the Lobby tab and the question pop-up, each at 768×1024, 800×1280, 1280×800 and
 * 1440×900 in light and dark (the two config projects), against the
 * `full`, `empty` and `question` fixture sets.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, openScenario, test, type ErrorTrap, type MockServer, type Page } from "./fixture.ts";

/** DOM ambient for `page.evaluate` callbacks (the root tsconfig has no DOM lib). */
declare const document: any;
declare const window: any;
declare const getComputedStyle: any;

const SIZES = [
  { width: 768, height: 1024 },
  { width: 800, height: 1280 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const SCENARIOS = ["full", "empty", "question"] as const;

test("toolbar actions have spacing and readable contrast @theme", async ({ page, server }) => {
  await openScenario(page, server, "empty");
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".toolbar-button")];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      const luminance = (color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value: number) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      };
      const contrast = buttons.map((button: any) => {
        const style = getComputedStyle(button);
        const a = luminance(style.color);
        const b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      const gap = (a: any, b: any) => b.getBoundingClientRect().left - a.getBoundingClientRect().right;
      // The app's switches sit side by side at the foot of the open sidebar.
      const tools = [...document.querySelectorAll("#app-sidebar .sidebar-foot > div > *")];
      const actions = [...document.querySelectorAll("#app-dock [data-chat-composer-actions] > *")].filter((el: any) => el.getBoundingClientRect().width > 0);
      return { contrast, sidebarGaps: tools.slice(1).map((button: any, i: number) => gap(tools[i], button)), composerGap: gap(actions[0], actions[1]) };
    });
    expect(Math.min(...metrics.contrast), "icons contrast with their button surface").toBeGreaterThanOrEqual(4.5);
    // Read again until the sidebar has settled: it may still be sliding in after the resize.
    if (metrics.sidebarGaps.length) await expect.poll(() => page.evaluate(() => {
      const tools = [...document.querySelectorAll("#app-sidebar .sidebar-foot > div > *")];
      return Math.min(...tools.slice(1).map((button: any, i: number) => button.getBoundingClientRect().left - tools[i]!.getBoundingClientRect().right));
    }), "the sidebar's switches keep apart").toBeGreaterThanOrEqual(2);
    expect(metrics.composerGap, "Attach and Send have room between them").toBeGreaterThanOrEqual(7);
    await expectNoSidewaysScroll(page);
  }
});

function cspErrors(trap: ErrorTrap): string[] {
  return trap.errors.filter((text) => /content[ -]security|refus/i.test(text));
}

/** The page must never scroll sideways at desktop/tablet widths. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, "no sideways scroll").toBeLessThanOrEqual(1);
}

/** Every visible button and tab pill keeps a ≥24 px target: compact on purpose, WCAG 2.2's minimum (D-09, D-23). */
async function touchTargetMisses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const misses: string[] = [];
    const heightOf = (el: any): number => {
      const rect = el.getBoundingClientRect();
      let grown = rect.height;
      for (const pseudo of ["::before", "::after"]) {
        const style = getComputedStyle(el, pseudo as "::before");
        if (style.content === "none" || style.content === "") continue;
        for (const side of ["top", "bottom"] as const) {
          const value = Number.parseFloat(style[side]);
          if (Number.isFinite(value) && value < 0) grown += -value;
        }
      }
      return grown;
    };
    for (const el of document.querySelectorAll("button, [role='tab']")) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (heightOf(el) < 24) {
        const label = (el.textContent ?? "").trim().slice(0, 28).replace(/\s+/g, " ");
        misses.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(rect.height)}px`);
      }
    }
    return misses;
  });
}

async function expectShell(page: Page, tabs: number): Promise<void> {
  const project = page.getByRole("combobox", { name: "Project", exact: true });
  await expect(project, "the project, over the composer").toBeVisible();
  await expect(project).toContainText("bot-lobby");
  await expect(page.getByRole("tab"), `five pills`).toHaveCount(tabs);
  await expect(page.locator("#main"), "main pane").toBeVisible();
  await expect(page.getByLabel("Message the team"), "composer").toBeVisible();
}

for (const scenario of SCENARIOS) {
  test(`shell renders (${scenario})`, async ({ page, server }) => {
    const trap = await openScenario(page, server, scenario);
    if (scenario === "question") {
      // The question pop-up is modal; put it away to look at the shell behind it (once it has opened).
      const popup = page.getByRole("dialog", { name: "Question from the lobby" });
      await popup.waitFor();
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "hidden" });
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expectShell(page, 5);
      await expectNoSidewaysScroll(page);
    }
    expect(cspErrors(trap), "no CSP violations").toEqual([]);
    expect(trap.errors, "no console errors").toEqual([]);
    trap.stop();
  });
}

test("lobby tab streams a reply and stops", async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  const main = page.locator("#main");
  await expect(main.getByRole("group", { name: "Task" }), "no task tracker: a task's steps live in Tasks").toHaveCount(0);
  await expect(main.getByRole("log", { name: "Conversation" }), "conversation").toBeVisible();
  await expect(main.getByRole("heading", { name: "Conversation", exact: true }), "redundant strip removed").toHaveCount(0);
  await expect(main.getByRole("log", { name: "Conversation" }).getByRole("button", { name: /steps/ }), "activity, in the conversation").toBeVisible();
  await expect(page.getByRole("button", { name: "Open Thinking" }), "thoughts open from the bubble").toBeVisible();
  await expect(main.getByText("fixtures per scenario"), "seeded chat").toBeVisible();
  await page.getByLabel("Message the team").fill("hello mock");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" }), "Stop while busy").toBeVisible();
  await expect(main.getByRole("log", { name: "Conversation" })).toContainText("Mock plan");
  await expectNoSidewaysScroll(page);
  expect(cspErrors(trap), "no CSP violations").toEqual([]);
  expect(trap.errors, "no console errors").toEqual([]);
  trap.stop();
});

test("questionnaire slideout answers and dismisses", async ({ page, server }) => {
  const trap = await openScenario(page, server, "question");
  await page.setViewportSize({ width: 1280, height: 800 });
  const slideout = page.locator('section[aria-label="Question from the lobby"]');
  await expect(slideout, "seeded question").toContainText("Start the mock server on 7347?");
  await slideout.getByRole("button", { name: "Yes" }).click();
  await expect(slideout, "one answer dismisses it").toBeHidden();
  await page.getByLabel("Message the team").fill("go");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("#main")).toContainText("One question first");
  await expect(slideout, "slideout after a send").toContainText("Which set should stream next?");
  await slideout.locator("label", { hasText: "Full lobby" }).click();
  await slideout.getByRole("button", { name: "Answer" }).click();
  await expect(slideout, "questionnaire dismissed").toBeHidden();
  await expectNoSidewaysScroll(page);
  expect(cspErrors(trap), "no CSP violations").toEqual([]);
  expect(trap.errors, "no console errors").toEqual([]);
  trap.stop();
});

test("keyboard jumps, arrows and help", async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  const tabs = page.getByRole("tab");
  await page.locator("#main").click();
  await page.keyboard.press("Alt+2");
  await expect(tabs.nth(1), "Alt+2 jumps").toHaveAttribute("aria-selected", "true");
  // A jump leaves the cursor in the message box, where Alt+N would be typing; Esc steps out to the tab bar first.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+1");
  await expect(tabs.first(), "Alt+1 jumps").toHaveAttribute("aria-selected", "true");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1), "arrows move along the strip").toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1), "arrowed tab takes focus").toBeFocused();
  await page.keyboard.press("Alt+h");
  await expect(page.getByRole("dialog", { name: "Keys" }), "Alt+H opens help").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keys" }), "Esc closes help").toBeHidden();
  expect(cspErrors(trap), "no CSP violations").toEqual([]);
  expect(trap.errors, "no console errors").toEqual([]);
  trap.stop();
});

for (const scenario of ["full", "question"] as const) {
  test(`touch targets ≥24px (${scenario})`, async ({ page, server }) => {
    await openScenario(page, server, scenario);
    await page.setViewportSize({ width: 1280, height: 800 });
    // The pop-up springs in; measure once it has settled.
    await page.waitForTimeout(900);
    expect(await touchTargetMisses(page), "touch targets ≥24px").toEqual([]);
  });
}

test("markdown never runs page scripts", async ({ page, server }: { page: Page; server: MockServer }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => void ((window as unknown as { __xss?: number }).__xss = undefined));
  await page.getByLabel("Message the team").fill('<img src=x onerror="window.__xss=1">');
  await page.getByRole("button", { name: "Send" }).click();
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation).toContainText("img src=x");
  expect(await page.locator("img").count(), "no img element").toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), "no script ran").toBeUndefined();
});

test("the Lobby fills the window: the page never scrolls, each pane does, and Thinking waits in its bubble", async ({ page, server }) => {
  // A conversation longer than any window, so the pane has something to scroll.
  await page.route("**/api/lobby.snapshot", async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    const extra = Array.from({ length: 24 }, (_, i) => ({ id: 5000 + i, at: 1, role: i % 2 ? "oracle" : "you", text: `filler message ${i}` }));
    envelope.result.chat = [...extra, ...envelope.result.chat];
    await route.fulfill({ response, json: envelope });
  });
  await openScenario(page, server, "full");
  for (const size of SIZES.filter((entry) => entry.width === 1280 || entry.width === 768)) {
    await page.setViewportSize(size);
    await expect(page.getByRole("button", { name: "Open Thinking" })).toBeVisible();
    const run = await page.evaluate(() => {
      const el = document.getElementById("main") as any;
      el.scrollTop = 400;
      const conversation = document.querySelector('[role="log"][aria-label="Conversation"]') as any;
      return { main: { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop }, chat: { scrollHeight: conversation.scrollHeight, clientHeight: conversation.clientHeight } };
    });
    expect(run.main.scrollHeight, `${size.width}: #main has nothing to scroll`).toBe(run.main.clientHeight);
    expect(run.main.scrollTop, `${size.width}: forcing a scroll leaves it at the top`).toBe(0);
    expect(run.chat.scrollHeight, `${size.width}: the conversation pane scrolls on its own`).toBeGreaterThan(run.chat.clientHeight);
  }
  await page.getByRole("button", { name: "Open Thinking" }).click();
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true }), "the bubble opens the thoughts").toBeVisible();
});

test("the conversation follows new steps, lets a reader who scrolled up stay put, and jumps back on request", async ({ page, server }) => {
  await openScenario(page, server, "full");
  // A short window so the conversation overflows and following is visible.
  await page.setViewportSize({ width: 1280, height: 480 });
  const log = page.locator('[role="log"][aria-label="Conversation"]');
  await expect(log).toBeVisible();
  await log.getByRole("button", { name: /10 steps/ }).click();
  const steps = log.getByRole("list", { name: "Activity" });
  await expect(steps).toBeVisible();
  expect(await log.evaluate((el: any) => el.scrollHeight > el.clientHeight), "the chat overflows, so following is visible").toBe(true);
  const gap = () => log.evaluate((el: any) => Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight));
  await log.evaluate((el: any) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(gap, { message: "it rests at its newest line" }).toBeLessThanOrEqual(2);
  // A window that changes size keeps a following reader on the newest line.
  await page.setViewportSize({ width: 1280, height: 520 });
  await expect.poll(gap, { message: "a resize keeps it at the bottom" }).toBeLessThanOrEqual(2);
  server.log("MASTER", "a step that arrives while following");
  await expect(steps).toContainText("a step that arrives while following");
  await expect.poll(gap, { message: "a new step keeps following" }).toBeLessThanOrEqual(2);
  // A reader who scrolled up is left where they are, with a way back.
  await log.evaluate((el: any) => {
    el.scrollTop = 0;
  });
  const jump = page.getByRole("region", { name: "Conversation" }).getByRole("button", { name: "Jump to latest" });
  await expect(jump, "scrolling up offers the way back").toBeVisible();
  await expect(jump, "just an arrow, no words").toHaveText("");
  await jump.hover();
  const bounce = await jump.locator("svg").evaluate((el: any) => el.getAnimations().map((a: any) => ({ name: a.animationName, iterations: a.effect.getComputedTiming().iterations })));
  expect(bounce, "hovering bounces the arrow once").toEqual([{ name: "jump-latest-bounce", iterations: 1 }]);
  await page.screenshot({ path: test.info().outputPath("jump-latest.png") });
  server.log("MASTER", "a step the reader has not caught up with");
  await expect(steps).toContainText("a step the reader has not caught up with");
  expect(await log.evaluate((el: any) => el.scrollTop), "the reader is not pulled away from what they were reading").toBeLessThanOrEqual(2);
  await jump.click();
  await expect.poll(gap, { message: "Jump to latest lands on the newest line" }).toBeLessThanOrEqual(2);
});

const SWITCHES = ["Keyboard shortcuts", "Switch to dark mode|Switch to light mode", "Mute prompt sounds|Unmute prompt sounds"];

test("the sidebar holds the sessions, Settings and the app's switches; there is no Sessions page or task name in the bar, and the tabs sit centred", async ({ page, server }) => {
  await openScenario(page, server, "full");
  for (const width of [1280, 1000]) {
    await page.setViewportSize({ width, height: 800 });
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Settings", exact: true }), "Settings left the top bar").toHaveCount(0);
    for (const name of SWITCHES) await expect(header.getByRole("button", { name: new RegExp(`^(${name})$`) }), `${name} left the top bar`).toHaveCount(0);
    await expect(header.getByRole("combobox", { name: "Project", exact: true }), "so did the project").toHaveCount(0);
    await expect(header, "the bar does not name the task").not.toContainText("T-148");
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    // Open on a wide window, unpicked it starts folded off the page under 1024 px, with a way back at the start of the bar.
    const sideWidth = async () => (await sidebar.boundingBox())?.width ?? 0;
    if (width >= 1024) await expect.poll(sideWidth, "open, it lists the sessions").toBeGreaterThan(200);
    else await expect.poll(sideWidth, "folded away").toBeLessThan(2);
    // Once the sidebar has settled, the tabs sit centred in the bar beside it.
    await expect.poll(async () => {
      const bar = (await header.boundingBox())!;
      const tabs = (await header.getByRole("tablist").boundingBox())!;
      return Math.abs(tabs.x + tabs.width / 2 - (bar.x + bar.width / 2));
    }, `the tabs are centred at ${width}px`).toBeLessThan(2);
    if (width < 1024) {
      await header.getByRole("button", { name: "Expand sidebar" }).click();
      await expect.poll(sideWidth, "the bar's button brings it back").toBeGreaterThan(200);
      await expect(header.getByRole("button", { name: "Expand sidebar" }), "and steps aside").toHaveCount(0);
    }
    await expect(sidebar.getByRole("link", { name: "Sessions" }), "no Sessions page").toHaveCount(0);
    await expect(sidebar.getByRole("navigation", { name: "Sessions list" }), "the running sessions").toBeVisible();
    for (const name of SWITCHES) await expect(sidebar.getByRole("button", { name: new RegExp(`^(${name})$`) }), `${name} sits at the sidebar's foot`).toBeVisible();
  }
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const dark = () => page.locator("html").evaluate((el: any) => el.classList.contains("dark"));
  const was = await dark();
  await sidebar.getByRole("button", { name: /^Switch to (dark|light) mode$/ }).click();
  await expect.poll(dark, "the theme switch works from there").toBe(!was);
  await sidebar.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await page.evaluate(() => { (globalThis as any).location.hash = "#/sessions"; });
  await expect(page, "the old Sessions address lands on the Lobby").toHaveURL(/#\/lobby$/);
});

test("contrast meets 4.5:1", { tag: "@theme" }, async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  // Audit the label's settled colors while its agent names crossfade.
  await page.addStyleTag({ content: ".orb-label, .orb-label > span { opacity: 1 !important; transition: none !important; }" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = await new AxeBuilder({ page: page as any }).withRules(["color-contrast"]).analyze();
  const detail = results.violations.flatMap((v) =>
    v.nodes.map((n) => ({
      id: v.id,
      target: n.target.map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" "),
      summary: n.failureSummary,
    })),
  );
  expect(detail, "no color-contrast violations").toEqual([]);
});

test("scrolling past the end of a chat full of code never drags the Lobby page up", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1600, height: 1000 });
  const box = page.getByLabel("Message the team");
  // The scripted reply carries inline code; each code chip has a hidden screen-reader label.
  for (const text of ["one", "two", "three"]) {
    await box.fill(text);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Stop" })).toBeHidden({ timeout: 15_000 });
  }
  const main = page.locator("#main");
  const sizes = await main.evaluate((el: any) => [el.scrollHeight, el.clientHeight]);
  expect(sizes[0], "the page is no taller than the window").toBeLessThanOrEqual(sizes[1]);
  for (const name of ["Conversation"]) {
    const log = (await page.locator(`[role="log"][aria-label="${name}"]`).boundingBox())!;
    await page.mouse.move(log.x + log.width / 2, log.y + log.height / 2);
    for (let i = 0; i < 25; i += 1) await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    expect(await main.evaluate((el: any) => el.scrollTop), `${name}: the page stays where it is`).toBe(0);
  }
  await expect(page.getByRole("tab", { name: /Lobby/ }), "the tabs are still in view").toBeInViewport();
});
