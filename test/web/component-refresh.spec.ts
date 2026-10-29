import { expect, openScenario, test, type Page } from "./fixture.ts";

declare const document: any;
declare const window: any;
declare const getComputedStyle: any;

test("effort is a dropdown that names every level, marks the recommended one and stays keyboard-first", { tag: "@theme" }, async ({ page, server }, info) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  const card = page.locator("section.glass", { hasText: "Backend" }).first();
  const trigger = card.getByRole("combobox", { name: "Backend effort" });
  await expect(trigger, "the saved level names itself on the trigger").toContainText("Medium");
  await trigger.click();
  const list = page.getByRole("listbox", { name: "Backend effort" });
  for (const name of ["Off", "Minimal", "Low", "Medium", "High", "Extra high", "Max"]) {
    await expect(list.getByRole("option", { name: new RegExp(`^${name}\\b`) }), "every level is listed").toBeVisible();
  }
  await expect(list.getByRole("option", { name: /^Max\b/ }), "each level says what it does").toContainText("As deep as the model goes.");
  const recommended = list.getByRole("option", { name: /^Medium\b/ });
  await expect(recommended, "the level this agent is meant to run at says so").toContainText("Recommended.");
  await expect(list.locator('[aria-disabled="true"]'), "pi supports every level, so nothing is unpickable here").toHaveCount(0);
  // The keyboard walks the list: two stops down from the saved level, Enter picks it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("Extra high");
  // The trigger opens on a key too, and the chosen option is marked in the list.
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(list).toBeVisible();
  await expect(list.getByRole("option", { name: /^Extra high\b/ })).toHaveAttribute("aria-selected", "true");
  await list.getByRole("option", { name: /^Max\b/ }).click();
  await expect(trigger).toContainText("Max");
  await page.keyboard.press("Escape");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: info.outputPath("effort-dropdown.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(trap.errors).toEqual([]);
  trap.stop();
});

test("a click on a level picks it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  const card = page.locator("section.glass", { hasText: "Backend" }).first();
  const trigger = card.getByRole("combobox", { name: "Backend effort" });
  await trigger.click();
  const list = page.getByRole("listbox", { name: "Backend effort" });
  await list.getByRole("option", { name: /^High\b/ }).click();
  await expect(trigger).toContainText("High");
  await trigger.click();
  await list.getByRole("option", { name: /^Off\b/ }).click();
  await expect(trigger).toContainText("Off");
});

test("a toast is centred over the composer, clear of it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  const card = page.locator("section.glass", { hasText: "Backend" }).first();
  await card.getByRole("combobox", { name: "Backend effort" }).click();
  await page.getByRole("listbox", { name: "Backend effort" }).getByRole("option", { name: /^High\b/ }).click();
  const toast = page.locator('[role="status"] > div').filter({ hasText: "Settings saved" });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const composer = (await page.locator(".group\\/composer").boundingBox())!;
  const dock = (await page.locator("#app-dock").boundingBox())!;
  const box = (await toast.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (composer.x + composer.width / 2)), "centred on the composer").toBeLessThan(2);
  expect(box.y + box.height, "above the composer and its strip").toBeLessThanOrEqual(dock.y + 1);
});

test("ReUI panels and Obsidian session cards keep the existing navigation and composer", async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const composer = page.locator(".group\\/composer");
  // Measure the box once any motion has settled.
  const settled = () => composer.evaluate((el: any) => Promise.all(el.getAnimations().map((animation: any) => animation.finished)));
  await settled();
  const before = (await composer.boundingBox())!;
  const tabs = page.getByRole("tablist");
  const tabsBefore = (await tabs.boundingBox())!;
  const toastOffset = () => page.locator('.fixed[aria-live="polite"]').evaluate((el: any) => getComputedStyle(el).bottom);
  const toastBefore = await toastOffset();
  await expect(page.getByRole("link", { name: "Sessions", exact: true }), "there is no Sessions page to go to").toHaveCount(0);
  await page.getByRole("tab", { name: /Metrics/ }).click();
  await expect(page.locator('[data-slot="frame-panel"]').first()).toBeVisible();
  await page.getByRole("tab", { name: /Lobby/ }).click();
  await expect(page.locator('[data-tab-fill]')).toBeAttached();
  await settled();
  const after = (await composer.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(await tabs.boundingBox()).toEqual(tabsBefore);
  expect(await toastOffset()).toBe(toastBefore);
  expect(trap.errors).toEqual([]);
  trap.stop();
});

