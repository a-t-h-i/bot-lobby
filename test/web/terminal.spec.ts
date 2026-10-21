/**
 * Browser checks for the terminal drawer: the bar's button and the terminal
 * key open it with a shell in the project's folder, typing reaches the shell
 * (and the page's own shortcuts stay out of its way), a second terminal gets
 * a list to switch from, the drawer's height drags, and a reload reattaches
 * with what the shell printed.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, openScenario, test } from "./fixture.ts";
import type { Page } from "@playwright/test";

/** The server keeps terminals per worker: start each test with none. */
async function closeAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const post = (name: string, body: unknown) => fetch(`/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
    const list = (await post("terminal.list", {})) as { result: { terminals: { id: string }[] } };
    for (const terminal of list.result.terminals) await post("terminal.close", { id: terminal.id });
  });
}

test("the terminal opens from the bar with a shell, takes what you type, keeps the page's keys out of the way, and comes back after a reload @theme", async ({ page, server }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, server, "full");
  await closeAll(page);
  const header = page.getByRole("banner");
  const toggle = header.getByRole("button", { name: "Terminal", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const drawer = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(drawer).toBeVisible();
  const screen = drawer.locator(".xterm-rows");
  await expect(screen, "a shell starts by itself").toContainText(/[$#%>]/, { timeout: 15_000 });

  await drawer.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo answer=$((6*7))");
  await page.keyboard.press("Enter");
  await expect(screen).toContainText("answer=42");

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const width = async () => (await sidebar.boundingBox())?.width ?? 0;
  await page.keyboard.press("Alt+b");
  await page.waitForTimeout(400);
  expect(await width(), "Alt+B is the shell's in a terminal, not the sidebar's").toBeGreaterThan(200);

  const results = await new AxeBuilder({ page: page as any }).include("#terminal-drawer").exclude(".xterm").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await expect(drawer, "still open after a reload").toBeVisible();
  await expect(screen, "with what the shell printed").toContainText("answer=42", { timeout: 15_000 });

  await drawer.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Backquote");
  await expect(drawer, "the terminal key hides it from inside the terminal").toBeHidden();
  await page.keyboard.press("Control+Backquote");
  await expect(drawer, "and opens it again").toBeVisible();
  await expect(screen, "the same shell, still running").toContainText("answer=42");
});

test("a second terminal adds a list to switch between them; ending one leaves the other; the top edge drags the drawer taller", async ({ page, server }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScenario(page, server, "full");
  await closeAll(page);
  await page.getByRole("banner").getByRole("button", { name: "Terminal", exact: true }).click();
  const drawer = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(drawer.locator(".xterm-rows")).toContainText(/[$#%>]/, { timeout: 15_000 });
  await expect(drawer.getByRole("navigation", { name: "Terminals" }), "one terminal needs no list").toHaveCount(0);

  await drawer.getByRole("button", { name: "New terminal" }).click();
  const list = drawer.getByRole("navigation", { name: "Terminals" });
  await expect(list.getByRole("button")).toHaveCount(2);
  await expect(list.getByRole("button").nth(1), "the new one is shown").toHaveAttribute("aria-current", "true");
  await drawer.getByRole("button", { name: "End this terminal" }).click();
  await expect(list, "back to one, no list").toHaveCount(0);

  const height = async () => (await drawer.boundingBox())!.height;
  const before = await height();
  const edge = drawer.getByRole("separator", { name: "Resize terminal" });
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y - 60, { steps: 5 });
  await page.mouse.up();
  await expect.poll(height, "dragged taller").toBeGreaterThan(before + 50);

  await drawer.getByRole("button", { name: "Hide terminal" }).click();
  await expect(drawer).toBeHidden();
});

test("the pop-out toggle beside New and End moves the terminal into a pop-up and back, the same shell, and the choice is remembered @theme", async ({ page, server }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScenario(page, server, "full");
  await closeAll(page);
  await page.getByRole("banner").getByRole("button", { name: "Terminal", exact: true }).click();
  const drawer = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(drawer.locator(".xterm-rows")).toContainText(/[$#%>]/, { timeout: 15_000 });
  await drawer.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo popped=$((2+3))");
  await page.keyboard.press("Enter");
  await expect(drawer.locator(".xterm-rows")).toContainText("popped=5");

  const toggle = drawer.getByRole("button", { name: "Pop out terminal" });
  await expect(toggle, "it sits with New and End").toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  const popup = page.getByRole("dialog", { name: "Terminal" });
  await expect(popup).toBeVisible();
  await expect(drawer, "the drawer gives way").toHaveCount(0);
  const screen = popup.locator(".xterm-rows");
  await expect(screen, "the same shell, with what it printed").toContainText("popped=5", { timeout: 15_000 });
  await expect(popup.getByRole("button", { name: "Pop out terminal" })).toHaveAttribute("aria-pressed", "true");
  const box = (await popup.boundingBox())!;
  expect(box.width, "a roomy pop-up in the middle of the window").toBeGreaterThan(700);
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(4);

  await expect(popup.locator(".xterm-helper-textarea"), "the cursor goes to the shell").toBeFocused();
  await page.keyboard.type("echo inside=$((3*3))");
  await page.keyboard.press("Enter");
  await expect(screen, "typing reaches the shell").toContainText("inside=9");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await expect(popup, "Esc in the terminal is the shell's").toBeVisible();

  const results = await new AxeBuilder({ page: page as any }).include("[role='dialog']").exclude(".xterm").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.keyboard.press("Control+Backquote");
  await expect(popup, "the terminal key closes it").toBeHidden();
  await page.reload();
  await page.locator('[role="tablist"]').waitFor();
  await page.keyboard.press("Control+Backquote");
  await expect(popup, "and opens it in the pop-up again, after a reload too").toBeVisible();
  await popup.getByRole("button", { name: "Hide terminal" }).focus();
  // The first Esc puts away the button's tooltip, the next closes the pop-up.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(popup, "Esc from the toolbar closes it").toBeHidden();

  await page.keyboard.press("Control+Backquote");
  await page.getByRole("dialog", { name: "Terminal" }).getByRole("button", { name: "Pop out terminal" }).click();
  await expect(drawer, "back in the drawer").toBeVisible();
  await expect(drawer.locator(".xterm-rows")).toContainText("inside=9", { timeout: 15_000 });
});
