/**
 * The redesign's own behaviour: the droplet that slides between tab pills, the
 * effort slider that skips what a model cannot do, one pop-up and one toast at
 * a time, the zen palettes and shapes, and the composer taking files.
 */
import { expect, openScenario, test } from "./fixture.ts";

/** DOM ambient for `page.evaluate` callbacks (the root tsconfig has no DOM lib). */
declare const document: any;
declare const window: any;
declare const performance: any;
declare const requestAnimationFrame: any;
declare const getComputedStyle: any;

// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("the tab pill slides to the chosen tab like a drop: it stretches across the gap, then settles on the tab", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const run = await page.evaluate(async () => {
    const drop = document.querySelector('[role="tablist"] > span');
    const target = [...document.querySelectorAll('[role="tab"]')].find((el: any) => /Git/.test(el.textContent)) as any;
    const widths: number[] = [];
    const start = performance.now();
    target.click();
    await new Promise<void>((resolve) => {
      const tick = () => {
        widths.push(drop.getBoundingClientRect().width);
        if (performance.now() - start < 1200) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    const box = target.getBoundingClientRect();
    const end = drop.getBoundingClientRect();
    return { widths, tab: { left: box.left, width: box.width }, end: { left: end.left, width: end.width } };
  });
  expect(Math.max(...run.widths), "the drop stretches while it travels").toBeGreaterThan(run.tab.width * 1.6);
  expect(Math.abs(run.end.left - run.tab.left), "and lands on the tab").toBeLessThan(3);
  expect(Math.abs(run.end.width - run.tab.width), "at the tab's width").toBeLessThan(3);
  await expect(page.getByRole("tab", { name: /Git/ })).toHaveAttribute("aria-selected", "true");
});

test("under reduced motion the pill simply jumps", async ({ page, server }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const widths = await page.evaluate(async () => {
    const drop = document.querySelector('[role="tablist"] > span');
    const target = [...document.querySelectorAll('[role="tab"]')].find((el: any) => /Git/.test(el.textContent)) as any;
    const seen: number[] = [drop.getBoundingClientRect().width];
    const start = performance.now();
    target.click();
    await new Promise<void>((resolve) => {
      const tick = () => {
        seen.push(drop.getBoundingClientRect().width);
        if (performance.now() - start < 500) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    return seen;
  });
  const first = widths[0]!;
  const last = widths.at(-1)!;
  for (const width of widths) expect(Math.min(Math.abs(width - first), Math.abs(width - last)), "only ever the old or the new width: no stretch").toBeLessThan(2);
});

test("the effort slider skips the levels a model does not support", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  const slider = page.getByRole("slider", { name: "Master effort" });
  await expect(slider).toBeVisible();
  // The mock model supports low, medium and high.
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider, "Home lands on the lowest supported level").toHaveAttribute("aria-valuetext", "low");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "medium");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "high");
  await page.keyboard.press("ArrowRight");
  await expect(slider, "there is nowhere above high to go").toHaveAttribute("aria-valuetext", "high");
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "high");
  // Dragging to the far end snaps back to the highest supported stop.
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(slider, "dragging past the last supported level stays on it").toHaveAttribute("aria-valuetext", "high");
  await expect(page.locator('[title="mock/gpt-5 does not support xhigh"]').first(), "unsupported stops say so").toBeVisible();
});

test("only one toast shows at a time, with a light blur behind it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Lobby", exact: true }).click();
  const port = page.getByRole("spinbutton", { name: "Port" });
  await expect(port).toBeVisible();
  let most = 0;
  const sample = setInterval(() => {
    void page.locator(".backdrop-blur-xs").count().then((count) => (most = Math.max(most, count))).catch(() => undefined);
  }, 40);
  await port.fill("70000");
  await port.press("Enter");
  await page.getByRole("switch", { name: "Issues tab" }).click();
  await expect(page.getByText("is not a port")).toBeVisible();
  await expect(page.getByText("Settings saved")).toBeVisible({ timeout: 10_000 });
  clearInterval(sample);
  expect(most, "never two toasts together").toBeLessThanOrEqual(1);
  expect(most, "a toast was seen").toBe(1);
});

