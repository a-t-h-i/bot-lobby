#!/usr/bin/env node
// purpose: list the test helpers already in the project (fixtures, mocks, fakes, factories, stubs, test utilities, pytest fixtures) with what each exports and how many tests use it, so a new test reuses them instead of writing its own
// usage: node {script} [word to filter by]
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { isCode, isNoise, isTest, parseArgs, projectRoot, sh, tracked } from "./lib/common.mjs";

const { rest } = parseArgs();
const word = rest[0]?.toLowerCase();
const root = projectRoot();
const all = tracked(root).filter((file) => !isNoise(file));
const DIR = /(^|\/)(fixtures?|__fixtures__|__mocks__|mocks?|factories|stubs?|fakes?|test-?utils?|testing|testdata|test-helpers?|support)\//i;
const NAME = /(^|[-_.])(fixtures?|mocks?|factor(y|ies)|stubs?|fakes?|test-?utils?|testing|helpers?|conftest|setup-?tests?|test-?setup)([-_.]|$)/i;
const TEST_AREA = /(^|\/)(test|tests|__tests__|spec|e2e)\//;
const helpers = all.filter((file) => {
  // A test itself is not a helper, though everything under test/ counts as "test" to isTest.
  if (/\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/.test(file) && !DIR.test(file)) return false;
  return DIR.test(file) || NAME.test(basename(file, extname(file))) || (TEST_AREA.test(file) && isCode(file));
});
const tests = all.filter((file) => isTest(file));
const read = (file) => { try { return readFileSync(join(root, file), "utf8"); } catch { return ""; } };

function exportsOf(file, text) {
  if (file.endsWith(".py")) {
    // pytest fixtures first: they are what a test asks for by name.
    const fixtures = [...text.matchAll(/@pytest\.fixture[^\n]*\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?def\s+(\w+)/g)].map((m) => `${m[1]} (fixture)`);
    return [...fixtures, ...[...text.matchAll(/^(?:def|class)\s+([A-Za-z]\w*)/gm)].map((m) => m[1]).filter((name) => !fixtures.some((f) => f.startsWith(`${name} `)))];
  }
  if (file.endsWith(".go")) return [...text.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm)].map((m) => m[1]);
  return [...new Set([
    ...[...text.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|interface|type|enum)\s+([\w$]+)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^export\s+\{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((part) => part.trim().split(/\s+as\s+/).pop()).filter(Boolean)),
    ...[...text.matchAll(/^\s*(?:jest|vi)\.mock\(\s*['"]([^'"]+)/gm)].map((m) => `mocks ${m[1]}`),
  ])];
}

const testText = new Map(tests.map((file) => [file, read(file)]));
function users(file) {
  const stem = basename(file, extname(file)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = file.endsWith(".py") && basename(file) === "conftest.py" ? undefined : new RegExp(`['"/]${stem}(\\.[a-z]+)?['"]|\\b${stem}\\.(json|ya?ml)\\b`);
  if (!re) return [...testText.keys()].filter((test) => test.startsWith(dirname(file) === "." ? "" : `${dirname(file)}/`)).length;
  return [...testText.values()].filter((text) => re.test(text)).length;
}

const code = [];
const data = new Map();
for (const file of helpers) {
  if (isCode(file)) {
    const text = read(file);
    const names = exportsOf(file, text);
    if (word && !file.toLowerCase().includes(word) && !names.some((name) => name.toLowerCase().includes(word))) continue;
    const used = users(file);
    // A helper-sounding name outside the tests that no test uses is not a test helper.
    if (used === 0 && !TEST_AREA.test(file) && !DIR.test(file)) continue;
    code.push({ file, names, used, lines: text.split("\n").length });
  } else if (!word || file.toLowerCase().includes(word)) data.set(dirname(file), [...(data.get(dirname(file)) ?? []), file]);
}
if (code.length === 0 && data.size === 0) {
  console.log(`No test helpers found${word ? ` matching "${word}"` : ""}.`);
  process.exit(0);
}
code.sort((a, b) => b.used - a.used || a.file.localeCompare(b.file));
console.log(`# ${code.length} helper module(s)${data.size ? `, fixture data in ${data.size} folder(s)` : ""}${word ? ` matching "${word}"` : ""}`);
for (const hit of code) {
  console.log(`${hit.file} (${hit.lines} lines, used by ${hit.used} test file(s))`);
  if (hit.names.length) console.log(`    ${hit.names.slice(0, 14).join(", ")}${hit.names.length > 14 ? `, +${hit.names.length - 14}` : ""}`);
}
for (const [dir, files] of data) {
  console.log(`## data ${dir}/ (${files.length})`);
  console.log(`    ${files.slice(0, 10).map((file) => basename(file)).join(", ")}${files.length > 10 ? ", …" : ""}`);
}
const config = sh("git", ["ls-files", "--", "jest.config.*", "vitest.config.*", "playwright.config.*", "pytest.ini", "conftest.py", "**/setupTests.*", "karma.conf.*"], { cwd: root }).out.trim();
if (config) console.log(`## Test setup: ${config.split("\n").join(", ")}`);