test("metrics uses ReUI date filters, daily trends and model comparisons", { tag: "@theme" }, async ({ page, server }, info) => {
  await page.clock.setFixedTime(new Date("2026-10-04T12:00:00Z"));
  const requests: Array<Record<string, string>> = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/metrics.get")) requests.push(request.postDataJSON()); });
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: /Metrics/ }).click();
  const trends = page.getByRole("region", { name: "Daily runs", exact: true });
  await expect(trends).toBeVisible();
  await expect(trends.locator('[data-trend-bar]')).toHaveCount(3);
  await expect(trends.locator('svg > g[aria-hidden="true"] > text')).toHaveText(["0", "1"]);
  await expect(page.getByRole("region", { name: "Average run time", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("metrics-trends.png") });
  const period = page.getByRole("combobox", { name: "Metrics period" });
  async function choose(name: string) {
    await period.click();
    await expect(page.locator('[data-slot="select-content"]')).toBeVisible();
    await page.getByRole("option", { name, exact: true }).click();
  }
  await choose("Today");
  await expect.poll(() => requests.at(-1)?.from).toBe("2026-10-04");
  await expect(trends.locator('[data-trend-bar]')).toHaveCount(1);
  await expect(page.getByRole("region", { name: "All models", exact: true })).toContainText("minimal");
  await choose("Past 7 days");
  await expect.poll(() => requests.at(-1)?.from).toBe("2026-09-28");
  await expect.poll(() => requests.at(-1)?.to).toBe("2026-10-04");
  await expect(trends.locator('[data-trend-bar]')).toHaveCount(4);
  await choose("Date range");
  await page.getByLabel("Start date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("End date", { exact: true }).fill("2026-10-02");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.from).toBe("2026-10-01");
  await expect(trends.locator('[data-trend-bar]')).toHaveCount(2);
  await expect(page.getByRole("region", { name: "All models", exact: true })).not.toContainText("minimal");
  await page.getByLabel("End date", { exact: true }).fill("2026-09-30");
  const count = requests.length;
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("on or after");
  expect(requests.length).toBe(count);
  await choose("All time");
  await page.getByRole("tab", { name: /Lobby/ }).click();
  await page.getByRole("tab", { name: /Metrics/ }).click();
  const bar = trends.locator('[data-trend-bar]').first();
  const height = () => bar.evaluate((el: any) => el.height.baseVal.value);
  await expect(bar).toBeAttached();
  const initial = await height();
  await expect.poll(height).toBeGreaterThan(initial);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("tab", { name: /Lobby/ }).click();
  await page.getByRole("tab", { name: /Metrics/ }).click();
  await expect(bar).toBeAttached();
  await expect.poll(height).toBe(144);
  const still = await height();
  await page.waitForTimeout(100);
  expect(await height()).toBe(still);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(trap.errors).toEqual([]);
  trap.stop();
});

test("workspace panels have distinct fills and visible boundaries in both themes", { tag: "@theme" }, async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: /Metrics/ }).click();
  const panel = page.locator('[data-slot="frame-panel"]').first();
  await expect(panel).toBeVisible();
  const look = await panel.evaluate((el: any) => {
    const style = getComputedStyle(el);
    const main = getComputedStyle(document.getElementById("main"));
    return { panel: style.backgroundColor, ground: main.backgroundColor, border: style.borderTopColor, width: style.borderTopWidth };
  });
  expect(look.panel).not.toBe(look.ground);
  expect(look.border).not.toBe(look.panel);
  expect(look.width).toBe("1px");
  expect(trap.errors).toEqual([]);
  trap.stop();
});