test("a question pop-up holds the only overlay slot: the key help waits for it", async ({ page, server }) => {
  await openScenario(page, server, "question");
  await page.setViewportSize({ width: 1280, height: 900 });
  const question = page.locator('section[aria-label="Question from the lobby"]');
  await expect(question).toContainText("Start the mock server on 7347?");
  await expect(page.locator(".backdrop-blur-sm").first(), "the pop-up's backdrop is blurred").toBeVisible();
  await page.keyboard.press("Alt+h");
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog"), "one pop-up at a time").toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Keys" })).toHaveCount(0);
  await expect(page.locator("[inert] #composer-text"), "the composer steps aside").toHaveCount(1);
  await question.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("dialog", { name: "Keys" }), "the help takes the slot once the question is answered").toBeVisible();
});

test("the composer takes an image, shows it, and clears it once sent", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('input[type="file"]').setInputFiles({ name: "mockup.png", mimeType: "image/png", buffer: PNG });
  const chips = page.getByRole("list", { name: "Attachments" });
  const preview = chips.getByRole("img", { name: "mockup.png" });
  await expect(preview, "the image shows as a preview in the box").toBeVisible();
  await expect.poll(async () => (await preview.boundingBox())!.width, { message: "a real thumbnail, not an icon (it springs in first)" }).toBeGreaterThanOrEqual(56);
  await page.getByLabel("Message the oracle").fill("see this");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chips).toHaveCount(0);
  await expect(page.getByLabel("Message the oracle")).toHaveValue("");
});

test("the box grows with what is typed, carries lists on, formats with Ctrl+B and previews the Markdown", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  const box = page.getByLabel("Message the oracle");
  const before = (await box.boundingBox())!.height;
  await box.fill("- one");
  await box.press("Shift+Enter");
  await expect(box, "Shift+Enter on a list line carries the list on").toHaveValue("- one\n- ");
  await box.pressSequentially("two");
  await box.press("Shift+Enter");
  await box.press("Shift+Enter");
  await expect(box, "an empty marker ends the list").toHaveValue("- one\n- two\n");
  expect((await box.boundingBox())!.height, "it grew with the lines").toBeGreaterThan(before + 20);
  await box.fill("make this bold");
  await box.press("Control+a");
  await box.press("Control+b");
  await expect(box).toHaveValue("**make this bold**");
  await page.getByRole("button", { name: "Preview the Markdown" }).click();
  await expect(page.getByRole("region", { name: "Markdown preview" }).locator("strong"), "the preview renders it").toHaveText("make this bold");
});

test("the dock grows and shrinks with the text on its own, over the page, and the page makes room to scroll clear of it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  const box = page.locator("#composer-text");
  const card = box.locator("xpath=ancestor::div[contains(@class,'group/composer')]");
  const chat = page.getByRole("log", { name: "Conversation" });
  const pad = () => chat.evaluate((el: any) => parseFloat(getComputedStyle(el).paddingBottom));
  const before = (await box.boundingBox())!.height;
  const mainBefore = (await page.locator("#main").boundingBox())!;
  const padBefore = await pad();
  await box.fill("one\ntwo\nthree\nfour\nfive\nsix");
  await expect.poll(async () => (await box.boundingBox())!.height, { message: "six lines make the box taller" }).toBeGreaterThan(before + 100);
  const mainAfter = (await page.locator("#main").boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  expect(Math.abs(mainAfter.y - mainBefore.y), "the page does not move").toBeLessThanOrEqual(2);
  expect(Math.abs(mainAfter.height - mainBefore.height), "nor shrink: the box floats over it").toBeLessThanOrEqual(2);
  expect(mainAfter.y + mainAfter.height, "the page runs on under the dock").toBeGreaterThan(cardBox.y + 40);
  await expect.poll(pad, { message: "the conversation leaves room to scroll clear of the taller dock" }).toBeGreaterThan(padBefore + 80);
  expect(cardBox.y + cardBox.height, "the box stays on the screen").toBeLessThanOrEqual(900);
  await box.fill("");
  await expect.poll(async () => (await box.boundingBox())!.height, { message: "and shrinks back when emptied" }).toBeLessThan(before + 20);
  await expect(page.getByRole("button", { name: /Open the box wider and taller|Make the box smaller/ }), "there is no expand or collapse toggle").toHaveCount(0);
});

