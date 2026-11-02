import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The browser-fixture freshness guard: the same source hash `web:build`
 * writes into webui/dist/build.json, recomputed before fixtures start. Direct
 * `playwright test` invocation fails loudly when the built assets are stale —
 * browser tests never silently serve assets built from other sources.
 */
const here = dirname(fileURLToPath(import.meta.url));
const webuiDir = resolve(here, "..");
const repoRoot = resolve(webuiDir, "..");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const required = [
  join(webuiDir, "index.html"),
  join(webuiDir, "vite.config.ts"),
  join(webuiDir, "components.json"),
  join(webuiDir, "tsconfig.json"),
  ...walk(join(webuiDir, "src")),
];
const optional = [join(repoRoot, "src/lobby/prompts.ts"), join(repoRoot, "src/webui/protocol.ts")].filter((file) => existsSync(file));
const files = [...required, ...optional].sort().map((file) => ({ path: file.slice(repoRoot.length + 1), sha256: sha256(file) }));
const hash = createHash("sha256").update(files.map((file) => `${file.path}:${file.sha256}`).join("\n")).digest("hex");
const built = join(webuiDir, "dist", "build.json");

export default function freshness() {
  if (!existsSync(built)) throw new Error(`No built assets at webui/dist/build.json. Run \`npm run web:build\` (or \`node scripts/verify-final.ts\`) before the browser fixtures.`);
  try {
    const recorded = JSON.parse(readFileSync(built, "utf8")).hash;
    if (recorded !== hash) throw new Error(`Built assets are stale (built from different sources). Re-run \`npm run web:build\` before the browser fixtures; they never test stale assets.`);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`webui/dist/build.json is unreadable; re-run \`npm run web:build\`.`);
    throw error;
  }
}
