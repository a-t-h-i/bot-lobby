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

test("buttons and composer have visible borders before hover", { tag: "@theme" }, async ({ page, server }, info) => {
  await openScenario(page, server, "full");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.location.hash = "#/tasks/T-mock-1"; });
  await expect(page.locator("#main [data-tone=primary]:visible").first()).toBeVisible();
  await page.mouse.move(0, 899);
  const checkEdges = async () => {
    const edges = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const rgba = [...ctx.getImageData(0, 0, 1, 1).data];
        const rgb = rgba.slice(0, 3).map((value: number) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return { value: rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722, alpha: rgba[3] };
      };
      const root = getComputedStyle(document.documentElement);
      const surfaces = ["--card", "--background"].map((token) => luminance(root.getPropertyValue(token)).value);
      return [...document.querySelectorAll('.btn-raised, .btn-ghost, .btn-tint, .toolbar-button, .group\\/composer')]
        .filter((el: any) => el.getBoundingClientRect().width > 0 && !el.matches(":disabled"))
        .map((el: any) => {
          const style = getComputedStyle(el);
          const border = luminance(style.borderTopColor);
          return {
            label: el.getAttribute("aria-label") ?? el.className,
            width: Number.parseFloat(style.borderTopWidth),
            alpha: border.alpha,
            contrast: Math.min(...surfaces.map((surface) => (Math.max(border.value, surface) + 0.05) / (Math.min(border.value, surface) + 0.05))),
          };
        });
    });
    expect(edges.length).toBeGreaterThan(5);
    expect(edges.filter((edge) => edge.width < 1 || edge.alpha < 255 || edge.contrast < 3), "control edges contrast at least 3:1 with the card and page").toEqual([]);
  };
  await checkEdges();
  const composer = page.locator(".group\\/composer");
  expect(await composer.evaluate((el: any) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--card)";
    el.append(probe);
    const same = getComputedStyle(el).backgroundColor === getComputedStyle(probe).backgroundColor;
    probe.remove();
    return same;
  }), "the composer is an opaque card").toBe(true);
  await composer.getByRole("textbox").fill("Check the send button");
  await checkEdges();

  const hovered = ["[data-tone=primary]", ".btn-raised", ".btn-ghost"].map((face) => page.locator(`#main ${face}:visible, header ${face}:visible`).first());
  for (const button of hovered) {
    await button.hover();
    await checkEdges();
  }
  const bar = page.locator("#main [data-pane='detail']").getByRole("button").first().locator("xpath=..");
  const box = (await bar.boundingBox())!;
  const clip = { x: box.x - 6, y: box.y - 6, width: Math.min(620, box.width + 12), height: box.height + 12 };
  await page.mouse.move(0, 899);
  await page.screenshot({ path: info.outputPath("buttons-rest.png"), clip });
  await bar.getByRole("button").nth(1).hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: info.outputPath("buttons-hover.png"), clip });
  await composer.screenshot({ path: info.outputPath("composer.png") });
  await page.evaluate(() => { window.location.hash = "#/plan"; });
  await page.getByRole("button", { name: "Previous plans" }).click();
  await page.getByRole("list", { name: "Previous plans" }).getByRole("button", { name: /Export tasks as CSV/ }).click();
  await checkEdges();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await checkEdges();
  await page.getByRole("alertdialog").screenshot({ path: info.outputPath("delete-confirm.png") });
  await page.keyboard.press("Escape");
});
