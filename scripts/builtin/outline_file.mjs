#!/usr/bin/env node
// purpose: outline a source file: its imports count, top-level functions, classes, types and exports with line numbers, so only the needed range is read
// usage: node {script} <file> [more files…]
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { fail, parseArgs } from "./lib/common.mjs";

const { rest } = parseArgs();
if (rest.length === 0) fail("usage: outline_file.mjs <file> [more files…]");
const JS = [
  /^\s*export\s+(default\s+)?(async\s+)?function\*?\s+([\w$]+)/,
  /^\s*(async\s+)?function\*?\s+([\w$]+)/,
  /^\s*export\s+(default\s+)?(abstract\s+)?class\s+([\w$]+)/,
  /^\s*(abstract\s+)?class\s+([\w$]+)/,
  /^\s*export\s+(interface|type|enum)\s+([\w$]+)/,
  /^\s*(interface|type|enum)\s+([\w$]+)/,
  /^\s*export\s+const\s+([\w$]+)/,
  /^\s*const\s+([\w$]+)\s*=\s*(async\s*)?(\(|function|[\w$]+\s*=>)/,
  /^\s{2,4}(public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+)*([\w$]+)\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*$/,
  /^\s*(describe|test|it)\(["'`]/,
];
const PY = [/^\s*(async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/];
const GO = [/^func\s+(\([^)]*\)\s*)?(\w+)/, /^type\s+(\w+)/];
const RS = [/^\s*(pub(\([^)]*\))?\s+)?(async\s+)?fn\s+(\w+)/, /^\s*(pub\s+)?(struct|enum|trait|impl|mod)\b/];
const PATTERNS = { ".py": PY, ".go": GO, ".rs": RS };
for (const file of rest) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.log(`## ${file}: cannot read`);
    continue;
  }
  const rows = text.split("\n");
  const patterns = PATTERNS[extname(file)] ?? JS;
  const imports = rows.filter((row) => /^\s*(import\s|from\s+\S+\s+import|use\s|require\()/.test(row)).length;
  console.log(`## ${file} (${rows.length} lines, ${imports} imports)`);
  rows.forEach((row, index) => {
    if (patterns.some((pattern) => pattern.test(row))) console.log(`${String(index + 1).padStart(5)}  ${row.trim().replace(/\s*\{\s*$/, "").slice(0, 130)}`);
  });
}
