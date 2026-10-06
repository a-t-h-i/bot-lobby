import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, openScenario, test } from "./fixture.ts";

declare const window: any;
declare const document: any;
declare const getComputedStyle: any;

test("previous plans: read, archive, bring back and delete; a plan saved as a task is not among them", async ({ page, server }, info) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/plan"; });
  await page.getByRole("button", { name: "Previous plans" }).click();
  await expect(page).toHaveURL(/#\/plan\/previous$/);
  const list = page.getByRole("list", { name: "Previous plans" });
  await expect(list.getByRole("button")).toHaveCount(2);
  await expect(list, "a plan saved as a task is flagged and left out").not.toContainText("Dark mode");
  await expect(list, "an archived one waits behind the toggle").not.toContainText("sounds per agent");

  await list.getByRole("button", { name: /Export tasks as CSV/ }).click();
  const detail = page.getByRole("article", { name: "Export tasks as CSV" });
  await expect(detail.getByText("Add an Export button to the Tasks tab")).toBeVisible();
  await expect(detail.getByText("Let me export the task list as CSV")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Edit" }), "a previous plan is read, not edited").toHaveCount(0);
  await page.screenshot({ path: info.outputPath("previous-plans.png") });

  await detail.getByRole("button", { name: "Archive" }).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Show the archived plans" }).click();
  const archived = page.getByRole("list", { name: "Archived plans" });
  await expect(archived.getByRole("button")).toHaveCount(2);
  await archived.getByRole("button", { name: /Export tasks as CSV/ }).click();
  await page.getByRole("button", { name: "Bring it back from the archive" }).click();
  await expect(archived.getByRole("button")).toHaveCount(1);

  await archived.getByRole("button", { name: /sounds per agent/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete plan" }).click();
  await expect(page.getByText("No archived plans.")).toBeVisible();
});

test("a theme is saved under its own name, renamed, and kept with pi for every session", { tag: "@theme" }, async ({ page, server, browser }, info) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance & notifications", exact: true }).click();
  await expect(page.getByText("No saved themes yet.")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Dusk");
  await page.getByLabel("Theme CSS from tweakcn").fill(":root{--background:#fafafa;--foreground:#111;--card:#fff;--primary:#7c3aed;--primary-foreground:#fff}.dark{--background:#000;--foreground:#eee;--card:#111;--primary:#a78bfa;--primary-foreground:#000}");
  await page.getByRole("button", { name: "Save and apply the pasted theme" }).click();
  const picker = page.getByRole("radiogroup", { name: "Colour theme" });
  await expect(picker.getByRole("radio", { name: /Dusk/ })).toHaveAttribute("aria-checked", "true");

  const saved = page.getByRole("list", { name: "Saved themes" });
  await saved.getByRole("button", { name: "Rename Dusk" }).click();
  await saved.getByLabel("New name for Dusk").fill("Lake at night");
  await saved.getByRole("button", { name: "Save the name" }).click();
  await expect(saved).toContainText("Lake at night");
  await expect(picker.getByRole("radio", { name: /Lake at night/ })).toHaveAttribute("aria-checked", "true");

  const kept = JSON.parse(readFileSync(join(process.env.BOT_LOBBY_CONFIG_DIR!, "themes.json"), "utf8"));
  expect(kept.themes.map((theme: { name: string }) => theme.name), "kept with pi, in its global config folder").toEqual(["Lake at night"]);
  expect(kept.active).toBe(kept.themes[0].id);

  // Another browser (another pi session's page, on another port) starts with nothing of its own and shows it all the same.
  const fresh = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  await fresh.goto(server.link);
  await fresh.locator('[role="tablist"]').waitFor();
  await fresh.evaluate(() => { window.location.hash = "#/settings"; });
  await fresh.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance & notifications", exact: true }).click();
  await expect(fresh.getByRole("radiogroup", { name: "Colour theme" }).getByRole("radio", { name: /Lake at night/ })).toHaveAttribute("aria-checked", "true");
  await fresh.getByRole("list", { name: "Saved themes" }).scrollIntoViewIfNeeded();
  await fresh.screenshot({ path: info.outputPath("saved-themes.png") });
  await fresh.context().close();
});

test("every button casts shadow-sm; its border shows only on hover, much lighter than its text", async ({ page, server }, info) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/tasks/T-mock-1"; });
  await expect(page.locator("#main .btn-tint:visible").first()).toBeVisible();
  await page.mouse.move(0, 899);
  const off = await page.evaluate(() => [...document.querySelectorAll(".btn-raised, .btn-ghost, .btn-tint")]
    .filter((el: any) => el.getBoundingClientRect().width > 0 && !el.matches(":hover"))
    .map((el: any) => {
      const style = getComputedStyle(el);
      return { label: el.getAttribute("aria-label") ?? el.textContent.trim(), border: style.borderTopColor, shadow: style.boxShadow };
    })
    .filter((button: any) => button.border !== "rgba(0, 0, 0, 0)" || !/0px 1px 3px 0px rgba\(0, 0, 0, 0\.1\), rgba\(0, 0, 0, 0\.1\) 0px 1px 2px -1px|rgba\(0, 0, 0, 0\.1\) 0px 1px 3px 0px, rgba\(0, 0, 0, 0\.1\) 0px 1px 2px -1px/.test(button.shadow)));
  expect(off, "at rest: shadow-sm and no visible border").toEqual([]);

  // The text colour much lighter: a quarter of it, the rest white.
  const lighter = (text: string) => page.evaluate((color) => {
    const probe = document.createElement("span");
    probe.style.color = color;
    probe.style.borderTop = "1px solid color-mix(in oklab, currentColor 25%, white)";
    document.body.append(probe);
    const value = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return value;
  }, text);
  // One of each face: tinted, raised and quiet.
  const hovered = [".btn-tint", ".btn-raised", ".btn-ghost"].map((face) => page.locator(`#main ${face}:visible, header ${face}:visible`).first());
  for (const button of hovered) {
    await button.hover();
    const text = await button.evaluate((el: any) => getComputedStyle(el).color);
    const want = await lighter(text);
    await expect.poll(() => button.evaluate((el: any) => getComputedStyle(el).borderTopColor), { message: "hovered: the border is its text, much lighter" }).toBe(want);
    expect(want).not.toBe(text);
  }
  const bar = page.locator("#main [data-pane='detail']").getByRole("button").first().locator("xpath=..");
  const box = (await bar.boundingBox())!;
  const clip = { x: box.x - 6, y: box.y - 6, width: Math.min(620, box.width + 12), height: box.height + 12 };
  await page.mouse.move(0, 899);
  await page.screenshot({ path: info.outputPath("buttons-rest.png"), clip });
  await bar.getByRole("button").nth(1).hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: info.outputPath("buttons-hover.png"), clip });
});
