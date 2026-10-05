import type { Delivery } from "../../src/delivery/types.ts";
import type { WebPrompt } from "../../src/webui/protocol.ts";
import { expect, openScenario, test, type Page } from "./fixture.ts";

declare const document: any;
declare const window: any;
declare const navigator: any;
declare const getComputedStyle: any;

async function task(page: Page): Promise<void> {
  await page.evaluate(() => { window.location.hash = "#/tasks/T-mock-1"; });
  await expect(page.getByRole("article", { name: "Add offline mock fixtures", exact: true })).toBeVisible();
}

function review(): Delivery {
  return { status: "pending_approval", reviewId: "review-1", repository: "/fixture/repo", project: "Fixture project", sourceBranch: "task/fixture", sourceCommit: "a".repeat(40), target: "main", targetCommit: "b".repeat(40), reviewedAt: new Date().toISOString(), blocked: {}, verification: { checks: "absent", summary: "Local QA passed; no remote checks or required checks", localVerified: true, requiredChecks: [], rulesKnown: true } };
}

async function detail(page: Page, values: () => Record<string, unknown>): Promise<void> {
  await page.route((url) => url.pathname === "/api/tasks.get", async (request) => {
    const response = await request.fetch();
    const reply = await response.json();
    await request.fulfill({ json: { ...reply, result: { ...reply.result, ...values() } } });
  });
}

async function chat(page: Page, text: string): Promise<void> {
  await page.route((url) => url.pathname === "/api/lobby.snapshot", async (request) => {
    const response = await request.fetch();
    const reply = await response.json();
    await request.fulfill({ json: { ...reply, result: { ...reply.result, chat: [{ id: 991, at: Date.now(), role: "oracle", text }] } } });
  });
}