test("on Settings the model selectors stack inside the agent card, one card per row on a tablet", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  const masterCard = page.locator("section.glass").filter({ has: page.getByRole("heading", { name: "Master", exact: true }) });
  await expect(masterCard, "the Master's card").toBeVisible();
  const model = masterCard.getByRole("combobox", { name: "Master model" });
  await expect(model).toBeVisible();
  await expect(page.getByRole("combobox", { name: /fallback/i }), "fallback configuration is removed").toHaveCount(0);
  const modelBox = (await model.boundingBox())!;
  const cardBox = (await masterCard.boundingBox())!;
  expect(modelBox.x + modelBox.width, "the selector stays within the card").toBeLessThanOrEqual(cardBox.x + cardBox.width);
  await page.setViewportSize({ width: 1024, height: 768 });
  const designerCard = page.locator("section.glass").filter({ has: page.getByRole("heading", { name: "Designer", exact: true }) });
  await expect(designerCard, "the Designer's card").toBeVisible();
  const designerBox = (await designerCard.boundingBox())!;
  const masterAtTablet = (await masterCard.boundingBox())!;
  expect(Math.abs(designerBox.x - masterAtTablet.x), "one card per row at tablet width").toBeLessThanOrEqual(2);
  expect(designerBox.y, "the next card is below, not beside").toBeGreaterThan(masterAtTablet.y + 20);
});

test("Plan, Quick fix and an open task each give the composer its own target", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [hash, label] of [
    ["#/plan", "Message the panel"],
    ["#/quickfix", "Describe a quick fix"],
    ["#/tasks/T-mock-1", "Comment on T-mock-1"],
  ] as const) {
    await page.evaluate((to: string) => {
      window.location.hash = to;
    }, hash);
    await expect(page.getByLabel(label), hash).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Send to" }).or(page.getByText(/^To the /)), `${hash} says who it goes to`).toBeVisible();
  }
});

test("zen palettes: warm paper in light, deep ink in dark, a quiet indigo accent, a 12px surface under 8px controls, a 16px dock floating over it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const look = await page.evaluate(() => {
    const rgb = (el: any) => getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
    const dark = document.documentElement.classList.contains("dark");
    const card = document.querySelector("#main");
    const box = (el: any) => el.getBoundingClientRect();
    const composer = box(document.querySelector("#composer-text").closest(".group\\/composer"));
    const main = box(document.querySelector("#main"));
    const inactive = [...document.querySelectorAll('[role="tab"][aria-selected="false"]')][0] as any;
    const active = document.querySelector('[role="tablist"] > span') as any;
    return {
      dark,
      page: rgb(document.body),
      cardRadius: getComputedStyle(card).borderTopLeftRadius,
      inputRadius: getComputedStyle(document.querySelector("#composer-text").closest(".group\\/composer")).borderTopLeftRadius,
      cardBottom: composer.bottom,
      composerTop: composer.top,
      mainBottom: main.bottom,
      inner: window.innerHeight,
      inactiveBorder: getComputedStyle(inactive).borderTopWidth,
      pillRadius: getComputedStyle(active).borderTopLeftRadius,
      body: getComputedStyle(document.body).backgroundImage,
      primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    };
  });
  const [r, g, b] = look.page as [number, number, number];
  if (look.dark) expect(Math.max(r, g, b), "near-black is dark").toBeLessThan(32);
  else expect(Math.min(r, g, b), "paper is light").toBeGreaterThan(230);
  const accent = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(look.primary);
  expect(accent, `the accent is a hex colour (${look.primary})`).not.toBeNull();
  const [ar, , ab] = accent!.slice(1).map((part) => parseInt(part, 16)) as [number, number, number];
  expect(ab - ar, "the accent leans blue, not warm").toBeGreaterThan(60);
  expect(look.body, "flat page, no wash").toBe("none");
  expect(look.cardRadius, "the page's surface").toBe("12px");
  expect(look.inputRadius, "the floating dock has softer corners").toBe("16px");
  expect(look.inactiveBorder, "inactive tabs are plain text").toBe("0px");
  expect(look.pillRadius, "the active pill has the same 8px corners").toBe("8px");
  expect(look.cardBottom, "the composer stays on the screen").toBeLessThanOrEqual(look.inner);
  expect(look.mainBottom, "and the page runs on under the dock").toBeGreaterThan(look.composerTop);
});

