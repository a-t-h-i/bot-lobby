/**
 * The Settings page's linting wizard: which linters the project configures
 * and whether each is installed, the commands that install (or set up) one,
 * and a short list of common rules per linter that the page can switch.
 *
 * Rules live where the linter reads them, so the editor, CI and the lint gate
 * all agree: Biome's `biome.json`, Oxlint's `.oxlintrc.json` and Ruff's
 * `[lint]` table are edited in place. ESLint's config is code (a flat
 * `eslint.config.js`), which cannot be edited safely, so its rules are kept in
 * bot-lobby's config and passed to the gate's ESLint run as `--rule` flags.
 * A JSON config with comments is not rewritten (that would drop them): its
 * rules read as they are and the page sends the user to the code viewer.
 *
 * Nothing here runs a command: the page types install commands into its own
 * terminal, where the user watches them and answers any prompt.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { LintConfig, LintRuleLevel } from "../schemas/configuration.ts";
import type { LintSetup, LintSetupLinter, LintSetupOffer, RuleChoice } from "../schemas/lint.ts";
import { findLinters, type FoundLinter } from "./lint.ts";

export type { LintRuleInfo, LintSetup, LintSetupLinter, LintSetupOffer, LintSetupStep, RuleChoice } from "../schemas/lint.ts";

interface RuleDef {
  id: string;
  label: string;
  help: string;
}

const RULES: Record<string, RuleDef[]> = {
  ESLint: [
    { id: "no-unused-vars", label: "Unused variables", help: "a variable, argument or import that is never read" },
    { id: "no-console", label: "console calls", help: "console.log and friends left in the code" },
    { id: "no-debugger", label: "debugger statements", help: "a debugger left in" },
    { id: "eqeqeq", label: "Strict equality", help: "=== and !== instead of == and !=" },
    { id: "prefer-const", label: "Prefer const", help: "let that is never reassigned" },
    { id: "no-var", label: "No var", help: "let or const instead of var" },
    { id: "curly", label: "Braces on blocks", help: "braces around every if, else and loop body" },
    { id: "no-empty", label: "Empty blocks", help: "a block with nothing in it" },
  ],
  Biome: [
    { id: "correctness/noUnusedVariables", label: "Unused variables", help: "a variable that is never read" },
    { id: "correctness/noUnusedImports", label: "Unused imports", help: "an import nothing uses" },
    { id: "suspicious/noExplicitAny", label: "Explicit any", help: "a type written as any" },
    { id: "suspicious/noConsole", label: "console calls", help: "console.log and friends left in the code" },
    { id: "suspicious/noDebugger", label: "debugger statements", help: "a debugger left in" },
    { id: "style/useConst", label: "Prefer const", help: "let that is never reassigned" },
    { id: "style/noNonNullAssertion", label: "Non-null assertions", help: "the ! after a value that might be null" },
    { id: "complexity/noForEach", label: "No forEach", help: "for…of instead of .forEach" },
  ],
  Oxlint: [
    { id: "no-unused-vars", label: "Unused variables", help: "a variable, argument or import that is never read" },
    { id: "no-console", label: "console calls", help: "console.log and friends left in the code" },
    { id: "no-debugger", label: "debugger statements", help: "a debugger left in" },
    { id: "eqeqeq", label: "Strict equality", help: "=== and !== instead of == and !=" },
    { id: "no-empty", label: "Empty blocks", help: "a block with nothing in it" },
    { id: "typescript/no-explicit-any", label: "Explicit any", help: "a type written as any" },
  ],
  Ruff: [
    { id: "F401", label: "Unused imports", help: "F401: an import nothing uses" },
    { id: "E501", label: "Line too long", help: "E501: a line over the configured length" },
    { id: "B", label: "Likely bugs", help: "B: flake8-bugbear's checks for common mistakes" },
    { id: "I", label: "Import order", help: "I: imports sorted as isort sorts them" },
    { id: "UP", label: "Modern syntax", help: "UP: pyupgrade's newer forms for your Python version" },
    { id: "SIM", label: "Simpler code", help: "SIM: flake8-simplify's shorter equivalents" },
    { id: "T20", label: "print calls", help: "T20: print and pprint left in the code" },
    { id: "N", label: "Naming", help: "N: pep8-naming's names for classes, functions and variables" },
  ],
};

const LEVELS: Record<string, LintRuleLevel[]> = { ESLint: ["off", "warn", "error"], Biome: ["off", "warn", "error"], Oxlint: ["off", "warn", "error"], Ruff: ["off", "error"] };

export class LintSetupError extends Error {}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

const rel = (top: string, path: string) => relative(top, path).split("\\").join("/");

/** Folders from `start` up to `top`, nearest first. */
function upward(start: string, top: string): string[] {
  const out: string[] = [];
  let folder = start;
  for (;;) {
    out.push(folder);
    if (folder === top) break;
    const parent = dirname(folder);
    if (parent === folder || rel(top, parent).startsWith("..")) break;
    folder = parent;
  }
  return out;
}

