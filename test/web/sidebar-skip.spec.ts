/**
 * Browser checks for the collapsible sidebar (its session rows and groups,
 * search, folding off the page and back by button and key, resizing by its
 * edge, New session, switching to a session, all remembered across a reload)
 * and for skipping a plan step with a required reason, against the `full`
 * fixture set.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, openScenario, test } from "./fixture.ts";

test("the sidebar lists the sessions as thin rows under labels, searches them, folds off the page and back by button and key, and remembers it @theme", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const header = page.getByRole("banner");
  const list = sidebar.getByRole("navigation", { name: "Sessions list" });
  const here = list.getByRole("button", { name: "mock lobby, this window" });
  await expect(sidebar.locator('[data-slot="sidebar-title"]'), "the title is the open project's name, not the app's").toHaveText("bot-lobby");
  await expect(here, "this window first, marked current").toHaveAttribute("aria-current", "true");
  await expect(here, "the session's name stays").toContainText("mock lobby");
  await expect(here, "no duplicate location label on the current row").not.toContainText("This window");
  await expect(here).toContainText(/Idle|Working|Waiting/);
  await expect(sidebar.locator(".session-dot"), "no online dots on the rows").toHaveCount(0);
  await expect(list.getByRole("button", { name: "Switch to Mock background task" })).toContainText("1 question");
  const shelf = list.getByRole("region", { name: "Other terminals" });
  await expect(shelf.getByRole("button", { name: "Other window, in another terminal" }), "other terminals sit on their own shelf").toBeVisible();
  await shelf.getByRole("button", { name: /^Other terminals/ }).click();
  await expect(shelf.getByRole("button", { name: "Other window, in another terminal" }), "the shelf folds").toHaveCount(0);
  await expect(shelf, "and shows its count").toContainText("1");
  await shelf.getByRole("button", { name: /^Other terminals/ }).click();

  const search = sidebar.getByRole("searchbox", { name: "Search sessions" });
  await search.fill("background");
  await expect(list.getByRole("button", { name: "Switch to Mock background task" })).toBeVisible();
  await expect(here, "search keeps only what matches").toHaveCount(0);
  await search.fill("nothing like it");
  await expect(list).toContainText("No sessions match");
  await search.press("Escape");
  await expect(here, "Esc clears the search").toBeVisible();

  const width = async () => (await sidebar.boundingBox())?.width ?? 0;
  await expect.poll(width).toBeGreaterThan(200);
  await expect(header.getByRole("button", { name: "Expand sidebar" }), "no open button while it is open").toHaveCount(0);
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(width, "folded off the page").toBeLessThan(2);
  await expect(header.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await expect.poll(width, "still folded after a reload").toBeLessThan(2);

  await page.keyboard.press("Alt+b");
  await expect.poll(width, "the sidebar key brings it back").toBeGreaterThan(200);
  const results = await new AxeBuilder({ page: page as any }).include("#app-sidebar").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.keyboard.press("Alt+b");
  await expect.poll(width, "and folds it again").toBeLessThan(2);
  await header.getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(width, "the bar's button brings it back").toBeGreaterThan(200);
});

test("the sidebar's edge resizes it, remembers the width, resets on a double-click and folds on a click", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const edge = sidebar.getByRole("separator", { name: "Resize sidebar" });
  const width = async () => (await sidebar.boundingBox())?.width ?? 0;
  await expect.poll(width).toBeGreaterThan(200);
  const start = await width();
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 300, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect.poll(width, "dragged wider").toBeGreaterThan(start + 60);
  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await expect.poll(width, "the width is remembered").toBeGreaterThan(start + 60);
  await edge.dblclick();
  await expect.poll(async () => Math.abs((await width()) - start), "a double-click puts it back").toBeLessThan(2);
  await edge.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(width, "the arrows resize it").toBeLessThan(start - 10);
  await edge.click();
  await expect.poll(width, "a click folds it").toBeLessThan(2);
});

test("New session in the sidebar starts a background session from what you ask", async ({ page, server }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScenario(page, server, "full");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await sidebar.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog", { name: "New session" });
  await expect(dialog).toBeVisible();
  const start = dialog.getByRole("button", { name: "Start session" });
  await expect(start, "nothing asked, nothing started").toBeDisabled();
  await dialog.getByLabel("What should it do?").fill("Tidy the release notes");
  const started = page.waitForRequest((request) => request.url().endsWith("/api/sessions.start"));
  await start.click();
  expect((await started).postDataJSON()).toEqual({ request: "Tidy the release notes" });
  await expect(dialog).toBeHidden();
});

test("switching from the sidebar moves a background session here; one in another terminal stays there", async ({ page, server }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScenario(page, server, "full");
  await page.evaluate(() => { (globalThis as any).location.hash = "#/tasks"; });
  const list = page.getByRole("complementary", { name: "Sidebar" }).getByRole("navigation", { name: "Sessions list" });
  const switched = page.waitForRequest((request) => request.url().endsWith("/api/sessions.switch"));
  await list.getByRole("button", { name: "Switch to Mock background task" }).click();
  expect((await switched).postDataJSON()).toEqual({ key: "S1" });
  await expect(page.getByText("switching this window to Mock background task…")).toBeVisible();
  await expect(page, "and the Lobby shows it").toHaveURL(/#\/lobby$/);
  await list.getByRole("button", { name: "Other window, in another terminal" }).click();
  await expect(page.getByText("Other window runs in another terminal.", { exact: false })).toBeVisible();
});

test("a plan step is skipped only with a reason, which then shows under the struck-through step @theme", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  await page.evaluate(() => { (globalThis as any).location.hash = "#/tasks/T-mock-1"; });
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole("button", { name: "Skip step 1" }), "a done step cannot be skipped").toHaveCount(0);
  await steps.getByRole("listitem").nth(2).hover();
  await steps.getByRole("button", { name: "Skip step 3" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Skip step 3?" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Skip step", exact: true });
  await expect(confirm, "no reason, no skip").toBeDisabled();
  await dialog.getByLabel("Why skip it?").fill("   ");
  await expect(confirm, "blank is not a reason").toBeDisabled();
  await dialog.getByLabel("Why skip it?").fill("The release train ships it.");
  const results = await new AxeBuilder({ page: page as any }).include('[role="alertdialog"]').analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await confirm.click();
  await expect(dialog).toBeHidden();
  const skipped = steps.locator('[data-step="skipped"]');
  await expect(skipped).toContainText("Ship it");
  await expect(skipped).toContainText("skipped");
  await expect(skipped).toContainText("Why: The release train ships it.");
  await expect(page.getByText("1 skipped", { exact: false })).toBeVisible();
  await expect(steps.getByRole("button", { name: "Skip step 3" }), "a skipped step has no Skip").toHaveCount(0);
});

test("the sidebar and the bar are one surface, the page set in it on a rounded corner that squares off when the sidebar folds @theme", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  const look = () => page.evaluate(() => {
    const g = globalThis as any;
    const style = (selector: string) => g.getComputedStyle(g.document.querySelector(selector));
    const chrome = style(".app-chrome");
    const sidebar = style("#app-sidebar");
    const header = style(".app-header");
    const frame = style(".app-page");
    return { chrome: chrome.backgroundColor, sidebar: sidebar.backgroundColor, header: header.backgroundColor, line: sidebar.borderRightColor, corner: parseFloat(frame.borderTopLeftRadius), page: frame.backgroundColor };
  });
  const open = await look();
  expect(open.sidebar, "the sidebar shows the frame through").toBe("rgba(0, 0, 0, 0)");
  expect(open.header, "and so does the bar").toBe("rgba(0, 0, 0, 0)");
  expect(open.line, "no line between them").toBe("rgba(0, 0, 0, 0)");
  expect(open.page, "the page is its own surface").not.toBe(open.chrome);
  expect(open.corner, "rounded where the sidebar and the bar meet").toBeGreaterThan(8);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(async () => (await look()).corner, "no corner without the sidebar").toBe(0);
});

test("a session is renamed from the sidebar, by its pencil or a double-click; Esc keeps the old name", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  const list = page.getByRole("navigation", { name: "Sessions list" });
  await list.getByRole("button", { name: "mock lobby, this window" }).hover();
  await list.getByRole("button", { name: "Rename mock lobby" }).click();
  const field = list.getByRole("textbox", { name: "New name for mock lobby" });
  await expect(field).toBeFocused();
  await field.fill("Login page work");
  const renamed = page.waitForRequest((request) => request.url().endsWith("/api/sessions.rename"));
  await field.press("Enter");
  expect((await renamed).postDataJSON()).toEqual({ name: "Login page work" });
  await expect(list.getByRole("button", { name: "Login page work, this window" })).toBeVisible();

  await list.getByRole("button", { name: "Switch to Mock background task" }).dblclick();
  const other = list.getByRole("textbox", { name: "New name for Mock background task" });
  await other.fill("Never mind");
  await other.press("Escape");
  await expect(list.getByRole("button", { name: "Switch to Mock background task" }), "Esc keeps the old name").toBeVisible();
  await expect(list.getByRole("button", { name: "Rename Other window" }), "a session in another terminal is not ours to rename").toHaveCount(0);
});

test("an ended session is archived from the sidebar with Undo; Archive all clears the shelf; a running one has no Archive", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  const list = page.getByRole("navigation", { name: "Sessions list" });
  await expect(list.getByRole("button", { name: "Archive Mock background task" }), "still running").toHaveCount(0);
  await page.evaluate(() => fetch("/api/sessions.stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "S1" }) }));
  const shelf = list.getByRole("region", { name: "Ended" });
  const card = shelf.getByRole("button", { name: "Switch to Mock background task" });
  await expect(card, "an ended session moves to the Ended shelf").toBeVisible();
  await card.hover();
  await shelf.getByRole("button", { name: "Archive Mock background task" }).click();
  await expect(shelf, "archived, the shelf goes").toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card, "Undo brings it back").toBeVisible();
  await shelf.getByRole("button", { name: "Archive all" }).click();
  await expect(shelf).toHaveCount(0);
});
