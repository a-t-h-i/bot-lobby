/**
 * Browser checks for the collapsible sidebar (its session cards and shelves,
 * search, folding off the page and back by button and key, resizing by its
 * edge, New session, switching to a session, all remembered across a reload)
 * and for skipping a plan step with a required reason, against the `full`
 * fixture set.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, openScenario, test } from "./fixture.ts";

test("the sidebar lists the sessions as cards with shelves, searches them, folds off the page and back by button and key, and remembers it @theme", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const header = page.getByRole("banner");
  const list = sidebar.getByRole("navigation", { name: "Sessions list" });
  const here = list.getByRole("button", { name: "mock lobby, this window" });
  await expect(here, "this window first, marked current").toHaveAttribute("aria-current", "true");
  await expect(here).toContainText("This window");
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
