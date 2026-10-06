import { expect, openScenario, test } from "./fixture.ts";

declare const window: any;

test("Resume carries a stopped task on in the background from the Tasks screen; the page and this window stay put", async ({ page, server }, info) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/tasks/T-mock-1"; });
  const own = page.getByRole("article", { name: "Add offline mock fixtures" });
  await expect(own.getByRole("button", { name: /Open in its session/ })).toBeVisible();
  await expect(own.getByRole("button", { name: /^Resume/ }), "this window's own task is under way: nothing to resume").toHaveCount(0);

  await page.evaluate(() => { window.location.hash = "#/tasks/T-mock-3"; });
  const detail = page.getByRole("article", { name: "Tidy the settings copy" });
  const resume = detail.getByRole("button", { name: "Resume: carry it on in a background session" });
  await expect(resume).toBeVisible();
  await expect(resume, "Resume is the main action").toHaveAttribute("data-tone", "primary");
  await expect(detail.getByRole("button", { name: /Open in its session/ }), "Open in session steps back").toHaveAttribute("data-tone", "neutral");
  await expect(detail).toContainText("not running");
  await page.screenshot({ path: info.outputPath("resume-stopped.png") });

  // Esc leaves the message box for the page, where R is Resume.
  await page.locator("#composer-text").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await expect(page.getByText("resumed T-mock-3 in a background session")).toBeVisible();
  await expect(page, "the page stays on the task").toHaveURL(/#\/tasks\/T-mock-3$/);
  await expect(resume).toHaveCount(0);
  await expect(detail).toContainText("background");
  await page.screenshot({ path: info.outputPath("resume-started.png") });

  await page.getByRole("button", { name: "Watch" }).click();
  await expect(page, "Watch opens its session to look at, nothing more").toHaveURL(/#\/sessions\/S2$/);
});

test("Resume unpauses a paused task where it runs", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/tasks/T-mock-4"; });
  const detail = page.getByRole("article", { name: "Rename the export button" });
  await expect(detail).toContainText("paused");
  await detail.getByRole("button", { name: "Resume: unpause it where it runs" }).click();
  await expect(page.getByText("resumed T-mock-4 — the session driving it in another terminal carries on")).toBeVisible();
  await expect(detail.getByRole("button", { name: /^Resume/ })).toHaveCount(0);
  await expect(detail).not.toContainText("paused");
});
