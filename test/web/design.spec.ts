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

/** Clicks the tab named `name` and records the straw, the fill, both rings and how far the tab is knocked on every frame for 1.3s. */
async function recordSwitch(page: any, name: string) {
  return page.evaluate(async (name: string) => {
    const fill = document.querySelector("[data-tab-fill]") as any;
    const drain = document.querySelector("[data-tab-drain]") as any;
    const ring = document.querySelector("[data-tab-ring]") as any;
    const unring = document.querySelector("[data-tab-unring]") as any;
    const target = [...document.querySelectorAll('[role="tab"]')].find((el: any) => el.textContent.includes(name)) as any;
    const source = document.querySelector('[role="tab"][aria-selected="true"]') as any;
    // How far round a ring is drawn (0 when hidden), and the side it is drawn from.
    const rim = (el: any) => ({ amount: Number(getComputedStyle(el).opacity) > 0 ? parseFloat(el.children[0].style.strokeDasharray) || 0 : 0, port: el.dataset.port as string });
    const frames: Array<{ t: number; liquid: number[]; drain: number; fill: number; ring: { amount: number; port: string }; unring: { amount: number; port: string }; budge: number }> = [];
    const start = performance.now();
    target.click();
    await new Promise<void>((resolve) => {
      const tick = () => {
        frames.push({
          t: performance.now() - start,
          liquid: [...document.querySelectorAll("[data-tab-liquid]")].map((el: any) => el.getBoundingClientRect().width),
          drain: Number(getComputedStyle(drain).opacity) * drain.getBoundingClientRect().width,
          fill: Number(getComputedStyle(fill).opacity) * fill.getBoundingClientRect().width,
          ring: rim(ring),
          unring: rim(unring),
          budge: parseFloat(target.style.translate) || 0,
        });
        if (performance.now() - start < 1300) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    const shape = (el: any) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    return { frames, from: source.getBoundingClientRect().width, tab: shape(target), end: shape(fill), ring: shape(ring), rest: target.style.translate };
  }, name);
}

test("switching tabs pours the colour along the connectors like a straw, runs it round the chosen tab into its border, and the splash knocks the pill", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const run = await recordSwitch(page, "Git");
  const links = run.frames[0]!.liquid.length;
  const wet = new Set(run.frames.flatMap((frame: any) => frame.liquid.map((width: number, n: number) => (width > 1 ? n : -1)).filter((n: number) => n >= 0)));
  expect(links, "dotted connectors join the tabs").toBeGreaterThan(3);
  expect(wet.size, "the colour flows through every connector between Lobby and Git").toBeGreaterThanOrEqual(4);
  expect(run.frames.some((frame: any) => frame.drain > 2 && frame.drain < run.from - 2), "Lobby drains into the straw").toBe(true);
  expect(run.frames.some((frame: any) => frame.unring.amount > 0.05 && frame.unring.amount < 0.95 && frame.unring.port === "right"), "and its ring is sucked back round to the side the straw leaves from").toBe(true);
  // The ring starts on Git's left, where the colour comes in, only once the colour has reached the connector beside it.
  const reached = run.frames.find((frame: any) => frame.liquid[4] > 1);
  const rung = run.frames.find((frame: any) => frame.ring.amount > 0 && frame.ring.amount < 1);
  expect(rung, "the colour runs round Git").toBeDefined();
  expect(rung.ring.port, "from the side it came from").toBe("left");
  expect(rung.t, "as it arrives").toBeGreaterThanOrEqual(reached.t);
  expect(run.frames.some((frame: any) => frame.ring.amount > 0.3 && frame.ring.amount < 0.8), "a ring part way round").toBe(true);
  expect(run.frames.some((frame: any) => frame.fill > 2 && frame.fill < run.tab.width - 2), "Git fills up behind it").toBe(true);
  expect(run.frames.filter((frame: any) => frame.t >= rung.t).every((frame: any) => frame.fill < run.tab.width + 1), "and the tint stays inside the ring").toBe(true);
  expect(run.frames.at(-1)!.liquid.every((width: number) => width < 1), "and the straw is empty again").toBe(true);
  expect(run.frames.at(-1)!.ring.amount, "the ring closes into Git's border").toBeGreaterThanOrEqual(1);
  // The tint splashing against Git's far wall knocks the pill a little along the way it flowed, and it bounces back.
  const knocked = run.frames.find((frame: any) => Math.abs(frame.budge) > 0.5);
  expect(knocked, "the pill budges").toBeDefined();
  expect(knocked.fill, "when the tint reaches the far wall").toBeGreaterThan(run.tab.width * 0.85);
  const furthest = Math.max(...run.frames.map((frame: any) => frame.budge));
  expect(furthest, "to the right, the way the colour flowed").toBeGreaterThan(1.5);
  expect(furthest, "only slightly").toBeLessThan(6);
  expect(Math.min(...run.frames.map((frame: any) => frame.budge)), "swings back past its place").toBeLessThan(-0.2);
  expect(run.rest, "and settles where it was").toBe("");
  // Springs: quick.
  const settled = run.frames.find((frame: any) => frame.t > 50 && frame.liquid.every((width: number) => width < 1) && Math.abs(frame.fill - run.tab.width) < 1.5 && frame.drain < 1 && frame.ring.amount >= 1 && frame.unring.amount === 0);
  expect(settled?.t ?? Infinity, "the whole switch is over in well under a second").toBeLessThan(700);
  expect(Math.abs(run.end.left - run.tab.left), "the fill lands on the tab").toBeLessThan(2);
  expect(Math.abs(run.end.width - run.tab.width), "at the tab's width").toBeLessThan(2);
  expect(Math.abs(run.end.top - run.tab.top) + Math.abs(run.end.height - run.tab.height), "and its height, so the label sits in the middle").toBeLessThan(2);
  expect(Math.abs(run.ring.left - run.tab.left) + Math.abs(run.ring.width - run.tab.width) + Math.abs(run.ring.top - run.tab.top) + Math.abs(run.ring.height - run.tab.height), "the ring sits on the tab's edge").toBeLessThan(3);
  await expect(page.getByRole("tab", { name: /Git/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /Git/ }), "the tab shows its number").toContainText("6");
  // Back to the left: the colour comes into Tasks from its right.
  const back = await recordSwitch(page, "Tasks");
  expect(back.frames.find((frame: any) => frame.ring.amount > 0 && frame.ring.amount < 1)?.ring.port, "coming back, the ring starts on the right").toBe("right");
  expect(back.frames.some((frame: any) => frame.unring.amount > 0.05 && frame.unring.amount < 0.95 && frame.unring.port === "left"), "and Git's ring drains out to the left").toBe(true);
  expect(back.frames.at(-1)!.ring.amount, "and closes round Tasks").toBeGreaterThanOrEqual(1);
  expect(Math.min(...back.frames.map((frame: any) => frame.budge)), "which is knocked to the left").toBeLessThan(-1.5);
  expect(back.rest, "and settles too").toBe("");
});

/** How far each drawn stroke of a tab's icon is, frame by frame, until `ms` have passed. */
async function iconFrames(page: any, id: string, ms: number) {
  return page.evaluate(
    async ({ id, ms }: { id: string; ms: number }) => {
      const seen: Array<{ play: number; drawn: number[] }> = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const icon = document.querySelector(`svg[data-tab-icon="${id}"]`) as any;
          seen.push({ play: Number(icon.dataset.play), drawn: [...icon.querySelectorAll("[pathLength]")].map((el: any) => parseFloat(el.getAttribute("stroke-dasharray")) || 0) });
          if (performance.now() - start < ms) requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      });
      return seen;
    },
    { id, ms }
  );
}