test("keyboard hints: the box prints its keys, the header button opens the key list, a tab's tooltip names its key", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const hints = page.locator("#composer-text").locator("xpath=ancestor::div[contains(@class,'group/composer')][1]");
  await expect(hints.getByText("new line"), "Shift+Enter is hinted").toBeVisible();
  await expect(hints.getByText("shortcuts"), "and the way to the full list").toBeVisible();
  await page.getByRole("tab", { name: /Tasks/ }).hover();
  await expect(page.locator('[data-slot="tooltip-content"]').first(), "a tab's tooltip shows its Alt+N").toContainText(/Alt\s*(plus)?\s*2/);
  await page.mouse.move(0, 400);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).first().click();
  const keys = page.getByRole("dialog", { name: "Keys" });
  await expect(keys).toBeVisible();
  await expect(keys.getByText("Message box", { exact: true }), "the list covers the message box too").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(keys).toBeHidden();
});

test("the page itself never scrolls: no empty page below the composer, whatever the tab", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1024, height: 700 });
  for (const hash of ["#/lobby", "#/tasks", "#/metrics", "#/settings", "#/knowledge", "#/git"]) {
    await page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
    await page.waitForTimeout(250);
    const run = await page.evaluate(() => {
      const root = document.scrollingElement as any;
      window.scrollTo(0, 400);
      document.body.scrollTop = 400;
      (document.getElementById("composer-text") as any)?.focus();
      const composer = (document.getElementById("composer-text") as any).getBoundingClientRect();
      return { y: window.scrollY + root.scrollTop + document.body.scrollTop, bottom: composer.bottom, inner: window.innerHeight };
    });
    expect(run.y, `${hash}: the page does not scroll`).toBe(0);
    expect(run.bottom, `${hash}: the composer stays on the screen`).toBeLessThanOrEqual(run.inner);
  }
});

test("questions are answered from the keyboard alone: y/n, arrows, Space, Enter", async ({ page, server }) => {
  await openScenario(page, server, "question");
  await page.setViewportSize({ width: 1280, height: 800 });
  const popup = page.locator('section[aria-label="Question from the lobby"]');
  await expect(popup).toContainText("Start the mock server on 7347?");
  await page.keyboard.press("y");
  await expect(popup, "y answers yes").toBeHidden();
  await page.getByLabel("Message the oracle").fill("go");
  await page.keyboard.press("Enter");
  await expect(popup).toContainText("Which set should stream next?");
  await expect(popup.locator('[data-option="0"]'), "the first option has focus").toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(popup.locator('[data-option="1"]'), "Down moves to the next option").toBeFocused();
  await page.keyboard.press("Space");
  await expect(popup.locator('[data-option="1"]'), "Space picks it").toBeChecked();
  await page.keyboard.press("Enter");
  await expect(popup, "Enter answers").toBeHidden();
});

test("lists are walked with the keyboard: Down from the tab bar, arrows between rows, right into the detail, Esc back up", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page.getByRole("tab", { name: /Tasks/ }).focus();
  await page.keyboard.press("ArrowDown");
  const list = page.locator('[data-pane="list"]');
  await expect(list.locator(":focus"), "Down from the tab bar lands on a row of the list").toHaveCount(1);
  const first = await list.locator(":focus").textContent();
  await page.keyboard.press("ArrowDown");
  expect(await list.locator(":focus").textContent(), "Down moves to the next row").not.toBe(first);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-pane="detail"]'), "Right goes into the detail").toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(list.locator(":focus"), "Left comes back").toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: /Tasks/ }), "Esc goes back up to the tab bar").toBeFocused();
  await page.keyboard.press("/");
  await expect(page.locator("#composer-text"), "/ jumps to the message box").toBeFocused();
});

test("Knowledge agents fold and unfold, with the keyboard too", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.location.hash = "#/knowledge";
  });
  const master = page.getByRole("button", { name: /Master \(oracle\)/ });
  await expect(master).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /^Knowledge/ }).first(), "its file is listed").toBeVisible();
  await master.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(master, "Left folds it").toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(master, "Right opens it").toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter");
  await expect(master, "Enter toggles it").toHaveAttribute("aria-expanded", "false");
});

test("every drop-down has a search box, and the keyboard picks from it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  const trigger = page.getByRole("combobox", { name: "Master model" });
  await trigger.click();
  const search = page.getByRole("searchbox", { name: /Search Master model/ });
  await expect(search, "the search box takes focus").toBeFocused();
  await search.fill("zzz-no-such-model");
  await expect(page.getByText("Nothing matches")).toBeVisible();
  await search.fill("");
  await expect(page.getByRole("option").first()).toBeVisible();
  const before = await page.getByRole("option").count();
  await search.fill("mock");
  expect(await page.getByRole("option").count(), "typing narrows the list").toBeLessThanOrEqual(before);
  await page.keyboard.press("Escape");
  await expect(search, "Esc closes it").toBeHidden();
  await expect(trigger, "and gives focus back").toBeFocused();
});

