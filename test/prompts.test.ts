import { test } from "node:test";
import assert from "node:assert/strict";
import { clearPromptCache, loadPrompt } from "../src/prompts/loader.ts";
import { compilePrompt } from "../src/prompts/compiler.ts";
import { ROLE_SPECS } from "../src/roles/registry.ts";
import { DOMAINS, ROLES } from "../src/schemas/agent.ts";

test("all prompt layers load and are non-empty", () => {
  const files = [
    "global.md", "master.md", "designer.md", "backend.md", "qa.md",
    "scout.md", "worker.md", "reviewer.md", "researcher.md",
  ];
  for (const file of files) {
    assert.ok(loadPrompt(file).length > 0, `${file} should be non-empty`);
  }
  clearPromptCache();
  assert.ok(loadPrompt("global.md").includes("Global Engineering Agent"));
});

test("compiler layers global, domain, role, task, then contract in order", () => {
  const prompt = compilePrompt({
    domain: "backend",
    role: "worker",
    task: "Add pagination to /users",
    standards: "Always validate input.",
    knowledge: "Service layer lives in src/services.",
    decisions: "REST over GraphQL.",
    workflowContext: "Task state: implementing.",
  });
  // Markers use the injected content so a prompt file cannot collide with them.
  const order = [
    "Global Engineering Agent",
    "Backend Domain Agent",
    "Worker Role",
    "Add pagination to /users",
    "Always validate input.",
    "Service layer lives in src/services.",
    "REST over GraphQL.",
    "Task state: implementing.",
    "### Output contract",
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = prompt.indexOf(marker);
    assert.ok(at > cursor, `${marker} should appear after the previous layer`);
    cursor = at;
  }
  assert.ok(prompt.includes("Add pagination to /users"));
});

test("compiler layers custom instructions between the role and the task", () => {
  const prompt = compilePrompt({
    domain: "backend",
    role: "worker",
    task: "Add pagination to /users",
    instructions: "Always add focused unit tests.",
  });
  const roleAt = prompt.indexOf("Worker Role");
  const instructionsAt = prompt.indexOf("## Custom Instructions");
  const taskAt = prompt.indexOf("Add pagination to /users");
  assert.ok(instructionsAt > roleAt, "instructions come after the role prompt");
  assert.ok(instructionsAt < taskAt, "instructions come before the task context");
  assert.ok(prompt.includes("Always add focused unit tests."));
});

test("compiler omits empty optional layers", () => {
  const prompt = compilePrompt({ domain: "designer", role: "scout", task: "Inspect nav" });
  assert.ok(!prompt.includes("## Standards"));
  assert.ok(!prompt.includes("## Knowledge"));
  assert.ok(!prompt.includes("## Decisions"));
  assert.ok(!prompt.includes("## Workflow Context"));
  assert.ok(prompt.includes("## Task Context"));
});

test("master prompt compiles without a role layer or contract", () => {
  const prompt = compilePrompt({ domain: "master", task: "Add feature X" });
  assert.ok(prompt.includes("Master / Orchestrator"));
  assert.ok(!prompt.includes("### Output contract"));
  assert.ok(!prompt.includes("Scout Role"));
});

test("every domain and role pair compiles with its own prompt and contract", () => {
  const headings = { scout: "Scout Role", worker: "Worker Role", reviewer: "Reviewer Role", researcher: "Researcher Role" };
  for (const domain of DOMAINS) {
    for (const role of ROLES) {
      const prompt = compilePrompt({ domain, role, task: "t" });
      assert.ok(prompt.includes(headings[role]), `${domain}/${role} role prompt`);
      assert.ok(prompt.includes("### Output contract"), `${domain}/${role} contract`);
      assert.ok(prompt.includes("Global Engineering Agent"));
    }
  }
});

test("read-only roles keep their tool restrictions", () => {
  assert.deepEqual(ROLE_SPECS.scout.tools, ["read", "grep", "find", "ls"]);
  assert.deepEqual(ROLE_SPECS.reviewer.tools, ["read", "grep", "find", "ls", "bash"]);
  assert.deepEqual(ROLE_SPECS.researcher.tools, [
    "read", "grep", "find", "ls",
    "web_search", "fetch_content", "source_check", "get_search_content",
  ]);
  assert.equal(ROLE_SPECS.worker.tools, undefined);
});