test("each tab's icon plays an animation of its own when the pointer comes onto the tab and when the tab is chosen", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await page.locator('[role="tab"] svg[data-tab-icon]').evaluateAll((icons: any[]) => icons.map((icon) => icon.dataset.tabIcon));
  expect(ids, "every tab has its own icon").toEqual(["lobby", "tasks", "plan", "quickfix", "excalidraw", "git", "knowledge", "metrics"]);
  await expect(page.locator('svg[data-tab-icon][data-play="0"]'), "resting until something happens").toHaveCount(8);
  // Hovering Tasks ticks its boxes: the strokes are drawn again from nothing, then the icon rests as Lucide draws it.
  await page.getByRole("tab", { name: /Tasks/ }).hover();
  const ticks = await iconFrames(page, "tasks", 900);
  expect(ticks.at(-1)!.play, "a hover plays it").toBe(1);
  expect(ticks.some((frame: any) => frame.drawn.some((part: number) => part > 0.1 && part < 0.9)), "its strokes draw in").toBe(true);
  expect(ticks.at(-1)!.drawn.every((part: number) => part === 1), "and end whole").toBe(true);
  // Choosing Plan from the keyboard draws its route as the colour reaches the tab.
  await page.mouse.move(700, 600);
  await page.keyboard.press("Alt+3");
  const route = await iconFrames(page, "plan", 900);
  const first = route.findIndex((frame: any) => frame.play === 1);
  expect(first, "choosing the tab plays its icon").toBeGreaterThan(0);
  expect(route.slice(first).some((frame: any) => frame.drawn.some((part: number) => part > 0.1 && part < 0.9)), "the route draws itself").toBe(true);
  expect(route.at(-1)!.drawn.every((part: number) => part === 1), "and is whole again").toBe(true);
  // Hovering a tab and then clicking it plays once, not twice.
  await page.getByRole("tab", { name: /Git/ }).hover();
  await page.getByRole("tab", { name: /Git/ }).click();
  await page.waitForTimeout(400);
  await expect(page.locator('svg[data-tab-icon="git"]'), "hover then click plays once").toHaveAttribute("data-play", "1");
  await page.waitForTimeout(700);
  await page.mouse.move(700, 600);
  await page.getByRole("tab", { name: /Git/ }).hover();
  await expect(page.locator('svg[data-tab-icon="git"]'), "and again on the next visit").toHaveAttribute("data-play", "2");
});

test("under reduced motion the tab icons stay still", async ({ page, server }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: /Tasks/ }).hover();
  await page.getByRole("tab", { name: /Git/ }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('svg[data-tab-icon][data-play="0"]'), "no icon plays").toHaveCount(8);
});

