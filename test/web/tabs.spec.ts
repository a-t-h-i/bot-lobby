/**
 * Browser checks: every remaining tab route against the
 * fixture-backed mock server (`?scenario=full` at 1280x800, light plus dark
 * via the two config projects), plus each tab's empty state against
 * `?scenario=empty`. Every route must render its real content (never a
 * placeholder), never scroll sideways, and stay free of console errors and
 * CSP violations. One server per spec (the shared worker fixture), one size.
 */
import { expect, openScenario, test, type Page } from "./fixture.ts";

/** DOM ambient for `page.evaluate` callbacks (the root tsconfig has no DOM lib). */
declare const document: any;
declare const window: any;
declare const getComputedStyle: any;

interface RouteCheck {
  route: string;
  /** Real content the `full` scenario must show (never a placeholder). */
  full: string[];
  /** Empty-state wording the `empty` scenario must show. */
  empty: string;
  /**
   * The route intentionally fires a request that 404s in the `empty`
   * scenario (`#/git/42` pulls a fixture PR that does not exist there),
   * so the empty-state check tolerates exactly the one resource-load line
   * and nothing else.
   */
  allow404?: boolean;
}

const ROUTES: RouteCheck[] = [
  {
    route: "#/tasks",
    full: ["Add offline mock fixtures"],
    empty: "No tasks yet. Start one from the Lobby tab, or plan one in the Plan tab.",
  },
  {
    route: "#/tasks/T-mock-1",
    full: ["Add offline mock fixtures", "implementing"],
    empty: "No tasks yet. Start one from the Lobby tab, or plan one in the Plan tab.",
  },
  {
    route: "#/plan",
    full: ["Plan dark mode for the lobby", "View plan"],
    empty: "Plan with the panel",
  },
  {
    route: "#/quickfix",
    full: ["Fix the typo in the header"],
    empty: "Describe a small change",
  },
  {
    route: "#/metrics",
    full: ["mock-model"],
    empty: "No runs recorded yet.",
  },
  {
    route: "#/git",
    full: ["Add the dark mode toggle"],
    empty: "No open pull requests.",
  },
  {
    route: "#/git/42",
    full: ["Add the dark mode toggle", "nothing is posted to GitHub"],
    // No fixture pull 42 in `empty`: the detail honestly reports the miss.
    empty: "Could not resolve to a PullRequest",
    allow404: true,
  },
  {
    route: "#/knowledge/master/knowledge.md",
    full: ["Mock what the offline page needs."],
    empty: "No knowledge files yet.",
  },
  {
    route: "#/git/issues",
    full: ["issues are off (lobby.issues)"],
    empty: "issues are off (lobby.issues)",
  },
];

test("knowledge questions stay on the Knowledge tab and use the dedicated endpoint", async ({ page, server }) => {
  const trap = await openScenario(page, server, "empty");
  await page.getByRole("tab", { name: /Knowledge/ }).click();
  await expect(page.getByRole("button", { name: "Ask about the project" })).toHaveCount(0);
  const toggle = page.locator(".group\\/composer").getByRole("group", { name: "Knowledge pane" });
  await toggle.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator('[data-pane="detail"]')).toContainText("searches the codebase for missing information");
  const question = "Where is authentication checked?";
  await page.getByRole("textbox", { name: "Ask the oracle about this project" }).fill(question);
  const request = page.waitForRequest((req) => req.url().endsWith("/api/knowledge.ask"));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ text: question });
  await expect(page).toHaveURL(/#\/knowledge\/ask$/);
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText(question);
  await expect(page.getByRole("textbox", { name: "Ask the oracle about this project" })).toHaveValue("");
  await toggle.getByRole("button", { name: "Docs", exact: true }).click();
  await expect(page.locator("#main")).toContainText("No knowledge files yet.");
  expect(trap.errors).toEqual([]);
  trap.stop();
});

function cspErrors(errors: string[]): string[] {
  return errors.filter((text) => /content[ -]security|refus/i.test(text));
}

/** The page must never scroll sideways at desktop/tablet widths. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, "no sideways scroll").toBeLessThanOrEqual(1);
}

/** Move the hash route and wait for the tab body to settle on `text`. */
async function gotoRoute(page: Page, hash: string, text: string): Promise<void> {
  await page.evaluate((to: string) => {
    window.location.hash = to;
  }, hash);
  await expect(page.locator("#main"), `body for ${hash}`).toContainText(text);
}

