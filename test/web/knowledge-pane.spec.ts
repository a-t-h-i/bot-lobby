import { expect, openScenario, test, type Page } from "./fixture.ts";

async function openDocument(page: Page) {
  await page.evaluate(() => { (globalThis as any).location.hash = "#/knowledge/master/knowledge.md"; });
  await expect(page.locator('[data-pane="detail"]')).toContainText("Mock what the offline page needs.");
}

for (const width of [1280, 768, 320]) {
  test(`knowledge pane preserves docs and composer at ${width}px`, async ({ page, server }) => {
    await openScenario(page, server, "full");
    await page.setViewportSize({ width, height: 800 });
    await openDocument(page);
    const toggle = page.locator('[class~="group/composer"]').getByRole("group", { name: "Knowledge pane" });
    const field = page.getByRole("textbox", { name: "Ask the oracle about this project" });
    await field.fill("Keep this draft");
    await toggle.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.locator('[data-pane="list"]')).toBeVisible();
    await expect(page.locator('[data-pane="detail"]').getByRole("log")).toBeVisible();
    await expect(field).toBeVisible();
    await toggle.getByRole("button", { name: "Docs", exact: true }).click();
    await expect(page).toHaveURL(/#\/knowledge\/master\/knowledge.md$/);
    await expect(page.locator('[data-pane="detail"]')).toContainText("Mock what the offline page needs.");
    await expect(field).toHaveValue("Keep this draft");
  });
}

test("asking from docs opens the answer pane and retains the selected document", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await openDocument(page);
  await page.getByRole("textbox", { name: "Ask the oracle about this project" }).fill("Where is the API?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/#\/knowledge\/ask\/master\/knowledge.md$/);
  await expect(page.locator('[data-pane="detail"]').getByRole("log")).toContainText("Where is the API?");
  await page.getByRole("group", { name: "Knowledge pane" }).getByRole("button", { name: "Docs", exact: true }).click();
  await expect(page.locator('[data-pane="detail"]')).toContainText("Mock what the offline page needs.");
  await page.goBack();
  await expect(page.getByRole("group", { name: "Knowledge pane" }).getByRole("button", { name: "Chat", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("failed knowledge questions preserve the draft and docs pane", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await openDocument(page);
  await page.route("**/api/knowledge.ask", (route) => route.fulfill({ json: { ok: false, code: "failed", error: "Question unavailable" } }));
  const field = page.getByRole("textbox", { name: "Ask the oracle about this project" });
  await field.fill("Do not lose this question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Question unavailable")).toBeVisible();
  await expect(field).toHaveValue("Do not lose this question");
  await expect(page).toHaveURL(/#\/knowledge\/master\/knowledge.md$/);
});
