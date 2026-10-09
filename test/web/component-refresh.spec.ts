import { expect, openScenario, test } from "./fixture.ts";

declare const document: any;
declare const window: any;
declare const getComputedStyle: any;

test("the effort brain stays smooth at low effort, grows folds, glitches and phases at max", { tag: "@theme" }, async ({ page, server }, info) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: info.project.name === "light-320" ? 320 : 390, height: 844 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  const card = page.locator("section.glass", { hasText: "Backend" }).first();
  const brain = card.locator('[data-slot="effort-mascot"]');
  const slider = card.getByRole("slider", { name: "Backend effort" });
  await slider.focus();
  await slider.press("Home");
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const folds = [0, 0, 0, 4, 6, 8, 12];
  for (let rank = 0; rank < levels.length; rank += 1) {
    if (rank) await slider.press("ArrowRight");
    await expect(brain).toHaveAttribute("data-level", levels[rank]!);
    await expect(brain.locator("[data-brain-fold]")).toHaveCount(folds[rank]!);
    await expect(brain.locator("[data-brain-halo]")).toHaveCount(rank === 6 ? 1 : 0);
    await expect(brain.locator("[data-brain-phase]")).toHaveCount(rank === 6 ? 2 : 0);
    if (rank >= 4) {
      expect(await brain.locator("[data-brain-shape]").evaluate((el: any) => getComputedStyle(el).animationName)).toBe(rank === 6 ? "brain-phase" : "brain-glitch");
    }
  }
  await expect(brain).toHaveAttribute("data-elevated", "true");
  await expect(brain.locator("[data-brain-body]")).toHaveAttribute("filter", /-glow\)/);
  const labelsFit = await slider.locator("..").locator("div[aria-hidden=true] > span").evaluateAll((stops: any[]) => {
    const boxes = stops.map((stop) => stop.getBoundingClientRect());
    return boxes.every((box, index) => index === 0 || boxes[index - 1].right <= box.left);
  });
  expect(labelsFit, "the stop labels do not overlap on narrow screens").toBe(true);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: info.outputPath("brain-max.png") });

  await slider.press("Home");
  await expect(brain).toHaveAttribute("data-level", "off");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(brain).toHaveAttribute("data-level", "medium");
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuetext", "medium");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await slider.press("End");
  await expect(brain).toHaveAttribute("data-elevated", "true");
  const pose = () => brain.locator("[data-brain-body]").evaluate((el: any) => getComputedStyle(el).transform);
  await expect.poll(pose).toBe("matrix(1, 0, 0, 1, 0, -5)");
  await page.waitForTimeout(150);
  expect(await pose()).toBe("matrix(1, 0, 0, 1, 0, -5)");
  expect(await brain.locator("[data-brain-shape]").evaluate((el: any) => getComputedStyle(el).animationName)).toBe("none");
  await expect(brain.locator("[data-brain-scan]")).toBeHidden();
  expect(trap.errors).toEqual([]);
  trap.stop();
});

test("ReUI panels and Obsidian session cards keep the existing navigation and composer", async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const composer = page.locator(".group\\/composer");
  const before = (await composer.boundingBox())!;
  const tabs = page.getByRole("tablist");
  const tabsBefore = (await tabs.boundingBox())!;
  const toastOffset = () => page.locator('.fixed[aria-live="polite"]').evaluate((el: any) => getComputedStyle(el).bottom);
  const toastBefore = await toastOffset();
  await page.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(page.locator('[data-slot="active-session"]')).not.toHaveCount(0);
  await expect(page.locator('[data-slot="active-session"]').first()).toBeVisible();
  await page.getByRole("tab", { name: /Metrics/ }).click();
  await expect(page.locator('[data-slot="frame-panel"]').first()).toBeVisible();
  await page.getByRole("tab", { name: /Lobby/ }).click();
  await expect(page.locator('[data-tab-fill]')).toBeAttached();
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