test("a drop-down opens with the arrow key and its list is wide enough to read", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  const trigger = page.getByRole("combobox", { name: "Backend model" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const list = page.getByRole("listbox", { name: "Backend model" });
  await expect(list, "Down opens it").toBeVisible();
  const box = await list.boundingBox();
  expect(box?.width ?? 0, "wider than a narrow trigger").toBeGreaterThanOrEqual(240);
  await page.keyboard.press("Tab");
  await expect(list, "Tab leaves it").toBeHidden();
});

test("the mascot on each agent acts out its effort level, and the page never scrolls sideways", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  const card = page.locator("section.glass", { hasText: "Backend" }).first();
  const mascot = card.locator('[data-slot="effort-mascot"]');
  await expect(mascot).toBeVisible();
  await expect(mascot, "medium by default").toHaveAttribute("data-level", "medium");
  const slider = card.getByRole("slider", { name: "Backend effort" });
  await slider.focus();
  await slider.press("Home");
  await expect(mascot, "Home is the lowest: asleep").toHaveAttribute("data-level", "off");
  await slider.press("End");
  await expect(mascot, "End is the highest: blazing").toHaveAttribute("data-level", "max");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no sideways scroll").toBeLessThanOrEqual(0);
  await slider.press("Home");
  await expect(mascot).toHaveAttribute("data-level", "off");
});

test("Alt+A and Alt+T respect text entry and open Thinking from the bubble", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/lobby";
  });
  const activity = page.getByRole("button", { name: /Minimize Activity|Expand Activity/ });
  const thinking = page.getByRole("button", { name: "Open Thinking" });
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  await expect(activity, "the tooltip names the key").toHaveAttribute("title", /Alt\+A/);
  await expect(thinking).toHaveAttribute("aria-expanded", "false");
  await page.locator("#composer-text").focus();
  await page.keyboard.press("Alt+a");
  await expect(activity, "shortcuts do not steal text-entry focus").toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Alt+t");
  await expect(thinking, "Thinking remains minimized while typing").toHaveAttribute("aria-expanded", "false");
  await thinking.focus();
  await page.keyboard.press("Alt+t");
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true })).toBeHidden();
  await page.keyboard.press("Alt+h");
  const keys = page.getByRole("dialog", { name: "Keys" });
  await expect(keys.getByText("show or hide Activity on the Lobby"), "the key list has it").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(keys, "a dialog on its way out still blocks the keys").toBeHidden();
  await page.evaluate(() => {
    window.location.hash = "#/tasks";
  });
  // Alt+A is typing while the cursor is in the message box; Esc steps out to the tab bar first.
  await page.locator("#composer-text").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+a");
  await expect(page, "off the Lobby it takes you there").toHaveURL(/#\/lobby/);
});

test("colour themes: a built-in one repaints the page and survives a reload; a tweakcn export can be pasted; bad values are refused", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
  const before = await primary();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance & notifications", exact: true }).click();
  const group = page.getByRole("radiogroup", { name: "Colour theme" });
  await expect(group.getByRole("radio", { name: /Mist/ }), "the page's own colours are the default").toHaveAttribute("aria-checked", "true");
  await group.getByRole("radio", { name: /Forest/ }).click();
  await expect(group.getByRole("radio", { name: /Forest/ })).toHaveAttribute("aria-checked", "true");
  expect(await primary(), "Forest changes the accent").not.toBe(before);
  await group.getByRole("radio", { name: /Forest/ }).press("ArrowRight");
  await expect(group.getByRole("radio", { name: /Ocean/ }), "arrows walk the themes").toHaveAttribute("aria-checked", "true");
  await page.reload();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance & notifications", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Colour theme" }).getByRole("radio", { name: /Ocean/ }), "the choice is remembered").toHaveAttribute("aria-checked", "true");

  const box = page.getByLabel("Theme CSS from tweakcn");
  const apply = page.getByRole("button", { name: "Apply the pasted theme" });
  await box.fill("hello");
  await apply.click();
  await expect(page.getByRole("alert"), "text that is not a theme says so").toContainText("No theme colours");
  const pasted = (value: string) => `:root{--background:#fafafa;--foreground:#111;--card:#fff;--card-foreground:#111;--primary:${value};--primary-foreground:#fff;--muted:#eee;--border:#ddd}.dark{--background:#000;--foreground:#eee;--card:#111;--card-foreground:#eee;--primary:#f80;--primary-foreground:#000}`;
  await box.fill(pasted("url(https://evil.example/x.png)"));
  await apply.click();
  expect(await primary(), "an unsafe value is dropped, not applied").not.toContain("evil");
  await box.fill(pasted("#e11d48"));
  await apply.click();
  await expect(group.getByRole("radio", { name: /Custom theme/ }), "the pasted theme is kept and selected").toHaveAttribute("aria-checked", "true");
  const light = await page.evaluate(() => document.documentElement.classList.contains("light"));
  expect(await primary(), light ? "light uses the :root block" : "dark uses the .dark block").toBe(light ? "#e11d48" : "#f80");
  await page.getByRole("button", { name: /Remove Custom theme/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Remove theme/ }).click();
  await expect(group.getByRole("radio", { name: /Custom theme/ }), "removing it").toHaveCount(0);
  await expect(group.getByRole("radio", { name: /Mist/ })).toHaveAttribute("aria-checked", "true");
  expect(await primary()).toBe(before);
});

