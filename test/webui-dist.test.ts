/**
 * The dist-staleness fence (P0-01): `webui/dist` is committed, so this test
 * recomputes the source hash exactly as `webui/scripts/build-info.mjs` does
 * and fails when it differs from `webui/dist/build.json`. Editing anything
 * under `webui/src` (or the config files) without running `npm run web:build`
 * turns this test red; rebuilding turns it green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const webuiDir = join(repoRoot, "webui");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** The source hash, computed the same way `build-info.mjs` computes it. */
export function sourceHash(): { hash: string; files: { path: string; sha256: string }[] } {
  const required = [
    join(webuiDir, "index.html"),
    join(webuiDir, "vite.config.ts"),
    join(webuiDir, "components.json"),
    join(webuiDir, "tsconfig.json"),
    ...walk(join(webuiDir, "src")),
  ];
  const optional = [join(repoRoot, "src/lobby/prompts.ts"), join(repoRoot, "src/webui/protocol.ts")].filter((file) => existsSync(file));
  const files = [...required, ...optional]
    .sort()
    .map((file) => ({ path: relative(repoRoot, file).split("\\").join("/"), sha256: sha256(file) }));
  const hash = createHash("sha256")
    .update(files.map((file) => `${file.path}:${file.sha256}`).join("\n"))
    .digest("hex");
  return { hash, files };
}

test("webui/dist matches the committed sources", () => {
  const buildPath = join(webuiDir, "dist", "build.json");
  assert.ok(existsSync(buildPath), "webui/dist/build.json is committed — run npm run web:build");
  const build = JSON.parse(readFileSync(buildPath, "utf8")) as { hash: string };
  const { hash } = sourceHash();
  assert.equal(hash, build.hash, "webui/dist is stale — run npm run web:build and commit the result");
});
