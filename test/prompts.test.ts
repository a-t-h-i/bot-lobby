import { test } from "node:test";
import assert from "node:assert/strict";
import { clearPromptCache, loadPrompt } from "../src/prompts/loader.ts";
import { compilePrompt, invariantPrefix } from "../src/prompts/compiler.ts";
import { ROLE_SPECS } from "../src/roles/registry.ts";
import { WORKER_TOOLS } from "../src/roles/worker.ts";
import { DOMAINS, ROLES } from "../src/schemas/agent.ts";
import { buildPiArgs, MCP_RESOURCE_TOOLS } from "../src/execution/pi-runner.ts";

test("all prompt layers load and are non-empty", () => {
  const files = [
    "global.md", "master.md", "designer.md", "backend.md", "qa.md",
    "scout.md", "worker.md", "reviewer.md", "researcher.md",
    "lobby-chat.md", "planner.md", "panel.md",
  ];
  for (const file of files) {
    assert.ok(loadPrompt(file).length > 0, `${file} should be non-empty`);
  }
  clearPromptCache();
  assert.ok(loadPrompt("global.md").includes("Global Engineering Agent"));
});

test("compiler layers the invariant prefix first, then task context and knowledge", () => {
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
    "### Output contract",
    "Add pagination to /users",
    "Always validate input.",
    "Service layer lives in src/services.",
    "REST over GraphQL.",
    "Task state: implementing.",
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = prompt.indexOf(marker);
    assert.ok(at > cursor, `${marker} should appear after the previous layer`);
    cursor = at;
  }
  assert.ok(prompt.includes("Add pagination to /users"));
});

test("compiler layers custom instructions between the contract and the task", () => {
  const prompt = compilePrompt({
    domain: "backend",
    role: "worker",
    task: "Add pagination to /users",
    instructions: "Always add focused unit tests.",
  });
  const contractAt = prompt.indexOf("### Output contract");
  const instructionsAt = prompt.indexOf("## Custom Instructions");
  const taskAt = prompt.indexOf("Add pagination to /users");
  assert.ok(contractAt < instructionsAt, "instructions keep precedence over the role contract");
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

test("the invariant prefix is byte-identical when task-selected context changes", () => {
  const first = compilePrompt({
    domain: "backend",
    role: "worker",
    task: "First task",
    standards: "s1",
    knowledge: "k1",
    decisions: "d1",
    scripts: "sc1",
    workflowContext: "w1",
  });
  const second = compilePrompt({ domain: "backend", role: "worker", task: "Second task", instructions: "custom" });
  const prefix = invariantPrefix("backend", "worker");
  assert.ok(prefix.includes("### Output contract"), "the contract is part of the invariant prefix");
  assert.ok(first.startsWith(prefix) && second.startsWith(prefix));
  let shared = 0;
  while (shared < Math.min(first.length, second.length) && first[shared] === second[shared]) shared += 1;
  const sep = "\n\n---\n\n";
  assert.ok(
    first.startsWith(prefix + sep) && second.startsWith(prefix + sep),
    "task-selected context follows the invariant prefix and the layer separator",
  );
  assert.ok(
    shared > prefix.length + sep.length,
    "nothing before the changing sections differs from the invariant prefix",
  );
});

test("every role's compiled prompt starts with its byte-identical invariant prefix", () => {
  for (const domain of DOMAINS) {
    for (const role of ROLES) {
      const prompt = compilePrompt({ domain, role, task: "t" });
      assert.ok(prompt.startsWith(invariantPrefix(domain, role)), `${domain}/${role} prefix`);
    }
  }
  const master = compilePrompt({ domain: "master", task: "t" });
  assert.ok(master.startsWith(invariantPrefix("master")));
});

test("tool allowlists keep their fixed deterministic order across execution paths", () => {
  assert.deepEqual(WORKER_TOOLS, ["read", "bash", "edit", "write", "grep", "find", "ls"]);
  // pi-runner keeps the granted order and appends MCP tools after it, never sorting.
  const args = buildPiArgs({ cwd: "/p", tools: [...WORKER_TOOLS], mcpTools: ["mcp__rea_one", "plain"] } as Parameters<typeof buildPiArgs>[0]);
  const granted = args[args.indexOf("--tools") + 1]!;
  assert.equal(granted, [...WORKER_TOOLS, "mcp__rea_one", ...MCP_RESOURCE_TOOLS].join(","));
});

test("read-only roles keep their tool restrictions", () => {
  assert.deepEqual(ROLE_SPECS.scout.tools, ["read", "grep", "find", "ls"]);
  assert.deepEqual(ROLE_SPECS.reviewer.tools, ["read", "grep", "find", "ls", "bash"]);
  assert.deepEqual(ROLE_SPECS.researcher.tools, [
    "read", "grep", "find", "ls",
    "web_search", "fetch_content", "source_check", "get_search_content",
  ]);
  assert.deepEqual(ROLE_SPECS.worker.tools, ["read", "bash", "edit", "write", "grep", "find", "ls"]);
});

test("the master briefs smaller agents explicitly and every agent follows its brief", () => {
  const master = loadPrompt("master.md");
  assert.ok(master.includes("## Briefing the agents") && master.includes("Never assume they are as capable as you"));
  for (const part of ["**Goal**", "**Files**", "**Contracts**", "**Done when**", "**If stuck**"]) assert.ok(master.includes(part), part);
  assert.ok(loadPrompt("global.md").includes("## Following your brief"), "every agent gets the rule");
  const worker = compilePrompt({ domain: "backend", role: "worker", task: "x" });
  assert.ok(worker.includes("## Brief Check") && worker.includes("Following your brief"));
});