test("under reduced motion the fill and the ring simply move, with no flow and no knock", async ({ page, server }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const run = await page.evaluate(async () => {
    const target = [...document.querySelectorAll('[role="tab"]')].find((el: any) => /Git/.test(el.textContent)) as any;
    let wet = 0;
    let moved = 0;
    const start = performance.now();
    target.click();
    await new Promise<void>((resolve) => {
      const tick = () => {
        wet = Math.max(wet, ...[...document.querySelectorAll("[data-tab-liquid]")].map((el: any) => el.getBoundingClientRect().width));
        moved = Math.max(moved, Math.abs(parseFloat(target.style.translate) || 0));
        if (performance.now() - start < 500) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    const fill = (document.querySelector("[data-tab-fill]") as any).getBoundingClientRect();
    const ring = document.querySelector("[data-tab-ring]") as any;
    return { wet, moved, fill: fill.left, ring: ring.getBoundingClientRect().left, rung: ring.children[0].style.strokeDasharray, tab: target.getBoundingClientRect().left };
  });
  expect(run.wet, "nothing flows").toBeLessThan(1);
  expect(run.moved, "and the pill is not knocked").toBe(0);
  expect(Math.abs(run.fill - run.tab), "the fill is simply on the new tab").toBeLessThan(2);
  expect(Math.abs(run.ring - run.tab), "and so is its ring").toBeLessThan(2);
  expect(parseFloat(run.rung), "all the way round").toBe(1);
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
    const active = document.querySelector("[data-tab-fill]") as any;
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
  expect(look.inactiveBorder, "inactive tabs are pills with a thin border").toBe("1px");
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

test("Alt+A and Alt+T work from the message box, and Thinking opens from its bubble", async ({ page, server }) => {
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
  await expect(activity, "Alt+A folds Activity from the message box too").toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Alt+a");
  await expect(activity, "and opens it again").toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#composer-text"), "the cursor stays in the box").toBeFocused();
  await page.keyboard.press("Alt+t");
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true }), "Alt+T opens Thinking from the box").toBeVisible();
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
  await page.locator("#composer-text").focus();
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

test("switching tabs puts the cursor in the message box; Esc leaves it for the bar; Alt+N works from the box; arrowing along the tab bar keeps it on the bar", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  const box = page.locator("#composer-text");
  await page.getByRole("tab", { name: /Git/ }).click();
  await expect(box, "a tab switch puts the cursor in the message box").toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: /Git/ }), "Esc leaves it for the tab bar").toBeFocused();
  await page.keyboard.press("2");
  await expect(page, "where a bare digit jumps").toHaveURL(/#\/tasks/);
  await expect(box, "and the new page's switch puts the cursor back in the box").toBeFocused();
  await box.fill("half a thought");
  await page.keyboard.press("Alt+3");
  await expect(page, "Alt+N jumps from the message box").toHaveURL(/#\/plan/);
  await expect(box, "and leaves the cursor where it was").toBeFocused();
  await expect(box).toHaveValue("half a thought");
  await page.getByRole("tab", { name: /Plan/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Quick/ }), "arrows stay on the bar").toBeFocused();
  await expect(page).toHaveURL(/#\/quick/);
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await expect(box, "any route change, not only a tab").toBeFocused();
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
  await composer.focus();
  await page.keyboard.press("e");
  await expect(composer, "in the message box the letter is typed, not taken as a shortcut").toHaveValue("e");
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
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true })).toBeHidden();
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
  await composer.focus();
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
  // A route change puts the cursor in the message box; the page's keys work once the page has focus.
  await page.locator("#main").focus();
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

test("Thinking is a glowing orb in the colour of the agent thinking, with that agent's name beside it", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const orb = page.getByRole("button", { name: "Open Thinking" });
  await expect(orb).toHaveAttribute("data-thinking", "");
  const tones = { DEV: "--source-dev", QA: "--source-qa" } as const;
  // Dev and QA are both thinking, so they take turns: the name and the colour change together.
  const seen = new Map<string, string>();
  for (let tries = 0; tries < 30 && seen.size < 2; tries += 1) {
    const now = await orb.evaluate((el: any) => ({
      name: el.querySelector(".orb-label")?.textContent?.trim() ?? "",
      tone: el.style.getPropertyValue("--orb").trim(),
      glow: getComputedStyle(el.querySelector(".orb")).boxShadow,
    }));
    // Mid-swap both names are briefly in the tag; only a settled one counts.
    if (now.name === "Dev" || now.name === "QA") {
      seen.set(now.name, now.tone);
      expect(now.glow, "the orb glows").not.toBe("none");
    }
    await page.waitForTimeout(200);
  }
  expect([...seen.keys()].sort(), "each thinking agent has its turn on the orb").toEqual(["Dev", "QA"]);
  expect(seen.get("Dev")).toBe(`var(${tones.DEV})`);
  expect(seen.get("QA")).toBe(`var(${tones.QA})`);
});

