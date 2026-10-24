import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as pi from "@earendil-works/pi-coding-agent";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { peerDependencies?: Record<string, string> };

/** The installed Pi release, resolved the way the extension loader resolves it.
 *  Pi's `exports` map does not expose `package.json` and its main entry is
 *  `import`-only, so resolve the ESM entry with `import.meta.resolve` and walk up. */
function installedVersion(): string {
  const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  let dir = dirname(entry);
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (manifest.name === "@earendil-works/pi-coding-agent") return manifest.version ?? "";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
}

/** Does a `>=a.b.c <d.e.f` peer range admit `version`? (The harness only uses this shape.) */
function satisfiesRange(range: string, version: string): boolean {
  const compare = (a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  };
  for (const part of range.split(/\s+/)) {
    const match = /^(>=|<)(\d+\.\d+\.\d+)$/.exec(part);
    if (!match) return false;
    const order = compare(version, match[2]!);
    if (match[1] === ">=" && order < 0) return false;
    if (match[1] === "<" && order >= 0) return false;
  }
  return true;
}

test("installed Pi satisfies the manifest's peer range", () => {
  const range = pkg.peerDependencies?.["@earendil-works/pi-coding-agent"];
  assert.equal(range, ">=1.4.0 <1.5.0", "manifest pins the verified stable Pi line");
  const version = installedVersion();
  assert.match(version, /^\d+\.\d+\.\d+$/, "Pi is installed with a version");
  assert.ok(satisfiesRange(range!, version), `Pi ${version} is within ${range}`);
});

test("Pi exports the compaction and session facilities the harness builds on", () => {
  for (const name of ["compact", "findCutPoint", "estimateTokens", "DEFAULT_COMPACTION_SETTINGS", "CONFIG_DIR_NAME", "SessionManager"] as const) {
    assert.ok(name in pi, `Pi exports ${name}`);
  }
});

test("Pi's compaction defaults match what the harness's threshold assumes", () => {
  // src/pi/auto-compaction.ts:31 keeps an agent's checkpoint below the window less pi's reserve.
  assert.equal(pi.DEFAULT_COMPACTION_SETTINGS.reserveTokens, 16_384);
  assert.ok(typeof pi.findCutPoint === "function" && typeof pi.compact === "function");
});