type NodeManager = "npm" | "pnpm" | "yarn" | "bun";

function nodeManager(folder: string, top: string): NodeManager {
  for (const at of upward(folder, top)) {
    if (existsSync(join(at, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(at, "yarn.lock"))) return "yarn";
    if (existsSync(join(at, "bun.lock")) || existsSync(join(at, "bun.lockb"))) return "bun";
    if (existsSync(join(at, "package-lock.json"))) return "npm";
  }
  return "npm";
}

const ADD_DEV: Record<NodeManager, string> = { npm: "npm install -D", pnpm: "pnpm add -D", yarn: "yarn add -D", bun: "bun add -d" };
const RUN_BIN: Record<NodeManager, string> = { npm: "npx", pnpm: "pnpm exec", yarn: "yarn", bun: "bunx" };

function pythonAdd(folder: string, top: string): string {
  for (const at of upward(folder, top)) {
    if (existsSync(join(at, "uv.lock"))) return "uv add --dev ruff";
    if (existsSync(join(at, "poetry.lock"))) return "poetry add --group dev ruff";
  }
  return "python -m pip install ruff";
}

/** A command run from `folder` (repository-relative) in a terminal that starts at the top. */
function inFolder(folder: string, command: string): string {
  return folder ? `cd ${/^[\w./-]+$/.test(folder) ? folder : JSON.stringify(folder)} && ${command}` : command;
}

function installCommands(tool: string, folder: string, top: string): string[] {
  const at = join(top, folder);
  if (tool === "Ruff") return [inFolder(folder, pythonAdd(at, top))];
  const manager = nodeManager(at, top);
  if (tool === "ESLint") return [inFolder(folder, `${ADD_DEV[manager]} eslint @eslint/js`)];
  if (tool === "Biome") return [inFolder(folder, `${ADD_DEV[manager]} -E @biomejs/biome`)];
  if (tool === "Oxlint") return [inFolder(folder, `${ADD_DEV[manager]} oxlint`)];
  return [];
}

// ---------------------------------------------------------------------------
// JSON configs (Biome, Oxlint)

interface JsonFile {
  path: string;
  data?: Record<string, unknown>;
  indent: string;
  /** Why it cannot be rewritten. */
  locked?: string;
}

function readJson(path: string): JsonFile {
  const text = readText(path) ?? "";
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return { path, indent, locked: "is not a JSON object" };
    return { path, data: data as Record<string, unknown>, indent };
  } catch {
    return { path, indent, locked: "has comments or is not plain JSON, so switching rules here would rewrite it; edit it in the code viewer" };
  }
}

function writeJson(file: JsonFile): void {
  writeFileSync(file.path, `${JSON.stringify(file.data, null, file.indent)}\n`);
}

function levelOf(value: unknown): RuleChoice {
  const raw = Array.isArray(value) ? value[0] : value && typeof value === "object" ? (value as { level?: unknown }).level : value;
  if (raw === "off" || raw === "allow" || raw === 0 || raw === "0") return "off";
  if (raw === "warn" || raw === "info" || raw === 1 || raw === "1") return "warn";
  if (raw === "error" || raw === "deny" || raw === "on" || raw === 2 || raw === "2") return "error";
  return "default";
}

function child(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  const made: Record<string, unknown> = {};
  parent[key] = made;
  return made;
}