test("the Thinking pane has no title bar; every agent has its own labelled bubble, and a thought reads as steps", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Open Thinking" }).click();
  const pane = page.getByRole("dialog", { name: "Thinking", exact: true });
  await expect(pane).toBeVisible();
  // Only the screen-reader name is left of a title.
  await expect(pane.locator(":is(header, h1, h2, h3):not(.sr-only)"), "no title bar or heading").toHaveCount(0);
  await expect(pane.getByRole("button", { name: /Minimize|Close/ }), "no minimize or close button").toHaveCount(0);
  await expect(pane.getByText(/Minimize|Esc/), "nor any hint text").toHaveCount(0);
  const bubbles = pane.getByRole("log", { name: "Latest thoughts" }).locator("> ul > li");
  const labels = await bubbles.locator(".thought-label").allTextContents();
  expect(labels.map((label) => label.trim()), "one bubble per agent, the ones thinking first, newest first").toEqual(["QA", "Dev", "Master", "Research"]);
  await expect(bubbles.first()).toHaveAttribute("data-live", "true");
  await expect(bubbles.first()).toContainText("thinking");
  // Research thought in two headed sections; Master's wall of text is broken into steps.
  const research = pane.getByRole("listitem", { name: "Research" });
  await expect(research.locator(".thought-steps > li")).toHaveCount(2);
  await expect(research.locator(".thought-steps > li").first()).toContainText("Surveying the fixture formats");
  await expect(research).toContainText("2 steps");
  const master = pane.getByRole("listitem", { name: "Master" });
  expect(await master.locator(".thought-steps > li").count(), "the long thought is split into steps").toBeGreaterThan(1);
  const tones = await bubbles.evaluateAll((els: any[]) => els.map((el) => el.style.getPropertyValue("--orb").trim()));
  expect(new Set(tones).size, "each agent's bubble is in its own colour").toBe(4);
  await page.keyboard.press("Escape");
  await expect(pane).toBeHidden();
});

test("buttons are slim and stand a little raised: a lit face, a rim and a soft shadow, sinking when pressed", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-1";
  });
  const archive = page.getByRole("toolbar", { name: "Actions" }).getByRole("button", { name: "Archive" });
  await expect(archive).toBeVisible();
  const look = await archive.evaluate((el: any) => {
    const style = getComputedStyle(el);
    return { height: el.getBoundingClientRect().height, image: style.backgroundImage, shadow: style.boxShadow, radius: style.borderTopLeftRadius };
  });
  expect(look.height, "slim: 30px, not 40").toBeLessThan(34);
  expect(look.image, "a face lit from above").toContain("linear-gradient");
  expect(look.shadow, "standing on a soft shadow").not.toBe("none");
  expect(look.shadow, "with a bright top edge").toContain("inset");
  expect(look.radius, "the corners are as they were").toBe("8px");
  await archive.hover();
  await page.mouse.down();
  await page.waitForTimeout(300);
  const pressed = await archive.evaluate((el: any) => getComputedStyle(el).boxShadow);
  // Let go elsewhere, so the press never becomes a click.
  await page.mouse.move(2, 2);
  await page.mouse.up();
  expect(pressed, "pressed, the shadow moves inside").not.toBe(look.shadow);
  await page.keyboard.press("Escape");
  const send = page.getByRole("button", { name: "Send" });
  expect((await send.boundingBox())!.height, "the send button stays compact").toBeLessThan(34);
  expect(await send.evaluate((el: any) => getComputedStyle(el).backgroundImage)).toContain("linear-gradient");
});

test("a task opens in its own session from the Tasks screen, with S: this window's goes to the Lobby, a background one moves here", async ({ page, server }) => {
  const switched: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/sessions.switch")) switched.push(request.postDataJSON());
  });
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-1";
  });
  const open = page.getByRole("toolbar", { name: "Actions" }).getByRole("button", { name: /Open in its session/ });
  await expect(open, "the action names what it does").toContainText("Open in session");
  await expect(open.locator('[data-slot="kbd"]'), "and prints its key").toHaveText("S");
  await expect(open).toHaveAttribute("aria-keyshortcuts", "S");
  await page.locator("#main").focus();
  await page.keyboard.press("s");
  await expect(page, "this window's own task is the Lobby").toHaveURL(/#\/lobby$/);
  expect(switched, "nothing is switched for it").toEqual([]);
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-2";
  });
  await expect(page.getByRole("toolbar", { name: "Actions" }).getByRole("button", { name: /Open in its session/ })).toBeVisible();
  await page.locator("#main").focus();
  await page.keyboard.press("s");
  await expect(page, "a background session's task moves it here and shows it").toHaveURL(/#\/lobby$/);
  expect(switched, "by moving that session into this window").toEqual([{ key: "S1" }]);
  await expect(page.getByText(/switching this window to Mock background task/)).toBeVisible();
});

