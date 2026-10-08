import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ProjectRegistry, scanProjects, selectProjects } from "../src/webui/projects.ts";
import { startWebServer } from "../src/webui/server.ts";
import { sessionValue } from "../src/webui/auth.ts";
import type { ProjectInfo } from "../src/webui/protocol.ts";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { fakeWebService } from "./webui-fake.ts";

const temp = () => mkdtempSync(join(tmpdir(), "bl-projects-"));

test("private registry lifecycle, canonical rebind, invalid/symlink/dead records and grouping", () => {
  const dir = temp(); const root = temp(); const other = temp();
  const registry = new ProjectRegistry(dir, root, 12345);
  const first = registry.record.id;
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, `${first}.json`)).mode & 0o777, 0o600);
  const alias = join(temp(), "alias"); symlinkSync(root, alias);
  registry.rebind(alias); assert.equal(registry.record.id, first);
  const duplicate = new ProjectRegistry(dir, root, 12346);
  duplicate.record.startedAt += 100;
  assert.equal(selectProjects([registry.record, duplicate.record], registry.record)[0]!.id, first);
  const outsider = new ProjectRegistry(dir, other, 12347);
  assert.equal(selectProjects([duplicate.record, outsider.record], registry.record).length, 2);
  writeFileSync(join(dir, "a".repeat(32) + ".json"), "bad json");
  writeFileSync(join(dir, "b".repeat(32) + ".json"), JSON.stringify({ ...registry.record, id: "b".repeat(32), pid: 2147483647 }));
  symlinkSync(join(dir, `${first}.json`), join(dir, "c".repeat(32) + ".json"));
  assert.equal(scanProjects(dir).length, 3);
  registry.rebind(other); assert.notEqual(registry.record.id, first);
  assert.equal(scanProjects(dir).some((r) => r.id === first), false);
  registry.close(); duplicate.close(); outsider.close();
  assert.equal(scanProjects(dir).length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("scan considers at most 128 records", () => {
  const dir = temp(); const registry = new ProjectRegistry(dir, temp(), 12345);
  for (let i = 0; i < 130; i++) {
    const id = i.toString(16).padStart(32, "0");
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...registry.record, id }));
  }
  assert.equal(scanProjects(dir).length, 128);
  rmSync(dir, { recursive: true, force: true });
});

test("project endpoints retain root auth/JSON/method validation and rebind/close lifecycle", async () => {
  const dir = temp(); const root = temp(); const secret = randomBytes(32);
  mkdirSync(join(root, ".git"));
  const service = { ...fakeWebService(new LobbyFeed()), projectRoot: () => root };
  const server = await startWebServer({ service, secret, port: 0, registryDir: dir });
  const cookie = `bl_session=${sessionValue(secret)}`;
  const call = (path: string, body = "{}", headers: Record<string, string> = {}, method = "POST") =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, ...(method === "POST" ? { body } : {}) });
  try {
    const self = await (await call("/api/projects.self")).json() as { result: { project: ProjectInfo } };
    assert.deepEqual(Object.keys(self.result.project).sort(), ["cwd", "id", "name", "port"]);
    assert.equal(self.result.project.cwd, root);
    const list = await (await call("/api/projects.list")).json() as { result: { projects: ProjectInfo[]; currentId: string } };
    assert.equal(list.result.currentId, self.result.project.id);
    assert.deepEqual(list.result.projects, [self.result.project]);
    assert.equal((await call("/api/projects.self", '{"extra":1}')).status, 400);
    assert.equal((await call("/api/projects.self", "[]")).status, 400);
    assert.equal((await call("/api/projects.self", "{}", { cookie: "" })).status, 401);
    assert.equal((await call("/api/projects.self", "{}", { "content-type": "text/plain" })).status, 415);
    assert.equal((await call("/api/projects.list", "{}", {}, "GET")).status, 405);
    assert.equal((await call("/api/projects.list", "{}", { origin: "https://evil.test" })).status, 403);
    await checkFolderEndpoints(call, root, self.result.project.id);
    server.rebind({ ...service, projectRoot: () => temp() });
    const rebound = await (await call("/api/projects.self")).json() as { result: { project: ProjectInfo } };
    assert.notEqual(rebound.result.project.id, self.result.project.id);
    assert.equal(scanProjects(dir).length, 1);
  } finally { await server.close(); }
  assert.equal(scanProjects(dir).length, 0);
});

async function checkFolderEndpoints(call: (path: string, body?: string, headers?: Record<string, string>, method?: string) => Promise<Response>, root: string, id: string) {
  const browsed = await (await call("/api/projects.browse")).json() as { result: { path: string } };
  assert.equal(browsed.result.path, root);
  const opened = await (await call("/api/projects.open", JSON.stringify({ path: root }))).json() as { result: { project: ProjectInfo } };
  assert.equal(opened.result.project.id, id);
  for (const endpoint of ["projects.browse", "projects.open"]) {
    assert.equal((await call(`/api/${endpoint}`, "{}", { cookie: "" })).status, 401);
    assert.equal((await call(`/api/${endpoint}`, "{}", { origin: "https://evil.test" })).status, 403);
    assert.equal((await call(`/api/${endpoint}`, "{}", {}, "GET")).status, 405);
    assert.equal((await call(`/api/${endpoint}`, '{"path":"relative"}')).status, 400);
    assert.equal((await call(`/projects/${id}/api/${endpoint}`, "{}")).status, 403);
  }
}
