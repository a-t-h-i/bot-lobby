/** Source-grounded phone workflows; engine results remain pending. No audio checks. */
import type { Locator } from "@playwright/test";
import type { WebPrompt } from "../../src/webui/protocol.ts";
import { expect, openScenario, test, type MockServer, type Page } from "./fixture.ts";

declare const document: any;
declare const window: any;
declare const Event: any;
declare const getComputedStyle: any;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const field = (page: Page) => page.locator("#composer-text");
const question = (page: Page) => page.getByRole("dialog", { name: "Question from the lobby", exact: true });
const CONTENT = { lobby: "We need an offline mock", tasks: "Add offline mock fixtures", plan: "Agreed plan", quickfix: "Fix the typo in the header", git: "Add the dark mode toggle", knowledge: "Engineering standards", excalidraw: "Mock board" };

async function selectTab(page: Page, id: string) {
  const tab = page.locator(`#tab-${id}`);
  await tab.focus();
  await tab.press("Enter");
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(new RegExp(`#/${id}$`));
  await expect(page.locator("#main")).toHaveAttribute("aria-labelledby", `tab-${id}`);
}

async function bounded(page: Page, control: Locator, clearDock = false) {
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  const bottom = clearDock ? (await page.locator("#app-dock").boundingBox())!.y : viewport.height;
  expect(box.y + box.height).toBeLessThanOrEqual(bottom + 1);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator(".kbd-hint:visible, kbd:visible")).toHaveCount(0);
}

async function targetBoxes(controls: Locator) {
  return controls.evaluateAll((els: any[]) => els.map((el): { name: string | null; x: number; y: number; w: number; h: number } => {
    const r = el.getBoundingClientRect();
    return { name: el.getAttribute("aria-label") || el.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
}

async function settledTargets(controls: Locator) {
  let previous: Awaited<ReturnType<typeof targetBoxes>> = [];
  await expect.poll(async () => {
    const boxes = await targetBoxes(controls);
    const settled = boxes.length > 0 && boxes.length === previous.length && boxes.every((box, i) => {
      const prior = previous[i];
      return prior !== undefined && box.w >= 43.95 && box.h >= 43.95 && Math.abs(box.w - prior.w) <= 0.05 && Math.abs(box.h - prior.h) <= 0.05;
    });
    previous = boxes;
    return settled;
  }, { timeout: 3000, message: "essential targets settle at 44px or larger" }).toBe(true);
}

async function essentialTargets(controls: Locator) {
  expect(await controls.count(), "essential controls are present").toBeGreaterThan(0);
  await settledTargets(controls);
  const boxes = (await targetBoxes(controls)).map((box) => ({ ...box,
    x: Number(box.x.toFixed(1)), y: Number(box.y.toFixed(1)), w: Number(box.w.toFixed(1)), h: Number(box.h.toFixed(1)) }));
  for (const box of boxes) {
    expect(box.w, `${box.name} width`).toBeGreaterThanOrEqual(44);
    expect(box.h, `${box.name} height`).toBeGreaterThanOrEqual(44);
    const overlaps = boxes.filter((other) => other !== box && Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x) > 1 && Math.min(box.y + box.h, other.y + other.h) - Math.max(box.y, other.y) > 1);
    expect(overlaps, `${box.name} nonoverlapping hit area`).toEqual([]);
  }
}

async function pageEdges(page: Page) {
  const rows = page.locator('#main [data-row]');
  if (!await rows.count()) return;
  await essentialTargets(rows);
  await rows.first().evaluate((el: any) => el.scrollIntoView({ block: "center" }));
  await bounded(page, rows.first(), true);
  await rows.last().evaluate((el: any) => el.scrollIntoView({ block: "center" }));
  await bounded(page, rows.last(), true);
}

async function screenChecks(page: Page) {
  await page.waitForTimeout(350); // Measure the settled page entrance, not its transient transform.
  await noOverflow(page);
  await essentialTargets(page.locator('header.app-header a:visible, header.app-header button:visible:not([aria-label="App sounds"])'));
  await essentialTargets(page.locator('#app-dock .toolbar-button:visible, #app-dock button[aria-label="Send"]:visible, #app-dock button[aria-label="Stop"]:visible'));
  await bounded(page, field(page));
  await pageEdges(page);
}

async function headerPages(page: Page) {
  const sidebar = page.getByRole("dialog", { name: "Sidebar" });
  await page.getByRole("banner").getByRole("button", { name: "Open sidebar" }).tap();
  await expect(sidebar).toBeVisible();
  await bounded(page, sidebar);
  await essentialTargets(sidebar.locator("a:visible, button:visible"));
  await sidebar.getByRole("link", { name: "Settings", exact: true }).tap();
  await expect(sidebar, "following a link closes the sheet").toBeHidden();
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections).toBeVisible();
  await essentialTargets(sections.getByRole("button"));
  await screenChecks(page);
  await page.getByRole("banner").getByRole("button", { name: "Open sidebar" }).tap();
  await sidebar.getByRole("link", { name: "Sessions", exact: true }).tap();
  await expect(sidebar).toBeHidden();
  await expect(page.locator("#main")).toContainText("Mock background task");
  await screenChecks(page);
}

async function wideChat(page: Page) {
  const text = `\`\`\`txt\n${"wide-code-".repeat(90)}\n\`\`\`\n\n| ${"column".repeat(60)} | value |\n| --- | --- |\n| cell | cell |`;
  await page.route("**/api/lobby.snapshot", async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.result.chat = [{ id: 991, at: Date.now(), role: "oracle", text }];
    await route.fulfill({ response, json: envelope });
  });
}

async function localWideContent(page: Page) {
  const wide = page.locator('#main pre, #main table');
  await expect(wide).toHaveCount(2);
  const contained = await wide.evaluateAll((els: any[]) => els.map((el) => {
    let parent = el;
    while (parent && !["BODY", "HTML"].includes(parent.tagName) && parent.id !== "root") {
      if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.clientWidth <= window.innerWidth && parent.scrollWidth > parent.clientWidth) return true;
      parent = parent.parentElement;
    }
    return false;
  }));
  expect(contained, "wide code and table each have a bounded local scroller").toEqual([true, true]);
  await noOverflow(page);
}

