/** Phone-only public contracts. No audio inspection or mocks: sound is user-tested. */
import type { TabInfo, WebPrompt } from "../../src/webui/protocol.ts";
import { expect, openScenario, test, type Page } from "./fixture.ts";

declare const document: any;
declare const window: any;
declare const Event: any;
declare const getComputedStyle: any;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const applicationTabs = (page: Page) => page.locator('[role="tab"][id^="tab-"]');
const applicationTablists = (page: Page) => page.getByRole("tablist").filter({ has: applicationTabs(page) });
const selected = (page: Page) => page.locator('[role="tab"][id^="tab-"][aria-selected="true"]');
const field = (page: Page) => page.locator("#composer-text");
const scroller = (page: Page) => page.locator(".phone-tabs-scroller");

test.setTimeout(25_000);

async function routeTo(page: Page, id: string) {
  await page.evaluate((id) => { window.location.hash = `#/${id}`; }, id);
  await expect(page).toHaveURL(new RegExp(`#/${id}$`));
}

async function freeze(page: Page) {
  await page.waitForTimeout(350); // Initial programmatic centring must have finished.
  const time = new Date("2030-01-01T00:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

async function expectCommitted(page: Page, id: string) {
  await expect(page).toHaveURL(new RegExp(`#/${id}$`));
  await expect(selected(page)).toHaveCount(1);
  await expect(selected(page)).toHaveAttribute("id", `tab-${id}`);
  await expect(page.locator("#main")).toHaveAttribute("aria-labelledby", `tab-${id}`);
}

async function centreError(page: Page) {
  return selected(page).evaluate((el: any) => {
    const card = el.getBoundingClientRect();
    const strip = document.querySelector(".phone-tabs-scroller").getBoundingClientRect();
    return Math.abs(card.left + card.width / 2 - strip.left - strip.width / 2);
  });
}

/** Drive the real wheel handler towards the nearest occurrence, not scrollLeft. */
async function wheelTo(page: Page, id: string, direction = 0) {
  const delta = await scroller(page).evaluate((el: any, { id, direction }) => {
    const strip = el.getBoundingClientRect();
    const centre = strip.left + strip.width / 2;
    const offsets = [...el.querySelectorAll(`[data-phone-tab-id="${id}"]`)].map((card: any) => {
      const rect = card.getBoundingClientRect();
      return rect.left + rect.width / 2 - centre;
    }).filter((offset: number) => !direction || offset * direction > 2);
    return offsets.sort((a: number, b: number) => Math.abs(a) - Math.abs(b))[0];
  }, { id, direction });
  expect(Number.isFinite(delta), `a reachable ${id} belt occurrence`).toBe(true);
  if (delta === undefined) throw new Error(`No reachable ${id} belt occurrence`);
  await scroller(page).hover();
  await page.mouse.wheel(delta, 0);
  await page.waitForTimeout(50); // Deliver native scroll events while the clock is paused.
}

async function settle(page: Page) {
  await page.clock.runFor(120);
}

async function finishCommit(page: Page, id: string) {
  await settle(page);
  await page.clock.runFor(500);
  await expectCommitted(page, id);
  await page.clock.runFor(350);
  expect(await centreError(page), "expanded committed card stays centred").toBeLessThanOrEqual(2);
}

async function expectLabelReferences(page: Page) {
  const missing = await page.locator("[aria-labelledby]").evaluateAll((elements: any[]) =>
    elements.flatMap((el) => el.getAttribute("aria-labelledby").split(/\s+/).filter((id: string) => !document.getElementById(id))),
  );
  expect(missing, "every labelledby resolves, including a collapsed tab handle").toEqual([]);
}

async function interceptTabs(page: Page, count?: number) {
  const supplied: TabInfo[] = [];
  await page.route("**/api/status.get", async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    expect(envelope.ok).toBe(true);
    supplied.splice(0, supplied.length, ...envelope.result.tabs);
    if (count !== undefined) envelope.result.tabs = supplied.filter((tab) => tab.id !== "metrics").slice(0, count);
    await route.fulfill({ response, json: envelope });
  });
  return supplied;
}

async function resizeKeyboard(page: Page, height: number) {
  await page.evaluate((height) => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: height });
    window.visualViewport.dispatchEvent(new Event("resize"));
  }, height);
  await page.waitForTimeout(50);
}

