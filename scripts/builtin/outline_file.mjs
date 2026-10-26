#!/usr/bin/env node
// purpose: outline a source file: its imports count, top-level functions, classes, types and exports with line numbers, so only the needed range is read; each function shows its length and deepest nesting, and long or deep ones are flagged
// usage: node {script} <file> [more files…] [--complex]  (--complex lists only the flagged functions)
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { declarations, fail, parseArgs } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
// `--complex file.ts` reads the file as the flag's value.
if (typeof flags.complex === "string") rest.unshift(flags.complex);
const LONG = 60;
const DEEP = 4;
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
  // Length and deepest nesting of each declaration, by brackets (or indentation in Python).
  const spans = new Map(declarations(text, file).map((decl) => [decl.start, decl]));
  const strip = (row) => row.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "").replace(/\/\/.*$/, "");
  const measure = (decl) => {
    let depth = 0;
    let deepest = 0;
    let end = decl.end;
    let opened = false;
    for (let i = decl.start - 1; i < decl.end; i++) {
      const row = rows[i];
      if (file.endsWith(".py")) {
        if (row.trim()) deepest = Math.max(deepest, Math.floor((row.length - row.trimStart().length - decl.indent) / 4) - 1);
        continue;
      }
      for (const ch of strip(row)) {
        if (ch === "{") { opened = true; deepest = Math.max(deepest, ++depth - 1); }
        else if (ch === "}") depth -= 1;
      }
      // The body ends where its brackets close; a one-line statement ends on its own line.
      if ((opened && depth <= 0) || (!opened && /;\s*$/.test(row))) { end = i + 1; break; }
    }
    return { length: end - decl.start + 1, depth: Math.max(0, deepest) };
  };
  const flagged = [];
  const out = [];
  rows.forEach((row, index) => {
    if (!patterns.some((pattern) => pattern.test(row))) return;
    const decl = spans.get(index + 1);
    const size = decl && decl.end > decl.start ? measure(decl) : undefined;
    // A class or interface is long by nature; only functions are flagged.
    const warn = size && !/\b(class|interface|type|enum|struct|trait|impl)\s/.test(row) && (size.length > LONG || size.depth > DEEP);
    if (warn) flagged.push(decl.name);
    if (!flags.complex || warn) out.push(`${String(index + 1).padStart(5)}  ${row.trim().replace(/\s*\{\s*$/, "").slice(0, 120)}${size ? `  [${size.length} lines, depth ${size.depth}${warn ? " !" : ""}]` : ""}`);
  });
  console.log(`## ${file} (${rows.length} lines, ${imports} imports${flagged.length ? `, ${flagged.length} long or deeply nested: over ${LONG} lines or ${DEEP} levels, marked !` : ""})`);
  for (const row of out) console.log(row);
}
