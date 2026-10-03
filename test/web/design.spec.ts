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
  await expect(chips).toContainText("mockup.png");
  await expect(chips.getByText("uploading…"), "the upload finishes").toBeHidden({ timeout: 10_000 });
  await page.getByLabel("Message the oracle").fill("see this");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chips).toHaveCount(0);
  await expect(page.getByLabel("Message the oracle")).toHaveValue("");
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

test("zen palettes: paper in light, charcoal in dark, one 8px radius, composer clear of the page", async ({ page, server }) => {
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
    };
  });
  const [r, g, b] = look.page as [number, number, number];
  if (look.dark) expect(Math.max(r, g, b), "charcoal is dark").toBeLessThan(60);
  else expect(Math.min(r, g, b), "paper is light").toBeGreaterThan(230);
  expect(look.body, "flat page, no wash").toBe("none");
  expect(look.cardRadius).toBe("8px");
  expect(look.inputRadius).toBe("8px");
  expect(look.inactiveBorder, "inactive tabs are plain text").toBe("0px");
  expect(look.pillRadius, "the active pill has 10px corners").toBe("10px");
  expect(look.gap, "the composer never touches the page above it").toBeGreaterThanOrEqual(2);
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