async function expectBeltGeometry(page: Page) {
  const geometry = await scroller(page).evaluate((el: any) => {
    const strip = el.getBoundingClientRect();
    const cards = [...el.querySelectorAll("[data-phone-tab-id]")].map((card: any) => card.getBoundingClientRect());
    const visible = cards.filter((r: any) => r.right >= strip.left && r.left <= strip.right);
    const gaps = visible.slice(1).map((r: any, i: number) => r.left - visible[i].right);
    return { gaps, first: visible[0]?.left, last: visible.at(-1)?.right, left: strip.left, right: strip.right,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(geometry.overflow, "no page-wide overflow").toBeLessThanOrEqual(1);
  expect(geometry.first, "left edge is covered or in the 6px card gap").toBeLessThanOrEqual(geometry.left + 7);
  expect(geometry.last, "right edge is covered or in the 6px card gap").toBeGreaterThanOrEqual(geometry.right - 7);
  expect(Math.max(0, ...geometry.gaps), "all visible gaps stay within 6px plus rounding").toBeLessThanOrEqual(8);
}

test("wheel candidate stays compact and neutral for 499ms after settling, then commits page and target together", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await freeze(page);
  const before = page.url();
  const body = await page.locator("#main").innerText();
  const neutral = await page.locator("#tab-plan").evaluate((el: any) => getComputedStyle(el).backgroundColor);
  await wheelTo(page, "plan");
  await settle(page);
  await page.clock.runFor(499);
  expect(page.url()).toBe(before);
  expect(await page.locator("#main").innerText()).toBe(body);
  await expect(field(page)).toHaveAttribute("aria-label", "Message the oracle");
  await expect(page.locator("#tab-plan")).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#tab-plan")).not.toContainText("Plan");
  expect(await page.locator("#tab-plan").evaluate((el: any) => getComputedStyle(el).backgroundColor)).toBe(neutral);
  await expect(selected(page)).toHaveAttribute("id", "tab-lobby");
  await page.clock.runFor(1);
  await expectCommitted(page, "plan");
  await expect(field(page)).toHaveAttribute("aria-label", "Message the panel");
  await expect(page.locator("#main")).toContainText("Agreed plan");
});

test("further wheel movement restarts the entire settling and selection delay", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await freeze(page);
  await wheelTo(page, "plan");
  await settle(page);
  await page.clock.runFor(400);
  await wheelTo(page, "quickfix");
  await settle(page);
  await page.clock.runFor(499);
  await expect(selected(page)).toHaveAttribute("id", "tab-lobby");
  await page.clock.runFor(1);
  await expectCommitted(page, "quickfix");
  await expect(field(page)).toHaveAttribute("aria-label", "Describe a quick fix");
});

for (const cancellation of ["route", "overlay"] as const) {
  test(`${cancellation} cancels pending swipe selection`, async ({ page, server }) => {
    let prompts: WebPrompt[] = [];
    if (cancellation === "overlay") {
      await page.route("**/api/prompts.list", (request) => request.fulfill({ json: { ok: true, result: { prompts } } }));
    }
    await openScenario(page, server, "full");
    const initialUrl = page.url();
    await expect(selected(page)).toHaveCount(1);
    await expect(selected(page)).toHaveAttribute("id", "tab-lobby");
    await expect(page.locator("#main")).toHaveAttribute("aria-labelledby", "tab-lobby");
    await freeze(page);
    await wheelTo(page, "plan");
    await settle(page);
    await page.clock.runFor(300);
    if (cancellation === "route") await routeTo(page, "git");
    else {
      prompts = [{ id: "phone-cancel", kind: "confirm", from: "qa", createdAt: 1, payload: { question: "Continue phone cancellation check?" } }];
      server.bump("prompts");
      await expect(page.getByRole("dialog", { name: "Question from the lobby", exact: true })).toBeVisible();
    }
    await page.clock.runFor(1000);
    if (cancellation === "route") await expectCommitted(page, "git");
    else {
      const dialog = page.getByRole("dialog", { name: "Question from the lobby", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Continue phone cancellation check?");
      expect(page.url()).toBe(initialUrl);
      await expect(selected(page)).toHaveCount(1);
      await expect(selected(page)).toHaveAttribute("id", "tab-lobby");
      await expect(page.locator("#main")).toHaveAttribute("aria-labelledby", "tab-lobby");
      await page.keyboard.press("Escape");
      await page.clock.runFor(1000); // Finish Motion exit before measuring visibility on the paused clock.
      await expect(dialog).not.toBeVisible();
      expect(page.url()).toBe(initialUrl);
      await expect(selected(page)).toHaveCount(1);
      await expect(selected(page)).toHaveAttribute("id", "tab-lobby");
      await expect(page.locator("#main")).toHaveAttribute("aria-labelledby", "tab-lobby");
      await expect(dialog).not.toBeVisible();
    }
  });
}

test("tap on a decorative seam occurrence commits immediately and keyboard navigation cancels pending selection", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await freeze(page);
  await wheelTo(page, "excalidraw", -1);
  const copy = page.locator('[data-phone-period="copy"] [data-phone-tab-id="excalidraw"]');
  const visible = await copy.evaluateAll((els: any[]) => els.findIndex((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  }));
  expect(visible, "a real decorative seam target is visible").toBeGreaterThanOrEqual(0);
  await copy.nth(visible).tap();
  await expectCommitted(page, "excalidraw");
  await wheelTo(page, "plan");
  await page.locator("#tab-excalidraw").focus();
  await page.keyboard.press("ArrowRight");
  await expectCommitted(page, "git");
  await page.clock.runFor(1000);
  await expectCommitted(page, "git");
});

test("canonical touch tap commits without waiting", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await freeze(page);
  await wheelTo(page, "plan");
  await page.locator("#tab-plan").tap();
  await expectCommitted(page, "plan");
});

test("pointer drag browses without committing until release, settle and delay", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await freeze(page);
  const box = (await scroller(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2, { steps: 8 });
  await page.clock.runFor(1000);
  await expect(selected(page)).toHaveAttribute("id", "tab-lobby");
  await page.mouse.up();
  await page.waitForTimeout(50);
  await settle(page);
  await page.clock.runFor(500);
  await expect(selected(page)).not.toHaveAttribute("id", "tab-lobby");
});

for (const direction of [-1, 1]) {
  test(`belt wraps repeatedly in direction ${direction} without blank seams or centre drift`, async ({ page, server }) => {
    test.setTimeout(90_000);
    await openScenario(page, server, "full");
    await freeze(page);
    const ids = await applicationTabs(page).evaluateAll((els: any[]) => els.map((el) => el.dataset.phoneTabId));
    for (let step = 1; step <= ids.length * 2; step++) {
      const id = ids[((step * direction) % ids.length + ids.length) % ids.length];
      await wheelTo(page, id, direction);
      await expectBeltGeometry(page);
      await finishCommit(page, id);
    }
  });
}

test("one semantic tablist preserves server order, complete names and original digits while filtering Metrics", async ({ page, server }) => {
  const supplied = await interceptTabs(page);
  await openScenario(page, server, "issues");
  const tabs = supplied.filter((tab) => tab.id !== "metrics");
  await expect(applicationTablists(page)).toHaveCount(1);
  await expect(applicationTabs(page)).toHaveCount(tabs.length);
  expect(await applicationTabs(page).evaluateAll((els: any[]) => els.map((el) => el.id))).toEqual(tabs.map((tab) => `tab-${tab.id}`));
  for (const tab of tabs) {
    await expect(page.locator(`#tab-${tab.id}`)).toHaveAccessibleName(`${tab.key.match(/\d$/)![0]}. ${tab.label}`);
    await expect(page.locator(`[id="tab-${tab.id}"]`)).toHaveCount(1);
  }
  await expect(page.locator('[data-phone-tab-id="metrics"]')).toHaveCount(0);
  await expect(page.locator('[data-phone-period="copy"] [role], [data-phone-period="copy"] [id], [data-phone-period="copy"] button, [data-phone-period="copy"] [tabindex]')).toHaveCount(0);
  await expect(selected(page)).toHaveCount(1);
});

test("767 to 768 and back preserves route, draft, attachment and one tablist", async ({ page, server }) => {
  await page.setViewportSize({ width: 767, height: 844 });
  await openScenario(page, server, "full");
  await routeTo(page, "plan");
  await field(page).fill("Keep this draft across the boundary");
  await page.locator('input[type="file"]').setInputFiles({ name: "boundary.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("img", { name: "boundary.png" })).toBeVisible();
  for (const width of [768, 767]) {
    await page.setViewportSize({ width, height: 844 });
    await expectCommitted(page, "plan");
    await expect(field(page)).toHaveValue("Keep this draft across the boundary");
    await expect(page.getByRole("img", { name: "boundary.png" })).toBeVisible();
    await expect(applicationTablists(page)).toHaveCount(1);
    await expect(page.locator("#app-dock").getByRole("tablist")).toHaveCount(width < 768 ? 1 : 0);
  }
});

test("editable focus without viewport shrink stays normal; keyboard collapse has valid labels, reopens and restores", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await field(page).focus();
  await expect(scroller(page)).toBeVisible();
  await expect(page.locator("[data-phone-tabs-handle]")).toHaveCount(0);
  expect((await page.locator("[data-phone-tabs]").boundingBox())!.height).toBe(60);
  await resizeKeyboard(page, 500);
  const handle = page.locator("[data-phone-tabs-handle]");
  await expect(handle).toBeVisible();
  expect((await page.locator(".phone-tabs-handle").boundingBox())!.height).toBe(44);
  await expectLabelReferences(page);
  await handle.tap();
  await expect(scroller(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Close tabs", exact: true })).toBeVisible();
  await resizeKeyboard(page, 844);
  await expect(scroller(page)).toBeVisible();
  await expect(handle).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close tabs", exact: true })).toHaveCount(0);
});

for (const count of [0, 1, 2]) {
  test(`${count} available tabs have no phantom selections or duplicate controls`, async ({ page, server }) => {
    await interceptTabs(page, count);
    server.use("full");
    await page.goto(server.link);
    await expect(field(page)).toBeVisible();
    await expect(applicationTabs(page)).toHaveCount(count);
    await expect(page.locator("#app-dock").getByRole("tablist")).toHaveCount(count ? 1 : 0);
    await expect(selected(page)).toHaveCount(count ? 1 : 0);
    if (!count) return;
    await freeze(page);
    await page.locator("#tab-lobby").focus();
    await page.keyboard.press("ArrowLeft");
    await expectCommitted(page, count === 1 ? "lobby" : "tasks");
    await page.keyboard.press("ArrowRight");
    await expectCommitted(page, "lobby");
    await page.clock.runFor(1000);
    await expectCommitted(page, "lobby");
  });
}

test("Metrics keeps its explicit route and hardware shortcut, returning to the original page at 768", async ({ page, server }) => {
  const supplied = await interceptTabs(page);
  await page.setViewportSize({ width: 767, height: 844 });
  await openScenario(page, server, "issues");
  await freeze(page);
  await page.keyboard.press(supplied.find((tab) => tab.id === "metrics")!.key);
  await expect(page).toHaveURL(/#\/metrics$/);
  await expect(page.locator("#main")).toContainText(/Metrics.*(?:phone|larger)|(?:phone|larger).*Metrics/is);
  await expect(page.locator("#main").getByRole("link", { name: /Lobby/ })).toBeVisible();
  await page.setViewportSize({ width: 768, height: 844 });
  await expectCommitted(page, "metrics");
  await expect(page.locator("#main").getByRole("heading", { name: "Metrics", exact: true })).toBeVisible();
  await expect(page.locator("#main")).toContainText("Daily trends and model performance");
  await expect(page.locator("#main").getByRole("link", { name: /Lobby/ })).toHaveCount(0);
  await page.setViewportSize({ width: 767, height: 844 });
  await expect(page.locator("#main")).toContainText(/Metrics.*(?:phone|larger)|(?:phone|larger).*Metrics/is);
  await page.clock.runFor(350); // Finish the explicit-route entrance before the normal stable click.
  await page.locator("#main").getByRole("link", { name: /Lobby/ }).click();
  await expectCommitted(page, "lobby");
});