test("Excalidraw is laid out in cards: an overview when nothing is chosen, then the link, the room and the agents", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/excalidraw";
  });
  const detail = page.locator('[data-pane="detail"]');
  await expect(detail.getByRole("heading", { name: "Sessions" }), "with nothing chosen, an overview").toBeVisible();
  await expect(detail, "how many of the five are in use").toContainText("1 of 5 in use");
  await expect(detail.getByRole("listitem").filter({ hasText: "Start a live room" }), "the steps").toBeVisible();
  await expect(detail.getByLabel("Add by link"), "and the add boxes").toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/excalidraw/x1";
  });
  const card = (title: string) => detail.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card("Room link")).toContainText("room abc123");
  await expect(card("Room")).toContainText("Agents may draw here.");
  await expect(card("Assigned to").getByRole("checkbox"), "every agent as a checkbox").toHaveCount(8);
  await expect(card("Add or rename").getByRole("textbox", { name: "Rename" })).toHaveValue("Mock board");
  const [link, agents] = await Promise.all([card("Room link").boundingBox(), card("Assigned to").boundingBox()]);
  expect(Math.abs(link!.y - agents!.y), "the link and the agents side by side").toBeLessThan(4);
});

test("the empty Excalidraw and Plan pages are laid out: steps beside the boxes, the panel as seats", async ({ page, server }) => {
  await openScenario(page, server, "empty");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/excalidraw";
  });
  const main = page.locator("#main");
  await expect(main.getByRole("heading", { name: "No sessions yet." })).toBeVisible();
  await expect(main.getByRole("list").first().getByRole("listitem"), "three steps").toHaveCount(3);
  const [steps, add] = await Promise.all([main.getByText("Start a live room").boundingBox(), main.getByLabel("Add by link").boundingBox()]);
  expect(add!.x, "the add boxes sit beside the steps").toBeGreaterThan(steps!.x + 300);
  await page.evaluate(() => {
    window.location.hash = "#/plan";
  });
  await expect(main.getByRole("heading", { name: "Plan with the panel" })).toBeVisible();
  const panel = main.getByRole("list", { name: "Panel" });
  await expect(panel.getByRole("listitem"), "the oracle and four seats").toHaveCount(5);
  await expect(panel.getByRole("checkbox"), "each seat a checkbox").toHaveCount(4);
  await expect(panel, "each seat says what it brings").toContainText("Tests, edge cases and what could break.");
  await expect(main, "and how a plan comes together").toContainText("How a plan comes together");
  await expect(main.getByRole("heading", { name: "Plan", exact: true }), "not a bare generic title").toHaveCount(0);
});

test("pointed at, the orb swells and shows the thinking agent's icon", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const orb = page.getByRole("button", { name: "Open Thinking" });
  const icon = orb.locator(".orb-icon");
  await expect.poll(() => icon.evaluate((el: any) => Number(getComputedStyle(el).opacity)), { message: "at rest the icon is hidden" }).toBeLessThan(0.1);
  await orb.hover();
  await expect.poll(() => icon.evaluate((el: any) => Number(getComputedStyle(el).opacity)), { message: "pointed at, it shows" }).toBeGreaterThan(0.9);
  await expect.poll(() => orb.locator(".orb-float").evaluate((el: any) => getComputedStyle(el).scale), { message: "and the orb swells" }).not.toBe("none");
  const shown = await orb.evaluate((el: any) => ({ agent: el.querySelector("[data-agent-icon]")?.getAttribute("data-agent-icon"), name: el.querySelector(".orb-label")?.textContent?.trim() }));
  expect(["DEV", "QA"], "the icon is a thinking agent's").toContain(shown.agent);
});

test("the orb can be dragged anywhere on the Lobby, stays there, and moves with the arrow keys", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const orb = page.getByRole("button", { name: "Open Thinking" });
  const start = (await orb.boundingBox())!;
  await page.mouse.move(start.x + 22, start.y + 22);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 8 });
  await page.mouse.move(300, 250, { steps: 8 });
  await page.mouse.up();
  const dropped = (await orb.boundingBox())!;
  expect(Math.abs(dropped.x + 22 - 300) + Math.abs(dropped.y + 22 - 250), "it lands where it was let go").toBeLessThan(4);
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true }), "a drag does not open Thinking").toHaveCount(0);
  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  const kept = (await orb.boundingBox())!;
  expect(Math.abs(kept.x - dropped.x) + Math.abs(kept.y - dropped.y), "it stays put across a reload").toBeLessThan(3);
  await orb.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const nudged = (await orb.boundingBox())!;
  // Its place is kept as a share of the card, so a card that settles a few pixels moves it a little too.
  expect(Math.abs(nudged.x - kept.x - 16), "Right nudges it").toBeLessThan(6);
  expect(Math.abs(nudged.y - kept.y - 64), "Shift+Down takes a bigger step").toBeLessThan(8);
  // It never leaves the card, however far it is pushed.
  for (let i = 0; i < 40; i += 1) await page.keyboard.press("Shift+ArrowLeft");
  const card = (await page.locator("#main").boundingBox())!;
  expect((await orb.boundingBox())!.x, "the card's left edge holds it").toBeGreaterThanOrEqual(card.x);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true }), "Enter still opens it").toBeVisible();
});

