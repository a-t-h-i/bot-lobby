import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScoutResults, runScouts, saveScoutResults, type ScoutOutcome } from "../src/master/master.ts";
import { assessReconnaissance, recordDecision } from "../src/master/decisions.ts";
import { detectGaps, detectSharedFiles, domainsInvolved, summarizeOutcomes } from "../src/master/synthesis.ts";
import { createTask } from "../src/schemas/task.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import type { ScoutResult } from "../src/schemas/findings.ts";

function scoutMarkdown(files: string[]): string {
  return [
    "## Scope",
    "Looked at the repo.",
    "",
    "## Findings",
    "- Found the thing",
    "",
    "## Relevant Files",
    ...files.map((file) => `- \`${file}\` — reason`),
    "",
    "## Risks",
    "- A risk",
    "",
    "## Confidence",
    "High",
  ].join("\n");
}

function reply(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1 } },
  });
}


function outcome(domain: ScoutResult["domain"], files: string[], overrides: Partial<ScoutOutcome> = {}): ScoutOutcome {
  const run = {
    runId: `r-${domain}`,
    taskId: "TASK-1",
    domain,
    role: "scout" as const,
    status: "success" as const,
    output: scoutMarkdown(files),
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
  };
  const result = {
    domain,
    role: "scout" as const,
    scope: "Looked at the repo.",
    findings: ["Found the thing"],
    relevantFiles: files.map((path) => ({ path, reason: "reason" })),
    patterns: [],
    risks: ["A risk"],
    recommendations: [],
    confidence: "high" as const,
    raw: scoutMarkdown(files),
  };
  return { result, run, issues: [], usable: true, ...overrides };
}

test("runScouts runs the selected domains in parallel and persists results", async () => {
  const taskDir = mkdtempSync(join(tmpdir(), "dh-scout-"));
  const runner: ProcessRunner = async (args) => {
    const task = String(args.at(-1));
    const text = task.includes("Domain focus: backend")
      ? scoutMarkdown(["src/api.ts"])
      : scoutMarkdown(["src/ui.tsx"]);
    return { exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false };
  };
  const outcomes = await runScouts(
    {
      taskId: "TASK-1",
      taskText: "Add pagination",
      instruction: "Investigate pagination support.",
      domains: ["backend", "designer"],
      cwd: process.cwd(),
      dataRoot: mkdtempSync(join(tmpdir(), "dh-data-")),
      taskDir,
      config: DEFAULT_CONFIG,
    },
    runner,
  );
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((entry) => entry.usable));
  const reloaded = loadScoutResults(taskDir, ["backend", "designer", "qa"]);
  assert.equal(reloaded.length, 2, "only persisted domains are returned");
  assert.deepEqual(domainsInvolved(reloaded), ["backend", "designer"]);
});

test("runScouts marks a failed scout unusable with an issue", async () => {
  const taskDir = mkdtempSync(join(tmpdir(), "dh-scout2-"));
  const failing: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false, timedOut: false });
  const outcomes = await runScouts(
    {
      taskId: "TASK-2",
      taskText: "X",
      instruction: "Investigate.",
      domains: ["qa"],
      cwd: process.cwd(),
      dataRoot: mkdtempSync(join(tmpdir(), "dh-data2-")),
      taskDir,
      config: DEFAULT_CONFIG,
    },
    failing,
  );
  assert.equal(outcomes[0]!.usable, false);
  assert.match(outcomes[0]!.issues[0]!, /scout failed/);
  assert.equal(assessReconnaissance(outcomes).hasEvidence, false);
  assert.equal(assessReconnaissance(outcomes).warnings.length > 0, true);
});

test("saveScoutResults and loadScoutResults round-trip", () => {
  const taskDir = mkdtempSync(join(tmpdir(), "dh-scout3-"));
  const saved = outcome("backend", ["src/a.ts"]);
  saveScoutResults(taskDir, [saved]);
  const [loaded] = loadScoutResults(taskDir, ["backend"]);
  assert.equal(loaded!.result.domain, "backend");
  assert.equal(loaded!.result.relevantFiles[0]!.path, "src/a.ts");
  assert.deepEqual(loadScoutResults(taskDir, []), []);
});

test("synthesis detects shared files and gaps", () => {
  const backend = outcome("backend", ["src/shared.ts"]);
  const designer = outcome("designer", ["src/shared.ts"]);
  const base = outcome("qa", []);
  const weak = outcome("qa", [], {
    usable: false,
    issues: ["qa: no usable reconnaissance"],
    result: { ...base.result, confidence: "low", findings: [] },
  });
  assert.deepEqual(detectSharedFiles([backend, designer]), [{ path: "src/shared.ts", domains: ["backend", "designer"] }]);
  assert.deepEqual(detectSharedFiles([backend]), []);
  assert.ok(detectGaps([backend, designer, weak]).some((gap) => gap.includes("no usable reconnaissance")));
});

test("summarizeOutcomes bounds the raw output", () => {
  const long = outcome("backend", ["src/a.ts"], {
    result: { ...outcome("backend", ["src/a.ts"]).result, raw: "x".repeat(5000) },
  });
  const summary = summarizeOutcomes([long], 100);
  assert.ok(summary.includes("characters omitted"));
  assert.ok(summary.length < 1000);
});

test("recordDecision appends to the task", () => {
  const task = createTask("TASK-1", "X", "2026-01-01T00:00:00.000Z");
  recordDecision(task, "Extend the session store", "backend", "2026-01-02T00:00:00.000Z");
  assert.equal(task.decisions.length, 1);
  assert.deepEqual(task.decisions[0], {
    domain: "backend",
    text: "Extend the session store",
    createdAt: "2026-01-02T00:00:00.000Z",
  });
});