/** Biome: `linter.rules.<group>.<name>`, a level or `{ level, options }` (whose options are kept). */
function biomeRule(data: Record<string, unknown>, id: string, level?: RuleChoice): RuleChoice {
  const [group, name] = id.split("/") as [string, string];
  const rules = (data.linter as Record<string, unknown> | undefined)?.rules as Record<string, unknown> | undefined;
  const current = (rules?.[group] as Record<string, unknown> | undefined)?.[name];
  if (level === undefined) return levelOf(current);
  const groupNode = child(child(child(data, "linter"), "rules"), group);
  if (level === "default") delete groupNode[name];
  else if (current && typeof current === "object" && !Array.isArray(current)) groupNode[name] = { ...(current as object), level };
  else groupNode[name] = level;
  return level;
}

/** Oxlint: `rules.<name>`, a level or `[level, options]`. */
function oxlintRule(data: Record<string, unknown>, id: string, level?: RuleChoice): RuleChoice {
  const current = (data.rules as Record<string, unknown> | undefined)?.[id];
  if (level === undefined) return levelOf(current);
  const rules = child(data, "rules");
  if (level === "default") delete rules[id];
  else rules[id] = Array.isArray(current) ? [level, ...current.slice(1)] : level;
  return level;
}

// ---------------------------------------------------------------------------
// Ruff's TOML: only the `extend-select` and `ignore` arrays of its lint table are touched.

interface RuffFile {
  path: string;
  /** `[lint]` in ruff.toml, `[tool.ruff.lint]` in pyproject.toml. */
  header: string;
}

function ruffFile(folder: string): RuffFile | undefined {
  for (const name of [".ruff.toml", "ruff.toml"]) if (existsSync(join(folder, name))) return { path: join(folder, name), header: "lint" };
  const pyproject = join(folder, "pyproject.toml");
  if (/^\[tool\.ruff[\].]/m.test(readText(pyproject) ?? "")) return { path: pyproject, header: "tool.ruff.lint" };
  return undefined;
}

/** The lint table's body: where it starts and ends in `text` (end is the next table or the end). */
function tableSpan(text: string, header: string): { start: number; end: number } | undefined {
  const match = new RegExp(`^\\[${header.replace(/\./g, "\\.")}\\][ \\t]*(?:#.*)?$`, "m").exec(text);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const next = /^\[/m.exec(text.slice(start));
  return { start, end: next ? start + next.index : text.length };
}

/** `key = [ ... ]` inside the span: where it is and the codes in it. */
function tomlArray(text: string, span: { start: number; end: number }, key: string): { start: number; end: number; items: string[] } | undefined {
  const body = text.slice(span.start, span.end);
  const match = new RegExp(`^[ \\t]*${key.replace(/-/g, "\\-")}[ \\t]*=[ \\t]*\\[`, "m").exec(body);
  if (!match) return undefined;
  const open = span.start + match.index + match[0].length;
  const close = text.indexOf("]", open);
  if (close < 0 || close > span.end) return undefined;
  const items = [...text.slice(open, close).matchAll(/"([^"]*)"|'([^']*)'/g)].map((found) => found[1] ?? found[2] ?? "").filter(Boolean);
  let end = close + 1;
  while (end < text.length && text[end] !== "\n") end += 1;
  return { start: span.start + match.index, end, items };
}

function ruffArrays(text: string, header: string): { select: string[]; ignore: string[] } {
  const span = tableSpan(text, header);
  if (!span) return { select: [], ignore: [] };
  return {
    select: [...(tomlArray(text, span, "select")?.items ?? []), ...(tomlArray(text, span, "extend-select")?.items ?? [])],
    ignore: [...(tomlArray(text, span, "ignore")?.items ?? []), ...(tomlArray(text, span, "extend-ignore")?.items ?? [])],
  };
}

function ruffLevel(text: string, header: string, id: string): RuleChoice {
  const { select, ignore } = ruffArrays(text, header);
  if (ignore.includes(id)) return "off";
  if (select.includes(id)) return "error";
  return "default";
}

function setTomlArray(text: string, header: string, key: string, change: (items: string[]) => string[]): string {
  let span = tableSpan(text, header);
  if (!span) {
    const items = change([]);
    if (items.length === 0) return text;
    const lead = text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return `${text}${lead}[${header}]\n${key} = ${JSON.stringify(items).replace(/,/g, ", ")}\n`;
  }
  const found = tomlArray(text, span, key);
  const items = change(found?.items ?? []);
  const line = `${key} = ${JSON.stringify(items).replace(/,/g, ", ")}`;
  if (found) return items.length === 0 ? text.slice(0, found.start) + text.slice(found.end + 1) : text.slice(0, found.start) + line + text.slice(found.end);
  if (items.length === 0) return text;
  span = tableSpan(text, header)!;
  return `${text.slice(0, span.start)}\n${line}${text.slice(span.start)}`;
}

function setRuffRule(file: RuffFile, id: string, level: RuleChoice): void {
  let text = readText(file.path) ?? "";
  const without = (items: string[]) => items.filter((item) => item !== id);
  text = setTomlArray(text, file.header, "extend-select", (items) => (level === "error" ? [...without(items), id] : without(items)));
  text = setTomlArray(text, file.header, "ignore", (items) => (level === "off" ? [...without(items), id] : without(items)));
  writeFileSync(file.path, text);
}

// ---------------------------------------------------------------------------

function jsonConfig(tool: string, folder: string): string | undefined {
  const names = tool === "Biome" ? ["biome.json", "biome.jsonc"] : tool === "Oxlint" ? [".oxlintrc.json"] : [];
  return names.map((name) => join(folder, name)).find((path) => existsSync(path));
}

function eslintConfig(folder: string): string | undefined {
  const names = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts", ".eslintrc.json", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yml", ".eslintrc.yaml", "package.json"];
  return names.map((name) => join(folder, name)).find((path) => existsSync(path));
}