test("tabs are slim and a confirmation's buttons are small, with a crisp focus line and no glow", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await page.getByRole("tab").first().boundingBox())!.height, "a slim tab").toBeLessThanOrEqual(30);
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-1";
  });
  await expect(page.getByRole("toolbar", { name: "Actions" })).toBeVisible();
  await page.locator("#main").focus();
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  for (const name of [/Keep it/, /^Delete/]) {
    const button = dialog.getByRole("button", { name });
    expect((await button.boundingBox())!.height, "a small button").toBeLessThanOrEqual(28);
  }
  const focus = await page.evaluate(() => {
    const el = document.activeElement as any;
    const style = getComputedStyle(el);
    return { outline: style.outlineStyle, shadow: style.boxShadow };
  });
  expect(focus.outline, "focus shows as a line").toBe("solid");
  expect(focus.shadow, "with no ring of glow").not.toMatch(/0px 0px 0px 3px/);
  await page.keyboard.press("Escape");
});

test("the chats read alike: avatars beside agents, your words in bubbles, notes as rules, the panel's questions as cards", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const chat = page.locator('[role="log"][aria-label="Conversation"]');
  await expect(chat.locator(".chat-avatar").first(), "the oracle has an avatar").toBeVisible();
  await expect(chat.locator('[data-agent-icon="ORACLE"]').first(), "with the oracle's icon").toBeAttached();
  await expect(chat.locator(".chat-bubble").first(), "your words in a bubble").toBeVisible();
  await expect(chat.getByRole("note").filter({ hasText: "task started" }), "a note across the column").toBeVisible();
  const column = (await chat.locator(".chat-column").boundingBox())!;
  expect(column.width, "a readable line, not the whole pane").toBeLessThanOrEqual(46 * 15 + 1);
  await page.evaluate(() => {
    window.location.hash = "#/plan";
  });
  const panel = page.getByRole("log", { name: "Panel conversation" });
  await expect(panel.locator(".chat-bubble"), "your request in a bubble").toContainText("Plan dark mode for the lobby");
  const cards = panel.locator("ol > li");
  await expect(cards, "each question its own card").toHaveCount(2);
  await expect(cards.first(), "naming who asks").toContainText("Design");
  await expect(cards.first().locator('[data-agent-icon="DESIGN"]')).toBeAttached();
  await expect(cards.first().getByRole("list", { name: "Options" }).getByRole("listitem"), "with its options").toHaveCount(2);
  await expect(panel, "and what the classifier settled").toContainText("decided by the classifier");
});

test("the bar is one row when the project, the tabs and the tools fit, and puts the tabs on a second row when they do not", async ({ page, server }) => {
  await openScenario(page, server, "full");
  const rows = async () => {
    await page.waitForTimeout(150);
    const [tabs, tools] = await Promise.all([page.getByRole("tablist").boundingBox(), page.locator(".app-header .tools").boundingBox()]);
    return Math.abs(tabs!.y + tabs!.height / 2 - (tools!.y + tools!.height / 2)) < 6 ? 1 : 2;
  };
  await page.setViewportSize({ width: 1600, height: 900 });
  expect(await rows(), "wide: one row").toBe(1);
  await page.setViewportSize({ width: 1100, height: 900 });
  expect(await rows(), "narrower: the tabs drop to their own row").toBe(2);
  const scroller = page.getByRole("tablist").locator("..");
  expect(await scroller.evaluate((el: any) => el.scrollWidth <= el.clientWidth + 1), "and show in full").toBe(true);
  await page.setViewportSize({ width: 1600, height: 900 });
  expect(await rows(), "and come back up when there is room again").toBe(1);
});

test("the oracle is a crystal ball and speaks in a bubble of its own, the mirror of yours", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  const chat = page.locator('[role="log"][aria-label="Conversation"]');
  const ball = chat.locator(".chat-avatar .agent-oracle").first();
  await expect(ball, "the oracle's own picture").toBeVisible();
  expect(await ball.evaluate((el: any) => getComputedStyle(el).backgroundImage), "a drawn crystal ball").toMatch(/oracle.*\.png/);
  const said = chat.locator(".chat-bubble-agent").filter({ hasText: "Done: ten sets" });
  await expect(said, "the oracle's words sit in a bubble").toBeVisible();
  const look = await said.evaluate((el: any) => {
    const style = getComputedStyle(el);
    return { border: style.borderTopWidth, background: style.backgroundColor, card: getComputedStyle(el.closest("#main")).backgroundColor };
  });
  expect(look.border, "with an edge").not.toBe("0px");
  expect(look.background, "tinted apart from the page").not.toBe(look.card);
  const [mine, theirs] = await Promise.all([chat.locator(".chat-bubble").first().boundingBox(), said.boundingBox()]);
  expect(theirs!.x, "on the left, yours on the right").toBeLessThan(mine!.x);
});

test("the orb is on every page, and opens Thinking from any of them", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const hash of ["#/tasks", "#/plan", "#/settings", "#/sessions"]) {
    await page.evaluate((to) => {
      window.location.hash = to;
    }, hash);
    await expect(page.getByRole("button", { name: "Open Thinking" }), `${hash}: the orb is there`).toBeVisible();
  }
  await page.getByRole("button", { name: "Open Thinking" }).click();
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true }), "it opens Thinking without leaving the page").toBeVisible();
  await expect(page).toHaveURL(/#\/sessions$/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+T");
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true }), "and so does its key").toBeVisible();
});