for (const check of ROUTES) {
  test(`tab route ${check.route} renders (full) @theme`, async ({ page, server }) => {
    const trap = await openScenario(page, server, "full");
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const text of check.full) {
      await gotoRoute(page, check.route, text);
    }
    await expectNoSidewaysScroll(page);
    expect(cspErrors(trap.errors), "no CSP violations").toEqual([]);
    expect(trap.errors, "no console errors").toEqual([]);
    trap.stop();
  });

  test(`tab route ${check.route} has an empty state (empty) @theme`, async ({ page, server }) => {
    const trap = await openScenario(page, server, "empty");
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoRoute(page, check.route, check.empty);
    await expectNoSidewaysScroll(page);
    expect(cspErrors(trap.errors), "no CSP violations").toEqual([]);
    const rest = check.allow404
      ? trap.errors.filter(
          (text) => text !== "Failed to load resource: the server responded with a status of 404 (Not Found)",
        )
      : trap.errors;
    expect(rest, "no console errors").toEqual([]);
    trap.stop();
  });
}

test("Git issues lists issues @theme", async ({ page, server }) => {
  const trap = await openScenario(page, server, "issues");
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoRoute(page, "#/git/issues", "Dark mode flashes white on load");
  await expectNoSidewaysScroll(page);
  expect(cspErrors(trap.errors), "no CSP violations").toEqual([]);
  expect(trap.errors, "no console errors").toEqual([]);
  trap.stop();
});

test("Plan it starts a planning session from an issue (issues)", async ({ page, server }) => {
  await openScenario(page, server, "issues");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { (globalThis as any).location.hash = "#/git/issues/57"; });
  const detail = page.getByRole("article", { name: "Issue #57" });
  await detail.getByRole("button", { name: "Plan #57 with the panel" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Plan it" }).click();
  await expect(page, "the Plan tab opens on it").toHaveURL(/#\/plan$/);
  await expect(page.getByText("The page paints white for a moment before the theme applies.").first()).toBeVisible();
});

test("Git issues is off without lobby.issues @theme", async ({ page, server }) => {
  const trap = await openScenario(page, server, "empty");
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoRoute(page, "#/git/issues", "issues are off (lobby.issues)");
  await expectNoSidewaysScroll(page);
  expect(cspErrors(trap.errors), "no CSP violations").toEqual([]);
  expect(trap.errors, "no console errors").toEqual([]);
  trap.stop();
});

test("settings change saves with a notice and round-trips", async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoRoute(page, "#/settings", "Each agent's model and effort");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Lobby", exact: true }).click();
  const mouse = page.getByRole("switch", { name: "Issues", exact: true });
  await expect(mouse, "Issues toggle").toBeVisible();
  const before = await mouse.getAttribute("aria-checked");
  await mouse.click();
  await expect(page.getByText("Settings saved"), "saved notice").toBeVisible();
  const after = await mouse.getAttribute("aria-checked");
  expect(after, "toggle flips").not.toBe(before);
  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await gotoRoute(page, "#/settings", "Each agent's model and effort");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Lobby", exact: true }).click();
  expect(await page.getByRole("switch", { name: "Issues", exact: true }).getAttribute("aria-checked"), "value round-trips").toBe(after);
  await expectNoSidewaysScroll(page);
  expect(cspErrors(trap.errors), "no CSP violations").toEqual([]);
  expect(trap.errors, "no console errors").toEqual([]);
  trap.stop();
});


test("removed routes resolve to Lobby @theme", async ({ page, server }) => {
  const trap = await openScenario(page, server, "full");
  for (const hash of ["#/sessions", "#/sessions/S1", "#/excalidraw", "#/excalidraw/x1"]) {
    await page.evaluate((to) => { window.location.hash = to; }, hash);
    await expect(page).toHaveURL(/#\/lobby$/);
    await expect(page.locator("#composer-text")).toBeVisible();
  }
  expect(trap.errors).toEqual([]);
});

test("hidden composer retains drafts and rejects focus shortcuts @theme", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.locator("#composer-text").fill("Keep my draft");
  for (const hash of ["#/git", "#/metrics", "#/settings"]) {
    await page.evaluate((to) => { window.location.hash = to; }, hash);
    await expect(page.locator("#app-dock")).toBeHidden();
    await expect(page.locator("#composer-text")).toBeAttached();
    await page.keyboard.press("/");
    await expect(page.locator("#composer-text")).not.toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--composer-h").trim())).toBe("0px");
  }
  await page.evaluate(() => { window.location.hash = "#/lobby"; });
  await expect(page.locator("#composer-text")).toHaveValue("Keep my draft");
});

test("Git switch routes keyboard selection and legacy bookmarks @theme", async ({ page, server }) => {
  await openScenario(page, server, "issues");
  await page.evaluate(() => { window.location.hash = "#/issues/42"; });
  await expect(page).toHaveURL(/#\/git\/issues\/42$/);
  const issues = page.getByRole("radio", { name: "Issues", exact: true });
  await issues.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/#\/git$/);
  await expect(page.getByRole("radio", { name: "Pull requests", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#\/git\/issues$/);
  expect((await issues.boundingBox())!.height, "a compact segment on a desktop (44px on a phone)").toBeGreaterThanOrEqual(24);
});