test("all available phone tabs and header pages fit, with bounded rows and essential targets", async ({ page, server }) => {
  await wideChat(page);
  const trap = await openScenario(page, server, "full");
  for (const [id, text] of Object.entries(CONTENT)) {
    await selectTab(page, id);
    if (id === "lobby") await localWideContent(page);
    else await expect(page.locator("#main")).toContainText(text);
    await screenChecks(page);
  }
  await headerPages(page);
  trap.stop();
  expect(trap.errors).toEqual([]);
  await openScenario(page, server, "issues");
  await selectTab(page, "issues");
  await expect(page.locator("#main")).toContainText("Dark mode flashes white on load");
  await screenChecks(page);
});

async function settledSheet(page: Page, sheet: Locator) {
  await expect.poll(async () => {
    const box = await sheet.boundingBox();
    return Boolean(box && Math.abs(box.x) <= 0.05 && Math.abs(box.width - page.viewportSize()!.width) <= 0.05);
  }, { timeout: 3000, message: "detail sheet settles to phone viewport bounds" }).toBe(true);
}

async function taskSheet(page: Page) {
  await selectTab(page, "tasks");
  const row = page.locator('#main [data-row]').filter({ hasText: "Add offline mock fixtures" });
  await row.tap();
  const sheet = page.getByRole("dialog", { name: "Detail", exact: true });
  await expect(sheet).toBeVisible();
  await expect(page.locator("#app-dock")).toHaveAttribute("inert", "");
  await settledSheet(page, sheet);
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.width).toBeCloseTo(page.viewportSize()!.width, 0);
  await bounded(page, sheet.getByRole("button", { name: "Close detail" }));
  await essentialTargets(sheet.getByRole("button", { name: "Close detail" }));
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#app-dock")).not.toHaveAttribute("inert", "");
}

