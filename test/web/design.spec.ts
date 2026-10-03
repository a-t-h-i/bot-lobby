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
  await expect.poll(async () => (await preview.boundingBox())!.width, { message: "a real thumbnail, not an icon (it springs in first)" }).toBeGreaterThanOrEqual(60);
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

test("the composer's tall editor opens and closes", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  const box = page.getByLabel("Message the oracle");
  const before = (await box.boundingBox())!.height;
  await page.getByRole("button", { name: "Open the box wider and taller" }).click();
  await page.waitForTimeout(700);
  expect((await box.boundingBox())!.height, "it grows").toBeGreaterThan(before + 100);
  await page.getByRole("button", { name: "Make the box smaller" }).click();
  await page.waitForTimeout(700);
  expect((await box.boundingBox())!.height, "and shrinks back").toBeLessThan(before + 20);
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

test("zen palettes: cool mist in light, graphite in dark, an indigo accent, one 8px radius, composer clear of the page", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const look = await page.evaluate(() => {
    const rgb = (el: any) => getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
    const dark = document.documentElement.classList.contains("dark");
    const card = document.querySelector("#main section");
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
      gap: composer.top - main.bottom,
      inactiveBorder: getComputedStyle(inactive).borderTopWidth,
      pillRadius: getComputedStyle(active).borderTopLeftRadius,
      body: getComputedStyle(document.body).backgroundImage,
      primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    };
  });
  const [r, g, b] = look.page as [number, number, number];
  if (look.dark) expect(Math.max(r, g, b), "graphite is dark").toBeLessThan(60);
  else expect(Math.min(r, g, b), "mist is light").toBeGreaterThan(230);
  const accent = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(look.primary);
  expect(accent, `the accent is a hex colour (${look.primary})`).not.toBeNull();
  const [ar, , ab] = accent!.slice(1).map((part) => parseInt(part, 16)) as [number, number, number];
  expect(ab - ar, "the accent leans blue, not warm").toBeGreaterThan(60);
  expect(look.body, "flat page, no wash").toBe("none");
  expect(look.cardRadius).toBe("8px");
  expect(look.inputRadius).toBe("8px");
  expect(look.inactiveBorder, "inactive tabs are plain text").toBe("0px");
  expect(look.pillRadius, "the active pill has 10px corners").toBe("10px");
  expect(look.gap, "the composer never touches the page above it").toBeGreaterThanOrEqual(2);
});

test("keyboard hints: the box prints its keys, the header button opens the key list, a tab's tooltip names its key", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const hints = page.locator("#composer-text").locator("xpath=ancestor::div[contains(@class,'shrink-0')][1]");
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

test("Activity and Thinking fold down to their title bar and open again", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const main = page.locator("#main");
  await expect(main.getByRole("log", { name: "Activity" })).toBeVisible();
  await page.getByRole("button", { name: "Minimize Activity" }).click();
  await expect(main.getByRole("log", { name: "Activity" }), "the log is gone").toBeHidden();
  await expect(page.getByRole("button", { name: "Expand Activity" }), "its bar stays").toBeVisible();
  await page.getByRole("button", { name: "Minimize Thinking" }).click();
  await expect(main.getByRole("log", { name: "Thinking" })).toBeHidden();
  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await expect(page.getByRole("button", { name: "Expand Thinking" }), "the choice is remembered").toBeVisible();
  await page.getByRole("button", { name: "Expand Activity" }).click();
  await page.getByRole("button", { name: "Expand Thinking" }).click();
  await expect(main.getByRole("log", { name: "Activity" })).toBeVisible();
  await expect(main.getByRole("log", { name: "Thinking" })).toBeVisible();
});

test("every tab carries an icon", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const tabs = page.getByRole("tab");
  const count = await tabs.count();
  for (let i = 0; i < count; i += 1) await expect(tabs.nth(i).locator("svg"), `tab ${i + 1}`).toHaveCount(1);
});