test("with agents at work and no thought to show, the orb breathes with the brain on it and names who is busy", async ({ page, server }) => {
  await openScenario(page, server, "loading");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/tasks";
  });
  const orb = page.getByRole("button", { name: "Open Thinking" });
  await expect(orb).toHaveAttribute("data-busy", "");
  await expect(orb.locator('[data-agent-icon="thinking"]'), "the brain").toBeAttached();
  await expect.poll(() => orb.locator(".orb-icon").evaluate((el: any) => Number(getComputedStyle(el).opacity)), { message: "shown without pointing at it" }).toBeGreaterThan(0.9);
  expect(await orb.locator(".orb-float").evaluate((el: any) => getComputedStyle(el).animationName), "breathing").toContain("orb-breathe");
  await expect(orb.locator(".orb-label"), "naming who is at work").toContainText("Oracle");
});

test("the Thinking pane's edge pulses in the working agent's colour while anyone thinks or works, and rests when nobody does", async ({ page, server }) => {
  for (const [scenario, working] of [["loading", "busy"], ["full", "thinking"]] as const) {
    await openScenario(page, server, scenario);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.getByRole("button", { name: "Open Thinking" }).click();
    const pane = page.locator(".thought-pane");
    await expect(pane, `${scenario}: lit`).toHaveClass(/thought-pane-live/);
    expect(await pane.evaluate((el: any) => getComputedStyle(el).animationName), `${scenario}: the glow breathes`).toBe("pane-glow");
    expect(await pane.evaluate((el: any) => getComputedStyle(el, "::after").animationName), `${scenario}: the ring pulses`).toBe("pane-ring");
    await expect(pane.locator(".thought-aura")).toHaveAttribute("data-working", working);
    await page.keyboard.press("Escape");
  }
  await openScenario(page, server, "issues");
  await page.getByRole("button", { name: "Open Thinking" }).click();
  await expect(page.locator(".thought-pane"), "a thought trail, nobody at work: still").not.toHaveClass(/thought-pane-live/);
});

test("with no thoughts and nobody at work there is no orb; the Thinking key still opens the pane", async ({ page, server }) => {
  await openScenario(page, server, "empty");
  await page.setViewportSize({ width: 1280, height: 860 });
  await expect(page.locator("#main")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Thinking" }), "nothing to show: no orb").toHaveCount(0);
  await page.locator("#main").focus();
  await page.keyboard.press("Alt+T");
  await expect(page.getByRole("dialog", { name: "Thinking", exact: true })).toBeVisible();
  await expect(page.getByText("Thoughts from the oracle and every agent appear here")).toBeVisible();
  await page.keyboard.press("Escape");
  await openScenario(page, server, "issues");
  await expect(page.getByRole("button", { name: "Open Thinking" }), "a thought trail: the orb is there").toBeVisible();
  await openScenario(page, server, "loading");
  await expect(page.getByRole("button", { name: "Open Thinking" }), "agents at work: the orb is there").toBeVisible();
});

test("Linting in Settings: the gate's mode, a command of your own with its file types, and the linters the project configures", async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Linting", exact: true }).click();
  const found = page.getByRole("list", { name: "Found in this project" });
  await expect(found.getByRole("listitem")).toHaveCount(2);
  await expect(found.getByRole("listitem").first()).toContainText("ESLint");
  await expect(found.getByRole("listitem").first()).toContainText("installed");
  await expect(found.getByRole("listitem").nth(1), "a linter it cannot run says so").toContainText("Ruffservices/api/not installed");
  const mode = page.getByRole("combobox", { name: "Lint gate" });
  await expect(mode).toContainText("advise");
  await mode.click();
  await page.getByRole("option", { name: /^block/ }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  await expect(mode).toContainText("block");
  await expect(page.getByText(/new lint errors also hold a task's completion/), "the mode says what it does").toBeVisible();
  await expect(page.getByRole("textbox", { name: "File types" }), "file types only matter for a command").toHaveCount(0);
  const command = page.getByRole("textbox", { name: "Command" });
  await command.fill("ruff check {files}");
  await command.press("Enter");
  const types = page.getByRole("textbox", { name: "File types" });
  await expect(types).toBeVisible();
  await types.fill(".py, pyi");
  await types.press("Enter");
  await expect(types, "kept as extensions").toHaveValue(".py .pyi");
  await expect(page.getByText("The command replaces these.")).toBeVisible();
  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Linting", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Lint gate" }), "round-trips").toContainText("block");
  await expect(page.getByRole("textbox", { name: "Command" })).toHaveValue("ruff check {files}");
  expect(trap.errors, "no console errors").toEqual([]);
  trap.stop();
});

