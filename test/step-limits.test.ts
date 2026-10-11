import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grantStepTime, reserveStepTime, stepTimeLeft, STEP_LIMIT_MS } from "../src/state/step-limits.ts";
import { updateWork, workPath } from "../src/state/work-time.ts";

test("step allowances survive retries, clock updates and crashes, and ranges charge each step", () => {
  const root = mkdtempSync(join(tmpdir(), "bl-step-limit-"));
  const keys = ["backend:step-2", "backend:step-3"];
  const left = (key = keys) => stepTimeLeft(root, ".pi", "T", key, STEP_LIMIT_MS);
  const first = reserveStepTime(root, ".pi", "T", keys, STEP_LIMIT_MS, STEP_LIMIT_MS);
  assert.equal(left(), 0, "a restart cannot reset a reserved allowance");
  first.finish(600_000);
  assert.equal(left(), 300_000);
  updateWork(root, ".pi", "T", (work) => { work.workedMs += 1000; });
  assert.equal(left([keys[0]!]), 300_000);
  assert.equal(left(["designer:step-2"]), STEP_LIMIT_MS);
  reserveStepTime(root, ".pi", "T", keys, STEP_LIMIT_MS, 300_000).finish(300_000);
  assert.equal(left(), 0);
  grantStepTime(root, ".pi", "T", keys, STEP_LIMIT_MS, 120_000);
  const granted = reserveStepTime(root, ".pi", "T", keys, STEP_LIMIT_MS, 120_000);
  granted.grant(60_000);
  granted.finish(180_000);
  assert.equal(left(), 0, "approved time is also charged");
  assert.throws(() => reserveStepTime(root, ".pi", "T", keys, STEP_LIMIT_MS, 1), /no time left/);
});

test("legacy work files start with an allowance; corrupt files fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "bl-step-limit-"));
  updateWork(root, ".pi", "T", () => {});
  assert.equal(stepTimeLeft(root, ".pi", "T", ["backend:step-1"], 60_000), 60_000);
  writeFileSync(workPath(root, ".pi", "T"), "broken json");
  updateWork(root, ".pi", "T", () => {});
  assert.throws(() => stepTimeLeft(root, ".pi", "T", ["backend:step-1"], STEP_LIMIT_MS));
});
