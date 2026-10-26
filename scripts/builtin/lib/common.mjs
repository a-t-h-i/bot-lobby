// Shared helpers for bot-lobby's built-in scripts. Read-only: nothing here writes, commits or pushes.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/** Run a command; never throws. */
export function sh(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  return { code: result.status ?? (result.error ? 127 : 1), out: result.stdout ?? "", err: result.stderr ?? (result.error ? String(result.error.message) : "") };
}

export function lines(text) {
  return text.split("\n").map((line) => line.trimEnd()).filter(Boolean);
}

/** The project's root: the git top level, else where the script was run. */
export function projectRoot() {
  const git = sh("git", ["rev-parse", "--show-toplevel"]);
  return git.code === 0 ? git.out.trim() : process.cwd();
}

/** `--name value` / `--flag` options and the rest as positional arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    // The script's own header says what it does and how to run it.
    const head = readFileSync(process.argv[1], "utf8").split("\n").slice(0, 6);
    for (const row of head) if (/^\/\/\s*(purpose|usage):/.test(row)) console.log(row.replace(/^\/\/\s*/, "").replace("{script}", process.argv[1]));
    process.exit(0);
  }
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
      else flags[key] = true;
    } else rest.push(arg);
  }
  return { flags, rest };
}

/** The ref the branch is compared with: `--base`, else the merge base with the default branch, else HEAD. */
export function baseRef(root, asked) {
  if (typeof asked === "string") return asked;
  for (const ref of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
    const base = sh("git", ["merge-base", "HEAD", ref], { cwd: root });
    if (base.code === 0 && base.out.trim()) {
      const head = sh("git", ["rev-parse", "HEAD"], { cwd: root }).out.trim();
      // On the default branch itself, compare with the working tree only.
      return base.out.trim() === head ? "HEAD" : base.out.trim();
    }
  }
  return "HEAD";
}

/** Files changed since `base`: committed on the branch, staged, unstaged and new (untracked, not ignored). */
export function changedFiles(root, base) {
  const files = new Set();
  const add = (text) => lines(text).forEach((file) => files.add(file));
  if (base !== "HEAD") add(sh("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`], { cwd: root }).out);
  add(sh("git", ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], { cwd: root }).out);
  add(sh("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root }).out);
  return [...files].filter((file) => existsSync(join(root, file))).sort();
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** What the project is built with. */
export function detect(root) {
  const pkg = readJson(join(root, "package.json"));
  const pm = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(root, "yarn.lock")) ? "yarn" : existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")) ? "bun" : "npm";
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  return {
    pkg,
    pm,
    deps,
    python: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pytest.ini", "tox.ini"].some((file) => existsSync(join(root, file))),
    go: existsSync(join(root, "go.mod")),
    rust: existsSync(join(root, "Cargo.toml")),
  };
}

/** `npm run x` / `pnpm x` / `yarn x` / `bun run x`. */
export function runScript(pm, name) {
  return pm === "npm" ? `npm run ${name}` : pm === "bun" ? `bun run ${name}` : `${pm} ${name}`;
}

const TEST_FILE = /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/;

export function isTest(file) {
  return TEST_FILE.test(file);
}

const CODE = /\.(c|m)?[jt]sx?$|\.(py|go|rs|rb|java|kt|swift|vue|svelte|cs|php)$/;

export function isCode(file) {
  return CODE.test(file);
}

function stemOf(file) {
  return basename(file, extname(file)).replace(/\.(test|spec)$/, "").replace(/^test_/, "").replace(/_test$/, "");
}

/** Test files that cover these files: the tests themselves, tests named after them, and tests that import them. */
export function testsFor(root, files, all = lines(sh("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root }).out)) {
  const tests = all.filter(isTest);
  const found = new Map();
  for (const file of files) {
    const hits = new Set();
    if (isTest(file)) hits.add(file);
    else if (isCode(file)) {
      const stem = stemOf(file);
      if (stem.length < 3 || stem === "index") {
        // An index is named after its folder.
        const folder = basename(dirname(file));
        for (const test of tests) if (stemOf(test) === folder) hits.add(test);
      } else {
        for (const test of tests) if (stemOf(test) === stem) hits.add(test);
        // Tests that import it by name.
        const importers = sh("git", ["grep", "-l", "-E", `(from|import|require\\().*[/'"]${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[a-z]+)?['"]`, "--", ...new Set(tests.map((test) => test.split("/")[0]))], { cwd: root });
        for (const test of lines(importers.out)) if (isTest(test)) hits.add(test);
      }
    }
    found.set(file, [...hits].sort());
  }
  return found;
}

/** Keep the last `max` lines, saying how many were cut. */
export function tail(text, max = 120) {
  const rows = text.trimEnd().split("\n");
  return rows.length <= max ? rows.join("\n") : [`… ${rows.length - max} earlier lines cut`, ...rows.slice(-max)].join("\n");
}

export function fail(message) {
  console.error(message);
  process.exit(2);
}