async function knowledgeInline(page: Page) {
  await selectTab(page, "knowledge");
  await page.locator('#knowledge-master [data-row]').filter({ hasText: /^Knowledge/ }).tap();
  await expect(page.locator('[data-pane="detail"]')).toContainText("Mock what the offline page needs.");
  await expect(page.getByRole("dialog", { name: "Detail", exact: true })).toHaveCount(0);
  await expect(page.locator("#app-dock")).not.toHaveAttribute("inert", "");
  await field(page).fill("Keep this Knowledge draft");
  const toggle = page.getByRole("group", { name: "Knowledge pane" });
  await toggle.getByRole("button", { name: "Chat", exact: true }).tap();
  await expect(page.locator('[data-pane="detail"]').getByRole("log")).toBeVisible();
  await toggle.getByRole("button", { name: "Docs", exact: true }).tap();
  await expect(field(page)).toHaveValue("Keep this Knowledge draft");
  await noOverflow(page);
}

test("blocking task sheet and Back release the dock; Knowledge remains inline with its draft", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await taskSheet(page);
  await knowledgeInline(page);
});

async function orbClearance(page: Page) {
  const orb = page.getByRole("button", { name: "Open Thinking", exact: true });
  await bounded(page, orb, true);
  const main = (await page.locator("#main").boundingBox())!;
  expect((await orb.boundingBox())!.y).toBeGreaterThanOrEqual(main.y - 1);
}

async function dragOrb(page: Page) {
  const orb = (await page.getByRole("button", { name: "Open Thinking", exact: true }).boundingBox())!;
  await page.mouse.move(orb.x + 22, orb.y + 22);
  await page.mouse.down();
  await page.mouse.move(1, 1, { steps: 8 });
  await page.mouse.up();
  await orbClearance(page);
  const clamped = (await page.getByRole("button", { name: "Open Thinking", exact: true }).boundingBox())!;
  await page.mouse.move(clamped.x + 22, clamped.y + 22);
  await page.mouse.down();
  await page.mouse.move(639, 359, { steps: 8 });
  await page.mouse.up();
  await orbClearance(page);
}

async function keyboardDock(page: Page) {
  await field(page).focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 240 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("[data-phone-tabs-handle]")).toBeVisible();
  await orbClearance(page);
  const measured = await page.evaluate(() => ({ h: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--composer-h")), actual: document.getElementById("app-dock").getBoundingClientRect().height + window.innerHeight - window.visualViewport.height }));
  expect(Math.abs(measured.h - measured.actual)).toBeLessThanOrEqual(1);
  await page.locator("[data-phone-tabs-handle]").tap();
  await expect(page.locator(".phone-tabs-scroller")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 360 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("[data-phone-tabs-handle]")).toHaveCount(0);
}

test("short landscape retains reachable composer, measured keyboard dock and clamped draggable Thinking", async ({ page, server }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await openScenario(page, server, "full");
  await noOverflow(page);
  await bounded(page, field(page));
  await dragOrb(page);
  await keyboardDock(page);
  await noOverflow(page);
});

async function attachmentDraft(page: Page) {
  await field(page).fill("Keep the attachment draft");
  await page.locator('input[type="file"]').setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: PNG });
  const preview = page.getByRole("list", { name: "Attachments" }).getByRole("img", { name: "phone.png" });
  await expect(preview).toBeVisible();
  await bounded(page, preview);
  await selectTab(page, "plan");
  await selectTab(page, "lobby");
  await expect(field(page)).toHaveValue("Keep the attachment draft");
  await expect(preview).toBeVisible();
}

async function holdReply(server: MockServer) {
  await server.start((service) => {
    service.toOracle = (text) => {
      service.feed.say("you", text);
      service.feed.replyDelta("Working until stopped.");
      return undefined;
    };
  });
}