test("delivery merge requires second confirmed action, no automatic publication", async ({ page, server }, info) => {
  let current = review();
  const sent: unknown[] = [];
  await detail(page, () => ({ delivery: current }));
  await page.route((url) => url.pathname === "/api/tasks.deliver", async (request) => {
    sent.push(request.request().postDataJSON());
    current = { ...current, status: "successful", result: { action: "merge_main", commit: "c".repeat(40) } };
    await request.fulfill({ json: { ok: true, result: { delivery: current } } });
  });
  await openScenario(page, server, "full");
  await task(page);
  await expect(page.getByText("Checks: absent", { exact: true })).toBeVisible();
  expect(sent).toEqual([]);
  await page.getByRole("button", { name: "Merge to main", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm merge to main", exact: true });
  await expect(confirm).toContainText("pushes main");
  expect(sent).toEqual([]);
  await page.screenshot({ path: info.outputPath("delivery-confirm.png"), fullPage: true });
  await confirm.getByRole("button", { name: "Confirm merge and push main", exact: true }).click();
  await expect(page.getByText(/main pushed/)).toBeVisible();
  expect(sent).toEqual([{ taskId: "T-mock-1", reviewId: "review-1", action: "merge_main", confirmMain: true }]);
});

test("delivery PR targets reviewed main without merging, deferral persists and stale refresh is passive", async ({ page, server }) => {
  let current = review();
  const sent: Record<string, unknown>[] = [];
  await detail(page, () => ({ delivery: current }));
  await page.route((url) => url.pathname === "/api/tasks.deliveryDefer", async (request) => {
    current = { ...current, status: "deferred" };
    await request.fulfill({ json: { ok: true, result: { delivery: current } } });
  });
  await page.route((url) => url.pathname === "/api/tasks.deliveryReview", async (request) => {
    current = { ...current, reviewId: "review-2", sourceCommit: "d".repeat(40) };
    await request.fulfill({ json: { ok: true, result: { delivery: current } } });
  });
  await page.route((url) => url.pathname === "/api/tasks.deliver", async (request) => {
    sent.push(request.request().postDataJSON());
    current = { ...current, status: "successful", result: { action: "create_pr", pullNumber: 77, pullUrl: "https://example.invalid/pr/77" } };
    await request.fulfill({ json: { ok: true, result: { delivery: current } } });
  });
  await openScenario(page, server, "full");
  await task(page);
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved for later" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Saved for later" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh review", exact: true }).click();
  await expect(page.getByText(new RegExp("d{40}"))).toBeVisible();
  expect(sent).toEqual([]);
  await page.getByRole("button", { name: "Create PR", exact: true }).click();
  await expect(page.getByText(/PR #77 created/)).toBeVisible();
  expect(sent).toEqual([{ taskId: "T-mock-1", reviewId: "review-2", action: "create_pr" }]);
});

for (const status of ["in_progress", "successful", "recoverable_failure"] as const) {
  test(`delivery ${status} exposes authoritative state and recovery`, async ({ page, server }) => {
    const delivery = { ...review(), status, ...(status === "recoverable_failure" ? { error: "Branch pushed; PR lookup unavailable", blocked: { merge_main: "Check lookup unavailable" } } : {}) };
    await detail(page, () => ({ delivery }));
    await openScenario(page, server, "full");
    await task(page);
    const merge = page.getByRole("button", { name: "Merge to main", exact: true });
    await expect(merge).toBeDisabled();
    if (status === "recoverable_failure") await expect(page.getByRole("alert").filter({ hasText: "Completed work is retained" })).toBeVisible();
    else await expect(page.getByRole("button", { name: "Create PR", exact: true })).toBeDisabled();
  });
}

test("unavailable checks block merge beside action without disabling independent PR", async ({ page, server }) => {
  const delivery = review();
  delivery.verification!.checks = "unavailable";
  delivery.verification!.rulesKnown = false;
  delivery.blocked.merge_main = "Cannot verify repository rules. Authenticate and refresh review.";
  await detail(page, () => ({ delivery }));
  await openScenario(page, server, "full");
  await task(page);
  await expect(page.getByText("Checks: unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge to main", exact: true })).toBeDisabled();
  await expect(page.getByText(/Cannot verify repository rules/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create PR", exact: true })).toBeEnabled();
});

test("timing renders running, overlapping waits, resumes only after final resolution and legacy unavailable", async ({ page, server }) => {
  const now = new Date().toISOString();
  let timing: unknown = { phase: "implementing", elapsedMs: 65000, runningSince: now, waiting: false, serverNow: now };
  // A task from before work time was kept: its phase clock is all there is.
  await detail(page, () => ({ timing, work: undefined }));
  await openScenario(page, server, "full");
  await task(page);
  await expect(page.getByText(/implementing.*execution/).last()).toBeVisible();
  timing = { phase: "implementing", elapsedMs: 65000, waiting: true, serverNow: now };
  server.bump("tasks");
  const waiting = page.getByText(/Waiting for you.*execution/).last();
  await expect(waiting).toBeVisible();
  const paused = await waiting.textContent();
  server.bump("tasks");
  await page.waitForTimeout(1100);
  await expect(waiting).toHaveText(paused!);
  timing = { phase: "implementing", elapsedMs: 65000, runningSince: new Date().toISOString(), waiting: false, serverNow: new Date().toISOString() };
  server.bump("tasks");
  await expect(waiting).toHaveCount(0);
  timing = undefined;
  server.bump("tasks");
  await expect(page.getByText("Timing unavailable").last()).toBeVisible();
});

test("opening task selects actual owner conversation without starting switching or claiming", async ({ page, server }) => {
  const forbidden: string[] = [];
  page.on("request", (request) => { if (/api\/sessions\.(start|switch)/.test(request.url())) forbidden.push(request.url()); });
  await page.route((url) => url.pathname === "/api/tasks.open", (request) => request.fulfill({ json: { ok: true, result: { sessionId: "owner-session", key: "background-owner" } } }));
  await openScenario(page, server, "full");
  await task(page);
  await page.getByRole("button", { name: "Open task conversation", exact: true }).click();
  await expect(page).toHaveURL(/#\/sessions\/background-owner$/);
  expect(forbidden).toEqual([]);
});

test("exact source code copying by pointer and keyboard, selection guard and accessible failure", async ({ page, server }) => {
  await page.addInitScript(() => {
    window.copies = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { if (window.refuseCopy) throw new Error("denied"); window.copies.push(text); } } });
  });
  await chat(page, "Inline ` a\\b &lt;x&gt; `\n\n```sh\nprintf '<x>'  \nnext\n\n```\n\n<div>ordinary HTML</div>");
  await openScenario(page, server, "full");
  const code = page.getByRole("button", { name: "Copy code", exact: true });
  await expect(code).toHaveCount(2);
  await code.first().click();
  await expect.poll(() => page.evaluate(() => window.copies)).toEqual([" a\\b &lt;x&gt; "]);
  await code.last().focus();
  await code.last().press("Enter");
  await expect.poll(() => page.evaluate(() => window.copies.length)).toBe(2);
  expect(await page.evaluate(() => window.copies[1])).toBe("printf '<x>'  \nnext\n\n");
  await code.first().evaluate((el: any) => { const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  await code.first().press("Enter");
  expect(await page.evaluate(() => window.copies.length)).toBe(2);
  await page.evaluate(() => { window.getSelection().removeAllRanges(); window.refuseCopy = true; });
  await code.first().press("Space");
  const message = /^Could not copy code\. Select it and copy manually, or allow clipboard access\./;
  const failure = page.locator('[aria-live]').filter({ hasText: message });
  await expect(failure.getByText(message)).toBeVisible();
  await expect(failure).toHaveAttribute("aria-live", /polite|assertive/);
  await expect(page.locator("iframe"), "ordinary chat HTML never becomes a mockup").toHaveCount(0);
});

const HOSTILE = `<style>h1{background:rgb(4,5,6)}</style><h1 id="safe" style="color:rgb(1, 2, 3)">Static example</h1><button onclick="parent.pwned=1">Click me</button><script>parent.pwned=1;fetch('https://evil.invalid/script')</script><img src="https://evil.invalid/image" onerror="parent.pwned=1"><form action="https://evil.invalid/form"><input><button>Submit</button></form><a href="https://evil.invalid/nav">Navigate</a><meta http-equiv="refresh" content="0;url=https://evil.invalid/meta"><base href="https://evil.invalid/base"><iframe src="https://evil.invalid/frame"></iframe><svg onload="parent.pwned=1"><image href="https://evil.invalid/svg"/></svg><math><mtext><img src="https://evil.invalid/math"></mtext></math>`;

test("explicit HTML mockup isolates hostile payloads and retains local CSS and Markdown preview", async ({ page, server }, info) => {
  const requests: string[] = [];
  await page.route("https://evil.invalid/**", async (request) => { requests.push(request.request().url()); await request.abort(); });
  const prompt: WebPrompt = { id: "hostile-preview", createdAt: 1, from: "qa", kind: "questionnaire", payload: { questions: [{ question: "Review static example?", header: "Preview", options: [{ label: "Safe option", preview: "**Markdown retained**", htmlPreview: { html: HOSTILE, css: "@import 'https://evil.invalid/import'; h1{background:rgb(4,5,6)} p{background:url(https://evil.invalid/css)} div{background:u\\72l(https://evil.invalid/escape)}" } }] }] } };
  await page.route((url) => url.pathname === "/api/prompts.list", (request) => request.fulfill({ json: { ok: true, result: { prompts: [prompt] } } }));
  await openScenario(page, server, "full");
  const iframe = page.locator('iframe[title="Static mockup: Safe option"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute("sandbox", "");
  const frame = page.frameLocator('iframe[title="Static mockup: Safe option"]');
  await expect(frame.getByRole("heading", { name: "Static example" })).toBeVisible();
  expect(await frame.locator("h1").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(4, 5, 6)");
  await expect(frame.locator("script, form, meta[http-equiv='refresh'], base, iframe, svg, math, [onclick], [onerror], [href], [src]")).toHaveCount(0);
  const csp = frame.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  await expect(csp).toHaveAttribute("content", "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
  await expect(page.locator("strong").filter({ hasText: "Markdown retained" })).toBeVisible();
  expect(await frame.locator("h1").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(1, 2, 3)");
  await expect(frame.locator("button, input, a")).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(requests, "no external resources are requested, not just blocked afterwards").toEqual([]);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await expect(page).not.toHaveURL(/evil/);
  await page.screenshot({ path: info.outputPath("static-preview.png"), fullPage: true });
});

test("droplet snapshots quiet, same-count new IDs once, rerenders quiet and mute survives reload", async ({ page, server }) => {
  let prompts: WebPrompt[] = [];
  await page.addInitScript(() => {
    window.tones = 0;
    const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    window.AudioContext = class { state = "running"; currentTime = 0; destination = {}; async resume() {} createGain() { return { gain: parameter, connect() {}, disconnect() {} }; } createOscillator() { return { frequency: parameter, connect() {}, disconnect() {}, start() { window.tones++; }, stop() {} }; } };
  });
  await page.route((url) => url.pathname === "/api/prompts.list", (request) => request.fulfill({ json: { ok: true, result: { prompts } } }));
  await openScenario(page, server, "full");
  await expect(page.getByLabel("Connected", { exact: true })).toBeVisible();
  await page.locator("#composer-text").click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.tones)).toBe(0);
  prompts = [{ id: "sound-one", kind: "confirm", from: "qa", createdAt: 1, payload: { question: "First sound question?" } }];
  server.bump("prompts");
  await expect(page.getByText("First sound question?", { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.tones)).toBe(1);
  prompts = [{ ...prompts[0]!, id: "sound-two", payload: { question: "Replacement sound question?" } }];
  server.bump("prompts");
  await expect.poll(() => page.evaluate(() => window.tones)).toBe(2);
  server.bump("prompts");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.tones)).toBe(2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Mute prompt sounds", exact: true }).click();
  expect(await page.evaluate(() => window.localStorage.getItem("bot-lobby.prompt-sound-muted"))).toBe("on");
  const notificationPreference = await page.evaluate(() => window.localStorage.getItem("bot-lobby.notifications"));
  await page.reload();
  expect(await page.evaluate(() => window.localStorage.getItem("bot-lobby.prompt-sound-muted"))).toBe("on");
  await expect(page.getByRole("dialog", { name: "Question from the lobby" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Unmute prompt sounds", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.tones)).toBe(0);
  expect(await page.evaluate(() => window.localStorage.getItem("bot-lobby.notifications"))).toBe(notificationPreference);
});
