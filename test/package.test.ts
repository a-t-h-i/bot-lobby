import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Packages Pi resolves at runtime for extensions; npm installs with --omit=peer. */
const PI_SUPPLIED = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
] as const;

interface Manifest {
  name?: string;
  license?: string;
  private?: boolean;
  keywords?: string[];
  files?: string[];
  publishConfig?: { access?: string };
  pi?: { extensions?: string[] };
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Manifest;

test("publish manifest identifies the scoped public package", () => {
  assert.equal(pkg.name, "@a-t-h-i/bot-lobby");
  assert.equal(pkg.license, "Apache-2.0");
  assert.notEqual(pkg.private, true);
  assert.ok(pkg.keywords?.includes("pi-package"), "gallery discovery keyword");
  assert.equal(pkg.publishConfig?.access, "public");
});

test("file allowlist ships the extension entry and prompt layers", () => {
  assert.ok(pkg.pi?.extensions?.includes("./src/index.ts"));
  for (const entry of ["src", "prompts"]) {
    assert.ok(pkg.files?.includes(entry), `files must include ${entry}`);
    const dir = fileURLToPath(new URL(`../${entry}`, import.meta.url));
    assert.ok(existsSync(dir), `${entry}/ must exist to be packed`);
  }
});

test("Pi supplies its runtime packages as peer dependencies only", () => {
  for (const name of PI_SUPPLIED) {
    assert.equal(pkg.peerDependencies?.[name], "*", `${name} peer range`);
    assert.equal(pkg.dependencies?.[name], undefined, `${name} hard dependency`);
  }
});