/** Folds the composer by hand, as a scroll would. */
const setShrunk = (page: Page, shrunk: boolean) => page.evaluate((on: boolean) => {
  for (const el of [document.querySelector("#app-dock"), document.querySelector(".bubble")]) {
    if (on) el.setAttribute("data-shrunk", "");
    else el.removeAttribute("data-shrunk");
  }
}, shrunk);

/** How far the textarea's one line sits from the middle of the shrunk pill. */
const shrunkOffset = (page: Page) => page.evaluate(() => {
  const field = document.querySelector("#composer-text");
  const pill = document.querySelector(".bubble-composer").getBoundingClientRect();
  const box = field.getBoundingClientRect();
  const style = getComputedStyle(field);
  const middle = box.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2;
  return { centre: Math.abs(middle - (pill.top + pill.height / 2)), height: pill.height };
});

test("the shrunk composer centres its placeholder and typed line", { tag: "@theme" }, async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await setShrunk(page, true);
  await expect.poll(async () => (await shrunkOffset(page)).height, "a 44px pill").toBe(44);
  for (const value of ["", "typed line"]) {
    await page.locator("#composer-text").evaluate((el: any, v: string) => { el.value = v; }, value);
    expect((await shrunkOffset(page)).centre, `"${value}" sits mid-pill`).toBeLessThan(1.5);
  }
});

test("rounded task panes clip their frosted headers to the corner", { tag: "@theme" }, async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { window.location.hash = "#/tasks/T-mock-1"; });
  const panes = page.locator(".workspace-pane > [data-pane]");
  await expect(panes).toHaveCount(2);
  for (const clip of await panes.evaluateAll((els) => els.map((el) => getComputedStyle(el).clipPath))) {
    expect(clip, "the scroller is clipped to the rounded frame").toMatch(/inset\(0px round \d/);
  }
});

/** The box and the ghost shapes the bubble paints it with. */
const bubbleShapes = (page: Page) => page.evaluate(() => {
  const box = document.querySelector(".bubble-composer").getBoundingClientRect();
  const ghosts = [...document.querySelectorAll(".bubble-ghost")].map((el: any) => el.getBoundingClientRect());
  return { box: { w: Math.round(box.width), h: Math.round(box.height) }, ghosts: ghosts.map((g: any) => ({ w: Math.round(g.width), h: Math.round(g.height) })) };
});

for (const width of [1280, 360]) {
  test(`the bubble's painted shape follows the box, open and shrunk, at ${width}px @theme`, { tag: "@theme" }, async ({ page, server }) => {
    await openScenario(page, server, "full");
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => { const s = await bubbleShapes(page); return s.ghosts.every((g: any) => g.w === s.box.w && g.h === s.box.h); }, "open").toBe(true);
    await setShrunk(page, true);
    await expect.poll(async () => (await bubbleShapes(page)).box.h, "the pill").toBe(44);
    await expect.poll(async () => { const s = await bubbleShapes(page); return s.ghosts.every((g: any) => g.w === s.box.w && g.h === s.box.h); }, "shrunk").toBe(true);
  });
}

test("the composer suggestions grow out of the bubble and merge with it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Message the team").fill("/");
  await expect(page.locator(".bubble")).toHaveAttribute("data-open", "true");
  const menus = page.locator(".bubble-menu");
  await expect.poll(async () => (await menus.evaluateAll((els) => els.map((el: any) => Math.round(el.getBoundingClientRect().height)))).every((h: number, _: number, all: number[]) => h > 0 && h === all[0]), "ghost and real menus share one size").toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".bubble")).not.toHaveAttribute("data-open", "true");
});

test("the composer box draws a thin rim you can see, so it stands out on a background of its own colour @theme", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  const rim = await page.locator(".bubble-edge .bubble-ghost").evaluate((el: any) => {
    const style = (globalThis as any).getComputedStyle(el);
    const layer = (globalThis as any).getComputedStyle(el.parentElement);
    return { shadow: style.boxShadow, filter: layer.filter };
  });
  expect(rim.shadow, "the edge shape is 1px bigger than the box").toMatch(/0px 0px 0px 1px/);
  expect(rim.filter, "through the edge filter").toContain("bubble-gooedge");
});
