import { expect, openScenario, test } from "./fixture.ts";

test("slash menu includes Pi commands, installed skills, extensions and templates @theme", async ({ page, server }) => {
  await openScenario(page, server, "empty");
  const field = page.getByRole("combobox", { name: "Message the team" });
  await field.fill("/");
  const menu = page.getByRole("listbox", { name: "Commands" });
  for (const name of ["/plan", "/task", "/compact", "/login", "/scoped-models", "/skill:pdf-tools", "/mcp", "/review"]) {
    await expect(menu.getByRole("option").filter({ hasText: name })).toHaveCount(1);
  }
  await expect(menu.getByRole("option").filter({ hasText: "/login" })).toContainText("continue in Pi terminal");
  await field.fill("/skill:pdf-");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await field.press("Tab");
  await expect(field).toHaveValue("/skill:pdf-tools ");
  await field.fill("/scoped-");
  await field.press("Tab");
  await expect(field).toHaveValue("/scoped-models ");
});

test("skill selection preserves arguments and sends the canonical Pi command", async ({ page, server }) => {
  await openScenario(page, server, "empty");
  const field = page.getByRole("combobox", { name: "Message the team" });
  await field.fill("/skill:pdf-tools extract report.pdf");
  await field.press("Home");
  for (let i = 0; i < 16; i++) await field.press("ArrowRight");
  const menu = page.getByRole("listbox", { name: "Commands" });
  await menu.getByRole("option").filter({ hasText: "/skill:pdf-tools" }).click();
  await expect(field).toHaveValue("/skill:pdf-tools extract report.pdf");
  const request = page.waitForRequest((request) => request.url().endsWith("/api/lobby.send"));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await request).postDataJSON().text).toBe("/skill:pdf-tools extract report.pdf");
});

test("live Pi command discovery replaces installed resource suggestions", async ({ page, server }) => {
  await openScenario(page, server, "empty");
  const field = page.getByRole("combobox", { name: "Message the team" });
  await field.fill("/skill:");
  await expect(page.getByRole("option").filter({ hasText: "/skill:pdf-tools" })).toBeVisible();
  await server.stop();
  await server.start((service) => { service.commands = () => [{ name: "skill:new-skill", description: "Newly installed skill" }]; });
  server.bump("status");
  await expect(page.getByRole("option").filter({ hasText: "/skill:new-skill" })).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: "/skill:pdf-tools" })).toHaveCount(0);
});
