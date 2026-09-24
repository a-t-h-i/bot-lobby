import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researcherSpec, isResearchResultUsable, parseResearchResult, validateResearchResult } from "../src/roles/researcher.ts";
import { loadResearchResults, researchResultPath, runResearch } from "../src/master/research.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const WELL_FORMED = [
  "## Question",
  "Does pi support a web search tool?",
  "",
  "## Findings",
  "- Web tools ship as the pi-web-access extension",
  "",
  "## Sources",
  "- https://example.com/docs — documents the web_search tool (2026-01-02)",
  "",
  "## Unverified",
  "- Windows support was not confirmed",
  "",
  "## Recommendations",
  "- Pin pi-web-access and list its tools in the allowlist",
  "",
  "## Confidence",
  "High",
].join("\n");

function reply(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  });
}

test("researcher spec is read-only with an explicit web tool allowlist", () => {
  assert.equal(researcherSpec.role, "researcher");
  assert.equal(researcherSpec.promptFile, "researcher.md");
  assert.deepEqual(researcherSpec.tools, [
    "read", "grep", "find", "ls",
    "web_search", "fetch_content", "source_check", "get_search_content",
  ]);
  assert.ok(!researcherSpec.tools!.includes("orchestrate"), "researcher must never orchestrate");
  assert.ok(researcherSpec.contract.includes("## Sources"));
  assert.ok(researcherSpec.contract.includes("## Confidence"));
});

test("parseResearchResult extracts sections and a dated source", () => {
  const result = parseResearchResult("backend", WELL_FORMED);
  assert.equal(result.domain, "backend");
  assert.equal(result.role, "researcher");
  assert.equal(result.question, "Does pi support a web search tool?");
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.sources, [
    { url: "https://example.com/docs", title: "documents the web_search tool", date: "2026-01-02" },
  ]);
  assert.equal(result.unverified.length, 1);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.confidence, "high");
  assert.deepEqual(validateResearchResult(result), []);
  assert.ok(isResearchResultUsable(result));
});

test("sources parse with a version, without a date, and as a bare URL", () => {
  const raw = ["## Sources", "- https://a.test — release notes (v1.2.3)", "- https://b.test — plain claim", "- https://c.test"].join("\n");
  const { sources } = parseResearchResult("qa", raw);
  assert.deepEqual(sources[0], { url: "https://a.test", title: "release notes", date: "v1.2.3" });
  assert.deepEqual(sources[1], { url: "https://b.test", title: "plain claim" });
  assert.deepEqual(sources[2], { url: "https://c.test", title: "" });
});

test("parseResearchResult degrades on unstructured output instead of throwing", () => {
  const result = parseResearchResult("designer", "I browsed around and it seems fine.");
  assert.equal(result.question, "");
  assert.equal(result.findings.length, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.confidence, "low");
  assert.equal(result.raw, "I browsed around and it seems fine.");
  const empty = parseResearchResult("qa", "");
  assert.deepEqual(empty.findings, []);
  assert.equal(empty.confidence, "low");
  assert.ok(!isResearchResultUsable(result));
});

test("confidence defaults to low when the section is missing or unknown", () => {
  assert.equal(parseResearchResult("qa", "## Findings\n- something").confidence, "low");
  assert.equal(parseResearchResult("qa", "## Confidence\nunclear").confidence, "low");
  assert.equal(parseResearchResult("qa", "## Confidence\nMedium").confidence, "medium");
});

test("validateResearchResult reports every contract deviation", () => {
  const bare = parseResearchResult("backend", "## Findings\n- a claim");
  assert.deepEqual(validateResearchResult(bare), ["missing Question section", "no sources reported", "missing Confidence section"]);
  const sourceless = parseResearchResult("backend", "## Question\nWhy?\n\n## Findings\n- a claim\n\n## Confidence\nLow");
  assert.deepEqual(validateResearchResult(sourceless), ["no sources reported"]);
  const noFindings = parseResearchResult("backend", "## Question\nWhy?\n\n## Confidence\nLow");
  assert.deepEqual(validateResearchResult(noFindings), ["no findings reported", "no sources reported"]);
});

test("isResearchResultUsable needs at least one finding and one source", () => {
  const findingsOnly = parseResearchResult("qa", "## Findings\n- a claim");
  const sourcesOnly = parseResearchResult("qa", "## Sources\n- https://a.test — claim");
  assert.equal(isResearchResultUsable(findingsOnly), false);
  assert.equal(isResearchResultUsable(sourcesOnly), false);
  assert.equal(isResearchResultUsable(parseResearchResult("qa", WELL_FORMED)), true);
});

test("runResearch maps a canned report to an outcome and persists it", async () => {
  const taskDir = mkdtempSync(join(tmpdir(), "dh-research-"));
  const runner: ProcessRunner = async () => ({ exitCode: 0, stdout: reply(WELL_FORMED), stderr: "", killed: false, timedOut: false });
  const outcome = await runResearch(
    { taskId: "TASK-1", domain: "backend", instruction: "Does pi support web search?", cwd: process.cwd(), taskDir, config: DEFAULT_CONFIG },
    runner,
  );
  assert.equal(outcome.run.status, "success");
  assert.equal(outcome.run.role, "researcher");
  assert.equal(outcome.usable, true);
  assert.deepEqual(outcome.issues, []);
  const [loaded] = loadResearchResults(taskDir, ["backend"]);
  assert.equal(loaded!.result.sources[0]!.url, "https://example.com/docs");
  assert.equal(researchResultPath(taskDir, "backend"), join(taskDir, "research-backend.json"));
  assert.deepEqual(loadResearchResults(taskDir, ["qa"]), []);
});

test("a sourceless or failed research run is marked unusable", async () => {
  const taskDir = mkdtempSync(join(tmpdir(), "dh-research2-"));
  const sourceless: ProcessRunner = async () => ({
    exitCode: 0,
    stdout: reply("## Question\nWhy?\n\n## Findings\n- a claim\n\n## Confidence\nHigh"),
    stderr: "",
    killed: false,
    timedOut: false,
  });
  const weak = await runResearch(
    { taskId: "TASK-2", domain: "qa", instruction: "What changed?", cwd: process.cwd(), taskDir, config: DEFAULT_CONFIG },
    sourceless,
  );
  assert.equal(weak.usable, false);
  assert.match(weak.issues.join("; "), /no sources reported/);
  assert.deepEqual(weak.result.sources, []);

  const failed: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false, timedOut: false });
  const broken = await runResearch(
    { taskId: "TASK-3", domain: "designer", instruction: "Any trends?", cwd: process.cwd(), taskDir, config: DEFAULT_CONFIG },
    failed,
  );
  assert.equal(broken.usable, false);
  assert.match(broken.issues[0]!, /research failed/);
});
