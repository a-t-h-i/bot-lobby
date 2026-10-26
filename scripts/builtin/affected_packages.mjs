#!/usr/bin/env node
// purpose: in a monorepo, list the workspace packages the branch changed and every package that depends on them (directly or through others), with the command to test each, so only affected packages are built and tested
// usage: node {script} [--base <ref>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { baseRef, changedFiles, detect, parseArgs, projectRoot, readJson } from "./lib/common.mjs";

const { flags } = parseArgs();
const root = projectRoot();
const { pkg, pm } = detect(root);

/** Workspace globs from package.json, pnpm-workspace.yaml, Cargo.toml and go.work. */
function patterns() {
  const out = [];
  const ws = pkg?.workspaces;
  out.push(...(Array.isArray(ws) ? ws : ws?.packages ?? []));
  const yaml = (() => { try { return readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"); } catch { return ""; } })();
  const block = /packages:\s*\n((?:\s*-.*\n?)+)/.exec(yaml);
  if (block) out.push(...block[1].split("\n").map((row) => row.replace(/^\s*-\s*/, "").replace(/['"]/g, "").trim()).filter(Boolean));
  const cargo = (() => { try { return readFileSync(join(root, "Cargo.toml"), "utf8"); } catch { return ""; } })();
  const members = /\[workspace\][^[]*?members\s*=\s*\[([^\]]*)\]/s.exec(cargo);
  if (members) out.push(...[...members[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
  const gowork = (() => { try { return readFileSync(join(root, "go.work"), "utf8"); } catch { return ""; } })();
  for (const m of gowork.matchAll(/^\s*(?:use\s+)?(\.\/[\w./-]+)\s*$/gm)) out.push(m[1].replace(/^\.\//, ""));
  return out.filter((pattern) => !pattern.startsWith("!"));
}

/** Folders a workspace glob names (`*` one level, `**` any depth). */
function expand(pattern) {
  const parts = pattern.replace(/^\.\//, "").replace(/\/$/, "").split("/");
  let dirs = [""];
  for (const part of parts) {
    const next = [];
    for (const dir of dirs) {
      const here = join(root, dir);
      if (part === "**") {
        const walk = (rel, depth) => {
          next.push(rel);
          if (depth > 4) return;
          for (const name of safeList(join(root, rel))) if (!name.startsWith(".") && name !== "node_modules") walk(join(rel, name), depth + 1);
        };
        walk(dir, 0);
      } else if (part.includes("*")) {
        const re = new RegExp(`^${part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
        for (const name of safeList(here)) if (re.test(name)) next.push(join(dir, name));
      } else if (existsSync(join(here, part))) next.push(join(dir, part));
    }
    dirs = next;
  }
  return dirs.filter((dir) => dir && ["package.json", "Cargo.toml", "go.mod", "pyproject.toml"].some((file) => existsSync(join(root, dir, file))));
}
function safeList(dir) {
  try {
    return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
  } catch {
    return [];
  }
}

const packages = new Map();
for (const dir of new Set(patterns().flatMap(expand))) {
  const json = readJson(join(root, dir, "package.json"));
  const cargo = (() => { try { return readFileSync(join(root, dir, "Cargo.toml"), "utf8"); } catch { return ""; } })();
  const gomod = (() => { try { return readFileSync(join(root, dir, "go.mod"), "utf8"); } catch { return ""; } })();
  const name = json?.name ?? /^\s*name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? /^module\s+(\S+)/m.exec(gomod)?.[1] ?? dir;
  const deps = new Set([
    ...Object.keys({ ...json?.dependencies, ...json?.devDependencies, ...json?.peerDependencies, ...json?.optionalDependencies }),
    ...[...cargo.matchAll(/^\s*([\w-]+)\s*=\s*\{[^}]*path\s*=/gm)].map((m) => m[1]),
    ...[...gomod.matchAll(/^\s*(?:require\s+)?(\S+)\s+v[\d.]+/gm)].map((m) => m[1]),
  ]);
  packages.set(name, { name, dir, deps, json: Boolean(json), cargo: Boolean(cargo), go: Boolean(gomod) });
}
if (packages.size === 0) {
  console.log("Not a monorepo: no workspaces declared (package.json workspaces, pnpm-workspace.yaml, Cargo workspace or go.work). The whole project is one package.");
  process.exit(0);
}

const base = baseRef(root, flags.base);
const changed = changedFiles(root, base);
const owner = (file) => [...packages.values()].filter((p) => file === p.dir || file.startsWith(`${p.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
const direct = new Map();
const outside = [];
for (const file of changed) {
  const p = owner(file);
  if (p) direct.set(p.name, [...(direct.get(p.name) ?? []), file]);
  else outside.push(file);
}
// Reverse edges: who depends on whom inside the workspace.
const dependents = new Map();
for (const p of packages.values()) for (const dep of p.deps) if (packages.has(dep)) dependents.set(dep, [...(dependents.get(dep) ?? []), p.name]);
const reached = new Map();
const queue = [...direct.keys()];
while (queue.length) {
  const name = queue.shift();
  for (const user of dependents.get(name) ?? []) if (!direct.has(user) && !reached.has(user)) { reached.set(user, name); queue.push(user); }
}
const test = (p) => p.json ? (pm === "pnpm" ? `pnpm --filter ${p.name} test` : pm === "yarn" ? `yarn workspace ${p.name} test` : pm === "bun" ? `bun --filter ${p.name} test` : `npm test -w ${p.dir}`) : p.cargo ? `cargo test -p ${p.name}` : p.go ? `go test ./${p.dir}/...` : `(cd ${p.dir} && run its tests)`;

console.log(`# ${packages.size} workspace package(s); ${direct.size} changed, ${reached.size} more depend on them`);
for (const [name, files] of direct) console.log(`changed  ${name} (${packages.get(name).dir}, ${files.length} file(s))  →  ${test(packages.get(name))}`);
for (const [name, via] of reached) console.log(`affected ${name} (${packages.get(name).dir}, through ${via})  →  ${test(packages.get(name))}`);
if (outside.length) {
  const shared = outside.filter((file) => /(^|\/)(package\.json|pnpm-workspace\.yaml|tsconfig[\w.]*\.json|Cargo\.toml|go\.work|\.github\/|turbo\.json|nx\.json|babel\.config|eslint|vite\.config|jest\.config|vitest\.config)/.test(file));
  console.log(`## ${outside.length} changed file(s) outside every package${shared.length ? `; root config changed (${shared.slice(0, 5).join(", ")}), so every package may be affected` : ""}`);
}
if (direct.size === 0 && outside.length === 0) console.log("Nothing changed.");
