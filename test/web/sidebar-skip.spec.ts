/**
 * Browser checks for the collapsible sidebar (its sessions, folding to the
 * rail and back by button and key, remembered across a reload, switching to a
 * session) and for skipping a plan step with a required reason, against the
 * `full` fixture set.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, openScenario, test } from "./fixture.ts";

test("the sidebar lists the running sessions and folds to a rail and back, by button and key, and remembers it @theme", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const list = sidebar.getByRole("navigation", { name: "Sessions list" });
  await expect(list.getByRole("button", { name: "mock lobby, this window" }), "this window first, marked current").toHaveAttribute("aria-current", "true");
  await expect(list.getByRole("button", { name: "Switch to Mock background task" })).toContainText("1 question for you");
  await expect(list.getByRole("button", { name: "Other window, in another terminal" })).toContainText("Another terminal");
  const width = async () => (await sidebar.boundingBox())!.width;
  expect(await width()).toBeGreaterThan(200);

  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(width, "folded to the rail").toBeLessThan(64);
  await expect(list.getByRole("button"), "each session a tile on the rail").toHaveCount(3);
  await expect(sidebar.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await expect.poll(width, "still folded after a reload").toBeLessThan(64);

  await page.keyboard.press("Alt+b");
  await expect.poll(width, "the sidebar key opens it again").toBeGreaterThan(200);
  const results = await new AxeBuilder({ page: page as any }).include("#app-sidebar").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
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