test("a question's mockups expand into a viewer the user scrolls through, chooses from, and leaves with Esc", async ({ page, server }) => {
  await openScenario(page, server, "mockups");
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialog = page.getByRole("dialog", { name: "Question from the lobby" });
  await expect(dialog).toBeVisible();
  const thumb = dialog.getByRole("button", { name: "Expand the mockup: Sidebar nav" });
  await expect(thumb, "the preview is a thumbnail that opens the viewer").toBeVisible();
  const frame = dialog.locator('iframe[title="Static mockup: Sidebar nav"]');
  expect(await frame.evaluate((el: any) => parseFloat(el.style.width)), "laid out as a desktop page, then scaled").toBe(1200);
  const before = (await dialog.boundingBox())!.width;
  await page.keyboard.press("e");
  const viewer = dialog.getByRole("region", { name: "Mockups: Layout" });
  await expect(viewer, "E expands it").toBeVisible();
  expect((await dialog.boundingBox())!.width, "the pop-up widens for it").toBeGreaterThan(before + 200);
  const pills = viewer.getByRole("tablist", { name: "Options" }).getByRole("tab");
  await expect(pills).toHaveCount(3);
  await expect(pills.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(pills.nth(1), "arrows step through the options").toHaveAttribute("aria-selected", "true");
  await expect(viewer.getByText("2 of 3")).toBeVisible();
  // Scrolling the track sideways (a swipe, a trackpad) moves to the option in view.
  await viewer.locator(".mockup-track").evaluate((el: any) => el.scrollTo({ left: el.clientWidth * 2, behavior: "auto" }));
  await expect(pills.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("1");
  await expect(pills.first(), "a digit jumps").toHaveAttribute("aria-selected", "true");
  await pills.nth(1).click();
  await expect(viewer.getByRole("tabpanel", { name: "2 of 3: Top bar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer, "Esc goes back to the question").toBeHidden();
  await expect(dialog, "and keeps it open").toBeVisible();
  await dialog.getByRole("button", { name: "Expand", exact: true }).click();
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: /^Choose\s*Top bar$/ }).click();
  await expect(viewer).toBeHidden();
  await expect(dialog.locator('input[data-option="1"]'), "chosen from the viewer").toBeChecked();
  await expect(dialog.locator('input[data-option="1"]'), "with focus on it").toBeFocused();
  // The Markdown sketches of the next question expand too.
  await dialog.getByRole("button", { name: /Density/ }).click();
  await dialog.getByRole("button", { name: "Expand", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Mockups: Density" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog, "a second Esc puts the question away").toBeHidden();
});

test("the panel's mockups show as thumbnails on its questions in the Plan tab and open the same viewer", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/plan";
  });
  const thumbs = page.getByRole("list", { name: "Mockups" });
  await expect(thumbs.getByRole("listitem")).toHaveCount(2);
  await thumbs.getByRole("button", { name: "Expand the mockup: Settings" }).click();
  const viewer = page.getByRole("region", { name: /^Mockups: Should the toggle live/ });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("tab", { name: /Settings/ }), "opened on the one clicked").toHaveAttribute("aria-selected", "true");
  await expect(viewer.getByRole("button", { name: /^Choose/ }), "answered in the questionnaire, not here").toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("tab", { name: /Header/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});

test("a task's short steps come first, the one being worked on marked active with its time ticking, the plan's detail folded under them, and how long the agents worked", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.location.hash = "#/tasks/T-mock-1";
  });
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps.getByRole("listitem").nth(0), "done").toHaveAttribute("data-step", "done");
  const active = steps.getByRole("listitem").nth(1);
  await expect(active, "the step a worker is on").toHaveAttribute("data-step", "active");
  await expect(active).toContainText(/Check the mock over HTTP\s*active · 1m 3\ds/);
  await expect(steps.getByRole("listitem").nth(2)).toHaveAttribute("data-step", "open");
  const article = page.getByRole("article", { name: "Add offline mock fixtures" });
  const worked = article.locator("[data-work-clock]");
  await expect(worked, "the agents' time, idle left out").toHaveText(/^worked 12m 3\ds$/);
  await expect(worked).toHaveAttribute("data-work-clock", "running");
  const [stepTime, workTime] = [await active.textContent(), await worked.textContent()];
  await page.waitForTimeout(2300);
  expect(await active.textContent(), "the step's time ticks").not.toBe(stepTime);
  expect(await worked.textContent(), "and so does the task's").not.toBe(workTime);
  const [stepsBox, requestBox] = await Promise.all([steps.boundingBox(), article.getByText("Give the page an offline mock").boundingBox()]);
  expect(stepsBox!.y, "the steps come before everything else").toBeLessThan(requestBox!.y);
  // The detail of each step is there for whoever wants it, folded away until asked for.
  const more = article.getByRole("button", { name: "Read the details of each step" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(article.getByText(/Serve each scenario from/)).toHaveCount(0);
  await more.click();
  await expect(article.getByRole("button", { name: "Hide the details" })).toHaveAttribute("aria-expanded", "true");
  await expect(article.getByText(/Serve each scenario from/)).toBeVisible();
  await expect(article.getByRole("heading", { name: "Step 2: Check the mock over HTTP" })).toBeVisible();
  // The list row and the Lobby's header say the same.
  await expect(page.getByRole("button", { name: /Add offline mock fixtures/ }).first()).toContainText(/worked 12m/);
  await page.evaluate(() => {
    window.location.hash = "#/lobby";
  });
  const header = page.getByRole("group", { name: "Task" });
  await expect(header).toContainText(/worked 12m \d+s/);
  await expect(header).toContainText(/Check the mock over HTTP\s*active · 1m \d+s/);
});