test("a theme file (.css or the registry .json) uploads and is named after the file", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance & notifications", exact: true }).click();
  const css = ":root{--background:#fafafa;--foreground:#111;--card:#fff;--primary:#0a7;--primary-foreground:#fff}\n.dark{--background:#000;--foreground:#eee;--card:#111;--primary:#4fd;--primary-foreground:#000}";
  await page.getByLabel("Upload a theme file").setInputFiles({ name: "Mint Fresh.css", mimeType: "text/css", buffer: Buffer.from(css) });
  await expect(page.getByRole("radiogroup", { name: "Colour theme" }).getByRole("radio", { name: /Mint Fresh/ })).toHaveAttribute("aria-checked", "true");
  const json = JSON.stringify({ title: "Sunrise", cssVars: { light: { background: "#fff", foreground: "#111", card: "#fff", primary: "#f60", "primary-foreground": "#fff" }, dark: { background: "#000", foreground: "#eee", card: "#111", primary: "#fa6", "primary-foreground": "#000" } } });
  await page.getByLabel("Upload a theme file").setInputFiles({ name: "sunrise.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await expect(page.getByRole("radiogroup", { name: "Colour theme" }).getByRole("radio", { name: /Sunrise/ }), "the JSON's own title wins").toHaveAttribute("aria-checked", "true");
});

test("switching tabs puts the cursor in the message box; arrowing along the tab bar keeps it on the bar", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("tab", { name: /Git/ }).click();
  await expect(page.locator("#composer-text"), "a click on a tab").toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+2");
  await expect(page, "an Alt+N jump from the tab bar").toHaveURL(/#\/tasks/);
  await expect(page.locator("#composer-text"), "an Alt+N jump").toBeFocused();
  await page.getByRole("tab", { name: /Tasks/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Plan/ }), "arrows stay on the bar").toBeFocused();
});

test("the Settings page offers the fullscreen install and a fullscreen toggle", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance & notifications", exact: true }).click();
  const install = page.getByRole("button", { name: "Install as fullscreen app" });
  await expect(install).toBeVisible();
  await install.click();
  await expect(page.locator('[role="status"]').filter({ hasText: "Install app" }).first(), "without a browser prompt it says where to find the install action").toBeVisible();
  const manifest = (await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json())) as { display: string };
  expect(manifest.display, "the manifest asks for fullscreen").toBe("fullscreen");
});

test("choices use the right inputs: real checkboxes for several, a switch for on/off, a radio group for one of two", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/excalidraw/room-1";
  });
  await page.evaluate(() => {
    window.location.hash = "#/plan";
  });
  await expect(page.getByRole("checkbox").first(), "plan seats are checkboxes").toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/metrics";
  });
  await expect(page.getByRole("radiogroup", { name: "Group by" }).getByRole("radio")).toHaveCount(2);
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-1";
  });
  await expect(page.getByRole("switch", { name: "Auto mode" }), "auto is a switch").toBeVisible();
  expect(await page.getByText("[x]").count() + (await page.getByText("[ ]").count()), "no text-drawn boxes").toBe(0);
});

