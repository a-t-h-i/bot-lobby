import test from "node:test";
import assert from "node:assert/strict";
import { projectFolder, rememberProjects, relinkProject, selectedProject } from "../webui/src/lib/project.ts";

const OLD = "a".repeat(32);
const NEW = "b".repeat(32);
const OTHER = "c".repeat(32);

/** The page's address and history, as a browser tab has them. */
function page(search: string) {
  const location = { origin: "http://127.0.0.1:7347", pathname: "/", search, hash: "#/plan", assign() {} };
  const history = { replaceState: (_data: unknown, _title: string, url: string) => {
    const next = new URL(url);
    location.search = next.search;
    location.hash = next.hash;
  } };
  Object.assign(globalThis, { location, history });
  return location;
}

test("a project whose pi restarted under a new id is found again by its folder, in place", async () => {
  const location = page(`?project=${OLD}`);
  rememberProjects([{ id: OLD, cwd: "/work/app" }, { id: OTHER, cwd: "/work/other" }]);
  assert.equal(projectFolder(OLD), "/work/app");

  const moved = await relinkProject(async () => ({ projects: [{ id: OTHER, cwd: "/work/other" }, { id: NEW, cwd: "/work/app" }] }));
  assert.equal(moved, true);
  assert.equal(selectedProject(), NEW, "the page now talks to the project running in the same folder");
  assert.equal(location.hash, "#/plan", "on the same tab");

  assert.equal(await relinkProject(async () => ({ projects: [{ id: NEW, cwd: "/work/app" }] })), false, "a project still running stays as it is");
  page(`?project=${OLD}`);
  assert.equal(await relinkProject(async () => ({ projects: [{ id: OTHER, cwd: "/work/other" }] })), false, "nothing runs in its folder yet: keep waiting");
  page("");
  assert.equal(await relinkProject(async () => { throw new Error("not asked"); }), false, "the entry's own project needs no relinking");
});
