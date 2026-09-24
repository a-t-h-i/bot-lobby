import { test } from "node:test";
import assert from "node:assert/strict";
import { isScoutResultUsable, parseScoutResult, validateScoutResult } from "../src/roles/scout.ts";

const WELL_FORMED = [
  "## Scope",
  "Auth middleware and session storage.",
  "",
  "## Findings",
  "- Auth is centralized in src/auth/session.ts",
  "- Tokens are validated by middleware",
  "",
  "## Relevant Files",
  "- `src/auth/session.ts` — session store and token validation",
  "- `src/middleware.ts` — applies auth checks",
  "",
  "## Existing Patterns",
  "- Middleware chain composition",
  "",
  "## Risks",
  "- No rate limiting on login",
  "",
  "## Recommendations",
  "- Extend the existing session store",
  "",
  "## Confidence",
  "High",
].join("\n");

test("parseScoutResult extracts every contract section", () => {
  const result = parseScoutResult("backend", WELL_FORMED);
  assert.equal(result.domain, "backend");
  assert.equal(result.scope, "Auth middleware and session storage.");
  assert.equal(result.findings.length, 2);
  assert.equal(result.relevantFiles.length, 2);
  assert.deepEqual(result.relevantFiles[0], {
    path: "src/auth/session.ts",
    reason: "session store and token validation",
  });
  assert.equal(result.patterns.length, 1);
  assert.equal(result.risks.length, 1);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.confidence, "high");
  assert.deepEqual(validateScoutResult(result), []);
  assert.ok(isScoutResultUsable(result));
});

test("parseScoutResult degrades on unstructured output instead of throwing", () => {
  const result = parseScoutResult("designer", "I looked around and it seems fine.");
  assert.equal(result.findings.length, 0);
  assert.equal(result.confidence, "low");
  assert.ok(!isScoutResultUsable(result));
  assert.ok(validateScoutResult(result).length >= 2);
});

test("confidence defaults to low when the section is missing", () => {
  const result = parseScoutResult("qa", "## Findings\n- something");
  assert.equal(result.confidence, "low");
  assert.deepEqual(validateScoutResult(result), ["missing Scope section", "missing Confidence section"]);
});

test("bullets without a reason still yield a file entry", () => {
  const result = parseScoutResult("backend", "## Relevant Files\n- src/index.ts");
  assert.deepEqual(result.relevantFiles, [{ path: "src/index.ts", reason: "" }]);
});

test("lowercase headings and asterisk bullets are accepted", () => {
  const raw = "## findings\n* first\n* second\n\n## confidence\nlow";
  const result = parseScoutResult("backend", raw);
  assert.deepEqual(result.findings, ["first", "second"]);
  assert.equal(result.confidence, "low");
});
