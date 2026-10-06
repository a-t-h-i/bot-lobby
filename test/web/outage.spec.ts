import { expect, openScenario, test } from "./fixture.ts";

declare const window: any;

const CARRIED = "pi stopped unexpectedly — carried on with the planning session and task T-mock-1";

test("pi stopping and coming back leaves the page as it was, and says what carried on", async ({ page, server }, info) => {
  await openScenario(page, server, "full");
  await page.evaluate(() => { window.location.hash = "#/plan"; });
  await expect(page.getByRole("tab", { name: /Plan/ })).toHaveAttribute("aria-selected", "true");
  const box = page.locator("#composer-text");
  await box.fill("half-written idea for the panel");

  await server.stop();
  const banner = page.getByRole("status").filter({ hasText: "Lost pi" });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("Your planning session and tasks carry on when it is back");
  await expect(box, "the draft is still there").toHaveValue("half-written idea for the panel");
  await page.screenshot({ path: info.outputPath("outage.png") });

  await server.start((service) => Object.assign(service, { recovered: () => ({ at: Date.now(), text: CARRIED }) }));
  await expect(banner).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(CARRIED)).toBeVisible();
  await expect(page.getByRole("tab", { name: /Plan/ }), "still on the same tab").toHaveAttribute("aria-selected", "true");
  await expect(box, "and the draft survived the outage").toHaveValue("half-written idea for the panel");
  await expect(page.locator("header").first().getByLabel("Connected", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("back.png") });
});