test("action buttons say what they do and which key does it, and stay pinned in view while the detail scrolls", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-1";
  });
  const bar = page.getByRole("toolbar", { name: "Actions" });
  await expect(bar).toBeVisible();
  const archive = bar.getByRole("button", { name: "Archive" });
  await expect(archive, "a button named for what it does").toBeVisible();
  await expect(archive, "with the word on it").toContainText("Archive");
  await expect(archive.locator("kbd").first(), "and the key that does it").toHaveText("E");
  await expect(archive).toHaveAttribute("aria-keyshortcuts", "E");
  const remove = bar.getByRole("button", { name: "Delete" });
  await expect(remove).toContainText("Delete");
  await expect(remove.locator("kbd").first(), "Delete is the Delete key").toHaveText("Del");
  const detail = page.locator('[data-pane="detail"]');
  await detail.evaluate((el: any) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(150);
  const box = await bar.boundingBox();
  const pane = (await detail.boundingBox())!;
  expect(box!.y, "after scrolling to the bottom the bar is still at the top of the pane").toBeLessThanOrEqual(pane.y + 4);
  await expect(bar.getByRole("button", { name: "Delete" })).toBeVisible();
});

test("the keys printed on the buttons work from the page, ask before anything is lost, and leave the message box alone", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-1";
  });
  const composer = page.locator("#composer-text");
  await expect(composer, "a tab switch leaves the cursor in the message box").toBeFocused();
  await page.keyboard.press("e");
  await expect(composer, "the letter is typed, not taken as a shortcut").toHaveValue("e");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await composer.fill("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: /Tasks/ }), "Esc leaves the box for the tab bar").toBeFocused();
  await page.keyboard.press("e");
  const archive = page.getByRole("alertdialog");
  await expect(archive, "E asks to archive").toContainText("Archive");
  await expect(archive.getByRole("button", { name: /Keep it/ }).locator('[data-slot="kbd"]'), "Esc keeps it").toHaveText("Esc");
  await expect(archive.getByRole("button", { name: /^Archive/ }).locator('[data-slot="kbd"]'), "Y goes ahead").toHaveText("Y");
  await expect(archive.getByRole("button", { name: /Keep it/ }), "focus starts on the safe choice").toBeFocused();
  await page.keyboard.press("Escape");
  await expect(archive).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog"), "Delete asks before it deletes").toContainText("for good");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("the Lobby's task header is one slim line", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  const header = page.getByRole("group", { name: "Task" });
  await expect(header).toContainText("Add offline mock fixtures");
  expect((await header.boundingBox())!.height, "a single line, not a card").toBeLessThanOrEqual(48);
});

test("Activity folds to its title bar and Thinking opens only in a modal", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const main = page.locator("#main");
  await expect(main.getByRole("log", { name: "Activity" })).toBeVisible();
  await page.getByRole("button", { name: "Minimize Activity" }).click();
  await expect(main.getByRole("log", { name: "Activity" }), "the log is gone").toBeHidden();
  await expect(page.getByRole("button", { name: "Expand Activity" }), "its bar stays").toBeVisible();
  await page.getByRole("button", { name: "Open Thinking" }).click();
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Minimize/ }).click();
  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await expect(page.getByRole("button", { name: "Open Thinking" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Expand Activity" }).click();
  await expect(main.getByRole("log", { name: "Activity" })).toBeVisible();
  await expect(main.getByRole("log", { name: "Thinking" }), "there is no third fixed pane").toHaveCount(0);
});

test("every tab carries an icon", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const tabs = page.getByRole("tab");
  const count = await tabs.count();
  for (let i = 0; i < count; i += 1) await expect(tabs.nth(i).locator("svg"), `tab ${i + 1}`).toHaveCount(1);
});

test("the project switcher is a list you open with P, not a native select", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("header select"), "no native select in the top bar").toHaveCount(0);
  await page.getByRole("tab", { name: /Tasks/ }).focus();
  await page.keyboard.press("p");
  const list = page.getByRole("listbox", { name: "Projects" });
  await expect(list, "P opens the list of running projects").toBeVisible();
  await expect(list.getByRole("option").first(), "the open project is marked").toHaveAttribute("aria-selected", "true");
  await expect(list.getByRole("option").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list, "Esc closes it").toBeHidden();
  await expect(page.getByRole("combobox", { name: "Project", exact: true }), "and gives focus back").toBeFocused();
});

