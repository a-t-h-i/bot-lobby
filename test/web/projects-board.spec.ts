import { expect, openScenario, test, type Page } from "./fixture.ts";
import type { TaskRow } from "../../src/webui/protocol.ts";

declare const document: any;
declare const getComputedStyle: any;

async function mockFolders(page: Page) {
  await page.route("**/api/projects.browse", (route) => {
    const path = route.request().postDataJSON().path ?? "/workspace";
    const result = { path, parent: path === "/workspace" ? undefined : "/workspace", folders: path === "/workspace" ? [{ name: "Second project", path: "/workspace/second" }] : [], truncated: false };
    return route.fulfill({ json: path === "/private" ? { ok: false, code: "forbidden", error: "Folder permission denied" } : { ok: true, result } });
  });
}

async function openFolders(page: Page) {
  await page.getByRole("combobox", { name: "Project", exact: true }).click();
  await page.getByRole("button", { name: "Open folder…" }).click();
  await expect(page.getByRole("dialog", { name: "Open project folder" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Folder path" })).toHaveValue("/workspace");
}

for (const width of [1280, 320]) {
  test(`browse and open a project from the menu at ${width}px`, async ({ page, server }) => {
    await mockFolders(page);
    await openScenario(page, server, "full");
    await page.setViewportSize({ width, height: 800 });
    const reply = await page.request.post(new URL("/api/projects.self", server.link).href, { data: {} });
    const { result } = await reply.json();
    await page.route("**/api/projects.open", (route) => route.fulfill({ json: { ok: true, result: { project: result.project } } }));
    await openFolders(page);
    await page.getByRole("button", { name: "Second project", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Folder path" })).toHaveValue("/workspace/second");
    const opened = page.waitForRequest("**/api/projects.open");
    await page.getByRole("button", { name: "Open this folder" }).click();
    expect((await opened).postDataJSON()).toEqual({ path: "/workspace/second" });
    await expect(page).toHaveURL(new RegExp(`project=${result.project.id}`));
  });
}

test("folder browser remains available without running-project results and recovers from errors", async ({ page, server }) => {
  await mockFolders(page);
  await page.route("**/api/projects.list", (route) => route.fulfill({ json: { ok: false, code: "failed", error: "Lookup unavailable" } }));
  await openScenario(page, server, "full");
  await openFolders(page);
  await page.getByRole("textbox", { name: "Folder path" }).fill("/private");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Folder permission denied" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open this folder" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Folder path" }).fill("/workspace");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open this folder" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Project", exact: true })).toBeFocused();
});

const row = (id: string, status: string, kind: TaskRow["kind"] = "task"): TaskRow => ({ id, title: id, status, kind, section: kind === "archived" ? "archived" : "mine", check: status === "completed" ? "done" : "open" });

async function boardRows(page: Page) {
  const rows = [row("Queued plan", "pending", "plan"), row("New task", "created"), row("Working task", "implementing"), row("Finished task", "completed"), row("Hidden archive", "completed", "archived")];
  await page.route("**/api/tasks.list", (route) => route.fulfill({ json: { ok: true, result: { rows } } }));
}

for (const width of [1280, 320]) {
  test(`task board groups tasks and excludes archived rows at ${width}px`, async ({ page, server }) => {
    await boardRows(page);
    await openScenario(page, server, "full");
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole("tab", { name: /^.*Tasks$/ }).click();
    await page.getByRole("tab", { name: "Board", exact: true }).click();
    await expect(page.getByRole("region", { name: "Backlog", exact: true })).toContainText("Queued plan");
    await expect(page.getByRole("region", { name: "Backlog", exact: true })).toContainText("New task");
    await expect(page.getByRole("region", { name: "In progress", exact: true })).toContainText("Working task");
    await expect(page.getByRole("region", { name: "Completed", exact: true })).toContainText("Finished task");
    await expect(page.locator("#main")).not.toContainText("Hidden archive");
    await expect(page.getByRole("textbox", { name: "Message the oracle" })).toBeVisible();
    await page.getByRole("tab", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/#\/tasks$/);
  });
}

test("archiving a completed task removes it from the board immediately", async ({ page, server }) => {
  await openScenario(page, server, "full");
  await page.getByRole("tab", { name: /^.*Tasks$/ }).click();
  await page.getByRole("tab", { name: "Board", exact: true }).click();
  const completed = page.getByRole("region", { name: "Completed", exact: true });
  await completed.getByRole("button", { name: /Fix the table font/ }).click();
  await expect(page).toHaveURL(/#\/tasks\/board\/T-mock-8$/);
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(completed).not.toContainText("Fix the table font");
  await page.getByRole("tab", { name: "List", exact: true }).click();
  await page.getByRole("checkbox", { name: "Show archived tasks" }).check();
  await expect(page.locator('[data-pane="list"]')).toContainText("Fix the table font");
});

test("task board reacts to live state changes", async ({ page, server }) => {
  const task = row("Live task", "implementing");
  await page.route("**/api/tasks.list", (route) => route.fulfill({ json: { ok: true, result: { rows: [task] } } }));
  await openScenario(page, server, "full");
  await page.getByRole("tab", { name: /^.*Tasks$/ }).click();
  await page.getByRole("tab", { name: "Board", exact: true }).click();
  await expect(page.getByRole("region", { name: "In progress", exact: true })).toContainText("Live task");
  task.status = "completed"; task.check = "done";
  server.bump("tasks");
  await expect(page.getByRole("region", { name: "Completed", exact: true })).toContainText("Live task");
  await expect(page.getByRole("region", { name: "In progress", exact: true })).not.toContainText("Live task");
});

test("tab boundaries and labels remain distinct in both themes @theme", async ({ page, server }) => {
  await openScenario(page, server, "full");
  const values = await page.getByRole("tab", { name: /Tasks/ }).evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d");
    const luminance = (color: string) => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((n: number) => n / 255).map((n: number) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a); return (x! + 0.05) / (y! + 0.05); };
    const css = getComputedStyle(el);
    return { rim: contrast(css.borderTopColor, css.backgroundColor), text: contrast(css.color, css.backgroundColor) };
  });
  expect(values.rim).toBeGreaterThanOrEqual(1.7);
  expect(values.text).toBeGreaterThanOrEqual(4.5);
});
