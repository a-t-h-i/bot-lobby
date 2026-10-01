/**
 * The built page: `index.html` gets a fresh CSP nonce per response (every
 * placeholder replaced, the CSP header carrying the same nonce), hashed
 * assets are immutable, and nothing outside the folder is served.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { fakeWebService } from "./webui-fake.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-static-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-static-dist-"));
const HTML = [
  "<!doctype html>",
  '<html><head><meta property="csp-nonce" content="__CSP_NONCE__" />',
  '<script type="module" src="/assets/app.js" nonce="__CSP_NONCE__"></script>',
  '<link rel="stylesheet" href="/assets/app.css" nonce="__CSP_NONCE__">',
  "</head><body></body></html>",
].join("\n");
writeFileSync(join(DIST, "index.html"), HTML);
writeFileSync(join(DIST, "app.js"), "console.log(1)");
writeFileSync(join(DIST, "style.css"), "body{}");

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(port: number, options: { method?: string; path: string; headers?: Record<string, string> }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { host: `127.0.0.1:${port}`, ...options.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Answer["headers"], body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("index.html replaces every nonce placeholder and the CSP carries the same nonce", async () => {
  const server = await startWebServer({ service: fakeWebService(new LobbyFeed()), port: 0, secret: randomBytes(32), dist: DIST });
  try {
    const first = await send(server.port, { path: "/" });
    assert.equal(first.status, 200);
    assert.ok(!first.body.includes("__CSP_NONCE__"), "every placeholder is replaced");
    const raw = first.body.match(/="([A-Za-z0-9+/=]{20,})"/g) ?? [];
    assert.ok(raw.length >= 3, `the meta and the asset nonces are set, got ${raw.length}`);
    const values = raw.map((hit) => /="([A-Za-z0-9+/=]{20,})"/.exec(hit)?.[1]);
    assert.ok(values.every((nonce) => nonce === values[0]), "one nonce per response");
    const nonce = values[0]!;
    const occurrences = first.body.split(nonce).length - 1;
    assert.ok(occurrences >= 3, `the nonce occurs in the body, got ${occurrences}`);
    const csp = String(first.headers["content-security-policy"]);
    assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`), "script-src stays nonce-locked");
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"), "style-src allows Radix inline style attributes");
    const styleSrc = /style-src ([^;]*)/.exec(csp)?.[1] ?? "";
    assert.ok(!styleSrc.includes("'nonce-"), "no nonce in the style-src directive");
    assert.match(csp, /default-src 'self'.*frame-ancestors 'none'/);
    assert.equal(first.headers["cache-control"], "no-store");
    assert.equal(first.headers["x-content-type-options"], "nosniff");
    assert.equal(first.headers["referrer-policy"], "no-referrer");
    assert.equal(first.headers["x-frame-options"], "DENY");
    const second = await send(server.port, { path: "/index.html" });
    const secondMatch = /content="([A-Za-z0-9+/=]{20,})"/.exec(second.body)?.[1];
    assert.ok(secondMatch && secondMatch !== nonce, "a fresh nonce per response");
  } finally {
    await server.close();
  }
});

test("hashed assets are immutable for a year, with their content type", async () => {
  const server = await startWebServer({ service: fakeWebService(new LobbyFeed()), port: 0, secret: randomBytes(32), dist: DIST });
  try {
    const js = await send(server.port, { path: "/app.js" });
    assert.equal(js.status, 200);
    assert.equal(js.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(js.headers["cache-control"], "public, max-age=31536000, immutable");
    const css = await send(server.port, { path: "/style.css" });
    assert.equal(css.status, 200);
    assert.equal(css.headers["content-type"], "text/css; charset=utf-8");
  } finally {
    await server.close();
  }
});

test("traversals, encoded traversals, unknown extensions and missing files are 404", async () => {
  const server = await startWebServer({ service: fakeWebService(new LobbyFeed()), port: 0, secret: randomBytes(32), dist: DIST });
  try {
    for (const path of ["/../server.ts", "/%2e%2e/%2e%2e/etc/passwd", "/..%2fpackage.json", "/missing.js", "/app.ts", "/%2E%2E/nope.js"]) {
      const answer = await send(server.port, { path });
      assert.equal(answer.status, 404, path);
      assert.equal((JSON.parse(answer.body) as { code: string }).code, "not_found");
    }
  } finally {
    await server.close();
  }
});
