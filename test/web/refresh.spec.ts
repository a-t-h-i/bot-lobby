import { expect, openScenario, test, type Page } from "./fixture.ts";

declare const document: any;
declare const window: any;
declare const getComputedStyle: any;

let releasePending: (() => void) | undefined;
test.afterEach(() => { releasePending?.(); releasePending = undefined; });

const SECTIONS = ["Agents", "Workflow", "Lobby", "Classifier", "Appearance & notifications"];
const PAGES = ["lobby", "tasks", "plan", "quickfix", "issues", "metrics", "git", "knowledge", "excalidraw", "sessions", "settings"];

async function route(page: Page, name: string): Promise<void> {
  await page.evaluate((hash) => { window.location.hash = hash; }, `#/${name}`);
  await expect(page).toHaveURL(new RegExp(`#/${name}$`));
  if (name === "settings") await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  else if (name === "sessions") await expect(page.locator("#main").getByText("Sessions", { exact: true }).first()).toBeVisible();
  else await expect(page.getByRole("tab", { name: new RegExp(name === "quickfix" ? "Quick" : name, "i") })).toHaveAttribute("aria-selected", "true");
}

async function section(page: Page, name: string): Promise<void> {
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name, exact: true }).click();
}

for (const name of PAGES) {
  test(`refresh ${name}: reachable, grouped, no sideways scroll and keyboard focus`, async ({ page, server }, info) => {
    await openScenario(page, server, "issues");
    await route(page, name);
    await expect(page.locator("#main")).toBeVisible();
    await expect(page.locator("#main")).not.toBeEmpty();
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} document fits viewport`).toBeLessThanOrEqual(1);
    await expect(page.locator("select"), "native dropdowns removed").toHaveCount(0);
    await page.getByRole("banner").getByRole("button", { name: "Keyboard shortcuts", exact: true }).focus();
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({ visible: document.activeElement.matches(":focus-visible"), width: document.activeElement.getBoundingClientRect().width }));
    expect(focus.visible, "keyboard focus is visible").toBe(true);
    expect(focus.width, "focused control is reachable").toBeGreaterThan(0);
  });
}

test("toolbar touch targets, context, keyboard hint activation and modal guard", async ({ page, server }) => {
  await openScenario(page, server, "full");
  const header = page.locator("header").first();
  await expect(header.getByRole("combobox", { name: "Project", exact: true })).toBeVisible();
  await expect(header.getByLabel("Connected", { exact: true })).toBeVisible();
  const controls = header.locator("button:visible, a:visible");
  const heights = await controls.evaluateAll((els) => els.map((el: any) => ({ name: el.textContent || el.getAttribute("aria-label"), height: el.getBoundingClientRect().height })));
  for (const control of heights) expect(control.height, `toolbar ${control.name} target >=40px`).toBeGreaterThanOrEqual(40);
  await header.getByRole("button", { name: "Keyboard shortcuts", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Keys", exact: true })).toBeVisible();
  await page.keyboard.press("Alt+2");
  // The open dialog hides the page from assistive technology, so the tab is looked up with `includeHidden`.
  await expect(page.getByRole("tab", { name: /Lobby/, includeHidden: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keys", exact: true })).toBeHidden();
  await page.locator("#composer-text").focus();
  await page.keyboard.press("Alt+2");
  await expect(page.getByRole("tab", { name: /Tasks/ }), "with no dialog open, Alt+N works from the message box").toHaveAttribute("aria-selected", "true");
});

test("Thinking defaults to a 44px minimized bubble and modal returns focus", async ({ page, server }, info) => {
  await openScenario(page, server, "full");
  const bubble = page.getByRole("button", { name: "Open Thinking", exact: true });
  await expect(bubble).toHaveAttribute("aria-expanded", "false");
  expect((await bubble.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#main [aria-label="Thinking"]')).toHaveCount(0);
  await bubble.focus();
  await bubble.press("Enter");
  const modal = page.getByRole("dialog", { name: "Thinking", exact: true });
  await expect(modal.getByRole("log", { name: "Latest thoughts" })).not.toBeEmpty();
  await page.screenshot({ path: info.outputPath("thinking-modal.png"), fullPage: true });
  await modal.getByRole("button", { name: /Minimize/ }).click();
  await expect(bubble).toBeFocused();
  await bubble.click();
  await page.keyboard.press("Escape");
  await expect(bubble).toBeFocused();
});

test("Thinking hover motion respects reduced motion and disabled panel hides bubble", async ({ page, server }) => {
  await openScenario(page, server, "full");
  const bubble = page.getByRole("button", { name: "Open Thinking", exact: true });
  await bubble.hover();
  await expect.poll(() => bubble.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => bubble.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await route(page, "settings");
  await section(page, "Lobby");
  await page.getByRole("switch", { name: "Thinking bubble", exact: true }).click();
  await route(page, "lobby");
  await expect(bubble).toHaveCount(0);
});

test("five Settings sections preserve custom model draft without fallback controls", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await route(page, "settings");
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("button")).toHaveText(SECTIONS);
  await page.getByRole("combobox", { name: "Master model", exact: true }).click();
  await page.getByRole("option", { name: /custom/i }).click();
  const draft = page.getByRole("textbox", { name: "Model id", exact: true });
  await draft.fill("provider/unsaved-draft");
  for (const name of SECTIONS.slice(1)) await section(page, name);
  await expect(page.getByRole("button", { name: "Install as fullscreen app" })).toBeVisible();
  await section(page, "Agents");
  await expect(draft).toHaveValue("provider/unsaved-draft");
  await expect(page.locator('[aria-label*="fallback" i]')).toHaveCount(0);
});

test("Settings pending save and server error survive section navigation", async ({ page, server }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; releasePending = resolve; });
  await page.route((url) => url.pathname === "/api/settings.set", async (request) => {
    await gate;
    await request.fulfill({ status: 400, json: { ok: false, code: "bad_request", error: "Fixture refuses this save" } });
  });
  await openScenario(page, server, "full");
  await route(page, "settings");
  await section(page, "Lobby");
  const toggle = page.getByRole("switch", { name: "Issues tab", exact: true });
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await section(page, "Workflow");
  await section(page, "Lobby");
  await expect(toggle).toHaveAttribute("aria-checked", before!);
  release();
  await expect(page.getByText("Fixture refuses this save", { exact: true })).toBeVisible();
  await section(page, "Agents");
  await section(page, "Lobby");
  await expect(toggle).toHaveAttribute("aria-checked", before!);
});

test("project loading, empty, failure and refresh recovery use accessible Combobox", async ({ page, server }) => {
  let mode = "empty";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; releasePending = resolve; });
  await page.route((url) => url.pathname === "/api/projects.list", async (request) => {
    if (mode === "empty") await gate;
    const result = { projects: mode === "ready" ? [{ id: "fixture", name: "Fixture project", cwd: "/fixture", port: 7347 }] : [], currentId: "fixture" };
    await request.fulfill({ json: mode === "failure" ? { ok: false, code: "failed", error: "Fixture project lookup failed" } : { ok: true, result } });
  });
  await openScenario(page, server, "full");
  const project = page.getByRole("combobox", { name: "Project", exact: true });
  await expect(project).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh projects" })).toBeDisabled();
  release();
  await expect(page.getByText("No authorized running projects found. Start a project in Pi, then refresh.")).toBeVisible();
  mode = "failure";
  await page.getByRole("button", { name: "Refresh projects" }).click();
  await expect(page.getByText("Fixture project lookup failed")).toBeVisible();
  mode = "ready";
  await page.getByRole("button", { name: "Refresh projects" }).click();
  await expect(project).toBeEnabled();
  await project.focus();
  await project.press("ArrowDown");
  await expect(page.getByRole("option", { name: /Fixture project/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(project).toBeFocused();
});