function describe(found: FoundLinter, top: string, config: Pick<LintConfig, "eslintRules">): LintSetupLinter {
  const folder = join(top, found.folder);
  const defs = RULES[found.tool] ?? [];
  const base = { ...found, levels: LEVELS[found.tool] ?? ["off", "warn", "error"], install: found.installed ? [] : installCommands(found.tool, found.folder, top) };
  if (found.tool === "ESLint") {
    const path = eslintConfig(folder);
    return {
      ...base,
      ...(path ? { config: rel(top, path) } : {}),
      rulesAt: "gate",
      rules: defs.map((def) => ({ ...def, level: config.eslintRules[def.id] ?? "default" })),
      note: "ESLint's config is code, so these are added when the lint gate runs ESLint (as --rule flags), on top of the project's config. To make one the project's own, add it to the config.",
    };
  }
  if (found.tool === "Ruff") {
    const file = ruffFile(folder);
    const text = file ? readText(file.path) ?? "" : "";
    return {
      ...base,
      ...(file ? { config: rel(top, file.path) } : {}),
      rulesAt: file ? "file" : "read",
      rules: defs.map((def) => ({ ...def, level: file ? ruffLevel(text, file.header, def.id) : "default" })),
      ...(file ? {} : { note: "No Ruff config file was found to write to." }),
    };
  }
  const path = jsonConfig(found.tool, folder);
  const file = path ? readJson(path) : undefined;
  const read = (def: RuleDef): RuleChoice => (file?.data ? (found.tool === "Biome" ? biomeRule(file.data, def.id) : oxlintRule(file.data, def.id)) : "default");
  return {
    ...base,
    ...(path ? { config: rel(top, path) } : {}),
    rulesAt: file?.data ? "file" : "read",
    rules: defs.map((def) => ({ ...def, level: read(def) })),
    ...(file?.locked && path ? { note: `${rel(top, path)} ${file.locked}.` } : {}),
  };
}

const JS_TOOLS = ["ESLint", "Biome", "Oxlint"];

