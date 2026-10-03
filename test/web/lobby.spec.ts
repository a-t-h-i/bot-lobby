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
type Element = any;

const SIZES = [
  { width: 768, height: 1024 },
  { width: 800, height: 1280 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const SCENARIOS = ["full", "empty", "question"] as const;

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

/** Every visible button and tab pill keeps a ≥28 px target: compact on purpose, above WCAG 2.2's 24 px minimum (D-09, D-23). */
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
      if (heightOf(el) < 28) {
        const label = (el.textContent ?? "").trim().slice(0, 28).replace(/\s+/g, " ");
        misses.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(rect.height)}px`);
      }
    }
    return misses;
  });
}

async function expectShell(page: Page, tabs: number): Promise<void> {
  await expect(page.locator("header").getByText("bot-lobby", { exact: true }), "header").toBeVisible();
  await expect(page.getByRole("tab"), `eight pills`).toHaveCount(tabs);
  await expect(page.locator("#main"), "main pane").toBeVisible();
  await expect(page.getByLabel("Message the oracle"), "composer").toBeVisible();
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
      await expectShell(page, 8);
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
  await expect(main.getByText("Add offline mock fixtures", { exact: true }), "task header").toBeVisible();
  await expect(main.getByRole("log", { name: "Conversation" }), "conversation").toBeVisible();
  await expect(main.getByRole("log", { name: "Activity" }), "activity").toBeVisible();
  await expect(main.getByText("Thinking", { exact: true }).first(), "thoughts").toBeVisible();
  await expect(main.getByText("fixtures per scenario"), "seeded chat").toBeVisible();
  await page.getByLabel("Message the oracle").fill("hello mock");
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
  await page.getByLabel("Message the oracle").fill("go");
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
  test(`touch targets ≥28px (${scenario})`, async ({ page, server }) => {
    await openScenario(page, server, scenario);
    await page.setViewportSize({ width: 1280, height: 800 });
    // The pop-up springs in; measure once it has settled.
    await page.waitForTimeout(900);
    expect(await touchTargetMisses(page), "touch targets ≥28px").toEqual([]);
  });
}

test("markdown never runs page scripts", async ({ page, server }: { page: Page; server: MockServer }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => void ((window as unknown as { __xss?: number }).__xss = undefined));
  await page.getByLabel("Message the oracle").fill('<img src=x onerror="window.__xss=1">');
  await page.getByRole("button", { name: "Send" }).click();
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation).toContainText("img src=x");
  expect(await page.locator("img").count(), "no img element").toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), "no script ran").toBeUndefined();
});

test("contrast meets 4.5:1", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
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
