/**
 * Silence probe, run as a child process (not a test file): it starts the
 * loopback server, makes valid and refused requests, and exits. The parent
 * test asserts the child's stdout/stderr stayed empty — spying in-process is
 * racy because the test runner batches its own output through the same pipe.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { startWebServer } from "../src/webui/server.ts";
import { fakeWebService } from "./webui-fake.ts";

const DIST = mkdtempSync(join(tmpdir(), "bl-silence-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const json = { "content-type": "application/json" };

function send(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { host: `127.0.0.1:${port}`, ...options.headers } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function cookieOf(setCookie: string | string[] | undefined): string {
  return String(setCookie).split(";")[0]!;
}

const server = await startWebServer({ service: fakeWebService(new LobbyFeed()), port: 0, secret: randomBytes(32), dist: DIST });
try {
  const token = new URL(server.link).hash.replace("#token=", "");
  let cookie = "";
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: server.port, method: "POST", path: "/api/auth.login", headers: { host: `127.0.0.1:${server.port}`, ...json } },
      (res) => {
        res.resume();
        res.on("end", () => {
          cookie = cookieOf(res.headers["set-cookie"]);
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify({ token }));
    req.end();
  });
  await send(server.port, { path: "/" });
  await send(server.port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie }, body: "{}" });
  await send(server.port, { method: "POST", path: "/api/nope.nope", headers: { ...json, cookie }, body: "{}" });
  await send(server.port, { method: "POST", path: "/api/status.get", headers: json, body: "{}" });
  await send(server.port, { path: "/../package.json" });
} finally {
  await server.close();
}