function offers(top: string, found: FoundLinter[]): LintSetupOffer[] {
  const js = existsSync(join(top, "package.json"));
  const python = ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg"].some((name) => existsSync(join(top, name)));
  const hasJs = found.some((linter) => JS_TOOLS.includes(linter.tool));
  const hasRuff = found.some((linter) => linter.tool === "Ruff");
  const either = !js && !python;
  const manager = nodeManager(top, top);
  const out: LintSetupOffer[] = [];
  if ((js || either) && !hasJs) {
    out.push(
      { tool: "ESLint", blurb: "The most widely used JavaScript and TypeScript linter, with a plugin for nearly everything.", steps: [{ label: "Install and create a config (it asks a few questions)", command: "npm init @eslint/config@latest" }] },
      { tool: "Biome", blurb: "One fast tool that lints and formats JavaScript, TypeScript, JSON and CSS.", steps: [{ label: "Install", command: `${ADD_DEV[manager]} -E @biomejs/biome` }, { label: "Create biome.json", command: `${RUN_BIN[manager]} biome init` }] },
      { tool: "Oxlint", blurb: "A very fast linter with ESLint's common rules built in.", steps: [{ label: "Install", command: `${ADD_DEV[manager]} oxlint` }, { label: "Create .oxlintrc.json", command: `${RUN_BIN[manager]} oxlint --init` }] },
    );
  }
  if ((python || either) && !hasRuff) {
    out.push({ tool: "Ruff", blurb: "A very fast Python linter that covers Flake8, isort, pyupgrade and more.", steps: [{ label: "Install", command: pythonAdd(top, top) }, { label: "Create ruff.toml", create: "ruff.toml" }] });
  }
  return out;
}

/** Everything the wizard shows. */
export function lintSetup(top: string, config: Pick<LintConfig, "eslintRules">, found: FoundLinter[] = findLinters(top)): LintSetup {
  return { linters: found.map((linter) => describe(linter, top, config)), offers: offers(top, found) };
}

/**
 * Switch one rule of a found linter. For ESLint the caller saves the returned
 * `eslintRules`; for the others the config file is written here.
 */
export function setLintRule(top: string, config: Pick<LintConfig, "eslintRules">, change: { tool: string; folder: string; rule: string; level: RuleChoice }): { eslintRules?: LintConfig["eslintRules"] } {
  const defs = RULES[change.tool];
  if (!defs?.some((def) => def.id === change.rule)) throw new LintSetupError(`${change.rule} is not one of ${change.tool}'s rules here.`);
  if (change.level !== "default" && !(LEVELS[change.tool] ?? []).includes(change.level)) throw new LintSetupError(`${change.tool} has no ${change.level} level.`);
  const found = findLinters(top).find((linter) => linter.tool === change.tool && linter.folder === change.folder);
  if (!found) throw new LintSetupError(`${change.tool} is not configured in ${change.folder || "the project root"}.`);
  const folder = join(top, found.folder);
  if (change.tool === "ESLint") {
    const rules = { ...config.eslintRules };
    if (change.level === "default") delete rules[change.rule];
    else rules[change.rule] = change.level;
    return { eslintRules: rules };
  }
  if (change.tool === "Ruff") {
    const file = ruffFile(folder);
    if (!file) throw new LintSetupError("No Ruff config file was found to write to.");
    setRuffRule(file, change.rule, change.level);
    return {};
  }
  const path = jsonConfig(change.tool, folder);
  const file = path ? readJson(path) : undefined;
  if (!path || !file?.data) throw new LintSetupError(path && file?.locked ? `${rel(top, path)} ${file.locked}.` : `No ${change.tool} config file was found to write to.`);
  if (change.tool === "Biome") biomeRule(file.data, change.rule, change.level);
  else oxlintRule(file.data, change.rule, change.level);
  writeJson(file);
  return {};
}

const RUFF_STARTER = `# Ruff's settings: https://docs.astral.sh/ruff/configuration/
line-length = 100

[lint]
# Pyflakes and pycodestyle errors are on by default; these add a few common families.
extend-select = ["I", "B", "UP"]
ignore = []
`;

/** Write a starter config at the project's top (Ruff only; the JavaScript linters create their own with an init command). */
export function createLintConfig(top: string, name: string): string {
  if (name !== "ruff.toml") throw new LintSetupError(`bot-lobby does not create ${name}; run the linter's own init command.`);
  const path = join(top, name);
  if (existsSync(path)) throw new LintSetupError(`${name} already exists.`);
  writeFileSync(path, RUFF_STARTER);
  return name;
}
