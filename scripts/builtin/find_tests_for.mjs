#!/usr/bin/env node
// purpose: list the test files that cover the given source files (named after them or importing them), to know which tests to update and run
// usage: node {script} <file> [more files…]
import { fail, parseArgs, projectRoot, testsFor } from "./lib/common.mjs";

const { rest } = parseArgs();
if (rest.length === 0) fail("usage: find_tests_for.mjs <file> [more files…]");
const root = projectRoot();
for (const [file, tests] of testsFor(root, rest)) {
  console.log(`${file}: ${tests.length > 0 ? "" : "no test found"}`);
  for (const test of tests) console.log(`  ${test}`);
}
