import { expect, openScenario, test } from "./fixture.ts";

declare const document: any;
declare const window: any;
declare const getComputedStyle: any;

test("effort is a drag slider that names every level, steps by key and snaps when dragged", { tag: "@theme" }, async ({ page, server }, info) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: info.project.name === "light-320" ? 320 : 390, height: 844 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  const card = page.locator("section.glass", { hasText: "Backend" }).first();
  const slider = card.getByRole("slider", { name: "Backend effort" });
  await expect(slider).toHaveAttribute("aria-valuetext", "medium");
  await expect(card.locator('[data-slot="effort-recommended"]'), "the default level is marked").toHaveText("Recommended");
  await slider.focus();
  await slider.press("Home");
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  await expect(slider).toHaveAttribute("aria-valuetext", "off");
  for (const level of levels.slice(1)) {
    await slider.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", level);
  }
  await expect(card.locator('[data-slot="effort-value"]')).toHaveText("Max");
  await expect(card.locator('[data-slot="effort-hint"]'), "the level's meaning describes the slider").toHaveText("As deep as the model goes.");
  await expect(card.locator('[data-slot="effort-recommended"]'), "away from it, the mark names it").toHaveText("Recommended");
  await expect(card.locator('[data-slot="effort-recommended-mark"]'), "and a bar on the track marks its stop").toBeVisible();
  await expect(card.locator('[data-slot="effort-sheen"]'), "the top level sends a sheen along the fill").toBeAttached();
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: info.outputPath("effort-slider.png") });

  await slider.press("Home");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(slider, "dragging follows the pointer").toHaveAttribute("data-dragging", "true");
  await page.mouse.up();
  await expect(slider, "and snaps to the stop under it").toHaveAttribute("aria-valuetext", "medium");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(trap.errors).toEqual([]);
  trap.stop();
});

test("a press on a stop jumps to it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  const card = page.locator("section.glass", { hasText: "Backend" }).first();
  const slider = card.getByRole("slider", { name: "Backend effort" });
  await card.locator('[data-stop="high"]').click({ force: true });
  await expect(slider).toHaveAttribute("aria-valuetext", "high");
  await card.locator('[data-stop="off"]').click({ force: true });
  await expect(slider).toHaveAttribute("aria-valuetext", "off");
});

test("a toast is centred over the composer, clear of it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  const slider = page.getByRole("slider", { name: "Backend effort" });
  await slider.focus();
  await slider.press("ArrowRight");
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
  // The box gives and springs back when it takes focus; measure it at rest.
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
  if (info.project.name !== "light-320") await page.setViewportSize({ width: 1440, height: 1000 });
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