test("below 1024px the Lobby shows one pane at a time behind a switcher, and the chat keeps the room", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 390, height: 844 });
  const panes = page.getByRole("radiogroup", { name: "Pane" });
  await expect(panes).toBeVisible();
  const chat = page.getByRole("log", { name: "Conversation" });
  await expect(chat).toBeVisible();
  expect((await chat.boundingBox())!.height, "the conversation is not squeezed into a sliver").toBeGreaterThan(300);
  await panes.getByRole("radio", { name: /Activity/ }).click();
  await expect(page.getByRole("log", { name: "Activity" })).toBeVisible();
  await expect(chat, "the others step aside").toBeHidden();
  await expect(panes.getByRole("radio", { name: /Thinking/ }), "Thinking is a bubble, not a pane").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Thinking" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no sideways scroll").toBeLessThanOrEqual(0);
});

test("the message box floats over the page, and every page scrolls clear of it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 640 });
  for (const hash of ["#/lobby", "#/tasks/T-mock-1", "#/plan", "#/settings", "#/metrics", "#/sessions"]) {
    await page.evaluate((to) => {
      window.location.hash = to;
    }, hash);
    await page.waitForTimeout(300);
    const run = await page.evaluate(() => {
      const main = document.getElementById("main") as any;
      const dock = (document.getElementById("composer-text") as any).closest(".group\\/composer").getBoundingClientRect();
      // Scroll everything that scrolls to its end, the way a reader would.
      for (const el of [main, ...main.querySelectorAll("*")] as any[]) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
      const covered = [...main.querySelectorAll("button, a[href], input, textarea, [role='switch'], [role='slider']")]
        .map((el: any) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ el, box }) => box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden")
        .filter(({ box }) => box.bottom > dock.top + 1 && box.top < dock.bottom && box.right > dock.left && box.left < dock.right)
        .map(({ el }) => el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName);
      return { mainBottom: main.getBoundingClientRect().bottom, dockTop: dock.top, covered };
    });
    expect(run.mainBottom, `${hash}: the page runs under the dock`).toBeGreaterThan(run.dockTop);
    expect(run.covered, `${hash}: scrolled to the end, nothing is left under the dock`).toEqual([]);
  }
});

test("Esc leaves the message box on Sessions and Settings too, so the keys on those pages work", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.location.hash = "#/sessions";
  });
  const composer = page.locator("#composer-text");
  await expect(page.getByRole("button", { name: "Back to this window" }), "the page has switched").toBeVisible();
  // The switch hands the cursor to the message box on the next frame; wait it out so Esc is the last thing to move it.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))));
  await expect(composer, "a page switch leaves the cursor in the message box").toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer, "Esc leaves it though no tab is selected").not.toBeFocused();
  await expect(page.getByRole("button", { name: "Back to this window" }).locator('[data-slot="kbd"]'), "the button prints its key").toHaveText("B");
  await page.keyboard.press("b");
  await expect(page, "and B takes you back to the Lobby").toHaveURL(/#\/lobby/);
});

test("on Excalidraw R reveals the link and O opens the board in a new tab", async ({ page, server }) => {
  await page.context().route("https://whiteboard.example/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>board</title>" }));
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.location.hash = "#/excalidraw/x1";
  });
  await expect(page.getByRole("button", { name: "Reveal the link" })).toBeVisible();
  await expect(page.locator("#composer-text")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await expect(page.locator("#main"), "R reveals the full room link").toContainText("whiteboard.example");
  const open = page.getByRole("link", { name: "Open board" });
  await expect(open.locator('[data-slot="kbd"]'), "Open board prints its key").toHaveText("O");
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("o");
  expect((await popup).url(), "O opens it in a new tab").toContain("whiteboard.example");
});

test("a button's key never fires from a form: Enter elsewhere does not send a half-written note", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.location.hash = "#/excalidraw/x1";
  });
  const note = page.getByLabel("Add by link");
  await expect(note).toBeVisible();
  await note.fill("https://whiteboard.example/#room=zzz,AAAAAAAAAAAAAAAAAAAAAA");
  await page.locator("#main").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await expect(note, "the note is still waiting to be sent").toHaveValue(/whiteboard\.example/);
});

test("quick key presses on the effort slider add up instead of each starting from the saved level", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  const slider = page.getByRole("slider", { name: "Master effort" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuetext", "low");
  // No waiting between them: the server has not answered the first when the second arrives.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(slider, "two quick presses climb two stops").toHaveAttribute("aria-valuetext", "high");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect(slider, "left then right ends where it began").toHaveAttribute("aria-valuetext", "high");
  await page.waitForTimeout(600);
  await expect(slider, "and it stays there once the server has answered").toHaveAttribute("aria-valuetext", "high");
});