async function sendStop(page: Page) {
  await page.getByRole("button", { name: "Send", exact: true }).tap();
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await bounded(page, stop);
  await stop.tap();
  const confirm = page.getByRole("alertdialog", { name: "Stop the oracle?", exact: true });
  await expect(confirm).toBeVisible();
  await bounded(page, confirm.getByRole("button", { name: "Stop", exact: true }));
  await confirm.getByRole("button", { name: "Stop", exact: true }).tap();
  await expect(confirm).toBeHidden();
  await expect(field(page)).toHaveValue("");
  await expect(page.getByRole("list", { name: "Attachments" })).toHaveCount(0);
  await expect(stop).toHaveCount(0);
  await noOverflow(page);
}

test("drafts and attachment thumbnails survive navigation, send clears them and Stop confirms", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await holdReply(server);
  await attachmentDraft(page);
  await sendStop(page);
});

async function laterCancel(page: Page) {
  const dialog = question(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Later: put the question away" }).tap();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: /3 questions waiting/ }).tap();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(dialog).toContainText("Leave without answering?");
  await dialog.getByRole("button", { name: "Keep answering", exact: true }).tap();
  await expect(dialog.getByRole("textbox", { name: "Your own answer" })).toBeVisible();
  await noOverflow(page);
}

async function answerQueue(page: Page) {
  const dialog = question(page);
  await dialog.getByRole("textbox", { name: "Your own answer" }).fill("After the phone review");
  await dialog.getByRole("button", { name: "Next", exact: true }).tap();
  await dialog.locator("label", { hasText: "Full pass" }).tap();
  await dialog.getByRole("button", { name: "Answer", exact: true }).tap();
  await expect(dialog).toContainText("Freeze new tasks until the release lands?");
  await dialog.getByRole("button", { name: "Yes", exact: true }).tap();
  await dialog.getByRole("textbox", { name: "What should the release be called?" }).fill("Phone release");
  await dialog.getByRole("button", { name: "Answer", exact: true }).tap();
  await expect(dialog).toBeHidden();
}

async function multiPrompt(page: Page, server: MockServer) {
  let prompts: WebPrompt[] = [{ id: "phone-multi", kind: "questionnaire", from: "qa", createdAt: 1, payload: { questions: [{ question: "Choose phone checks", multiSelect: true, options: [{ label: "Keyboard" }, { label: "Sheets" }] }] } }];
  await page.route("**/api/prompts.list", (route) => route.fulfill({ json: { ok: true, result: { prompts } } }));
  await page.route("**/api/prompts.answer", async (route) => {
    expect(route.request().postDataJSON().answer.answers[0].selected).toEqual(["Keyboard", "Sheets"]);
    prompts = [];
    await route.fulfill({ json: { ok: true, result: {} } });
    server.bump("prompts");
  });
}

async function answerMulti(page: Page) {
  const dialog = question(page);
  await dialog.locator("label", { hasText: "Keyboard" }).tap();
  await dialog.locator("label", { hasText: "Sheets" }).tap();
  await expect(dialog.locator('input:checked')).toHaveCount(2);
  await essentialTargets(dialog.getByRole("button"));
  await bounded(page, dialog.getByRole("button", { name: "Answer", exact: true }));
  await dialog.getByRole("button", { name: "Answer", exact: true }).tap();
  await expect(dialog).toBeHidden();
}

test("waiting questions retain Later, cancellation, custom Next/Answer and multi-select", async ({ page, server }) => {
  await openScenario(page, server, "questions3");
  await laterCancel(page);
  await answerQueue(page);
  await multiPrompt(page, server);
  server.bump("prompts");
  await answerMulti(page);
});

test("mockup expands within phone bounds and Escape returns to the unanswered card", async ({ page, server }) => {
  await openScenario(page, server, "mockups");
  const dialog = question(page);
  await expect(dialog).toContainText("Which layout should the new dashboard take?");
  await dialog.getByRole("button", { name: "Expand", exact: true }).tap();
  await expect(dialog.locator("iframe").first()).toBeVisible();
  await bounded(page, dialog);
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toContainText("Which layout should the new dashboard take?");
  await expect(dialog.getByRole("button", { name: "Expand", exact: true })).toBeVisible();
});
