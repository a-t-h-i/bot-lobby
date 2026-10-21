import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentProfile, DEFAULT_CONFIG, lobbyAgentProfile, resolveConfig } from "../src/schemas/configuration.ts";
import { buildPiArgs, runPiAgent, type ProcessRunner } from "../src/execution/pi-runner.ts";
import { grantableSkills, grantableTools, skillFiles } from "../src/pi/grants.ts";
import { ORCHESTRATE_ACTIONS } from "../src/workflow/workflow.ts";
import { parseCommand } from "../src/pi/commands.ts";
import { loadPrompt } from "../src/prompts/loader.ts";

function skillDir(): { cwd: string; done: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "bl-grants-"));
  for (const name of ["pdf-tools", "release-notes"]) {
    mkdirSync(join(cwd, ".pi", "skills", name), { recursive: true });
    writeFileSync(join(cwd, ".pi", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Does ${name} work.\n---\n\n# ${name}\n`);
  }
  return { cwd, done: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("a skill grant is kept as names: absent keeps every skill, a list keeps only those, junk is dropped", () => {
  const cfg = resolveConfig({ agents: { backend: { skills: ["pdf-tools", "Not A Name", 4] } }, scout: { skills: [] }, quickFix: { skills: ["release-notes"] } });
  assert.deepEqual(cfg.agents.backend.skills, ["pdf-tools"]);
  assert.equal("skills" in cfg.agents.designer, false, "no list: every skill pi finds");
  assert.deepEqual(agentProfile(cfg, "backend", "worker").skills, ["pdf-tools"]);
  assert.deepEqual(agentProfile(cfg, "designer", "scout").skills, [], "an empty list grants none");
  assert.equal("skills" in agentProfile(cfg, "designer", "worker"), false);
  assert.deepEqual(lobbyAgentProfile(cfg, "quickfix").skills, ["release-notes"]);
});

test("granted skills replace pi's discovery in the agent's command line; no grant leaves it alone", () => {
  const granted = buildPiArgs({ cwd: "/p", tools: ["read"], skillFiles: ["/s/pdf/SKILL.md"] });
  assert.ok(granted.includes("--no-skills"));
  assert.equal(granted[granted.indexOf("--skill") + 1], "/s/pdf/SKILL.md");
  const none = buildPiArgs({ cwd: "/p", tools: ["read"], skillFiles: [] });
  assert.ok(none.includes("--no-skills") && !none.includes("--skill"));
  const all = buildPiArgs({ cwd: "/p", tools: ["read"] });
  assert.ok(!all.includes("--no-skills") && !all.includes("--skill"));
});

test("skill names resolve to the files pi finds, and a run passes them on", async () => {
  const { cwd, done } = skillDir();
  try {
    assert.deepEqual(grantableSkills(cwd).filter((skill) => skill.path.startsWith(cwd)).map((skill) => skill.name), ["pdf-tools", "release-notes"]);
    assert.deepEqual(skillFiles(["release-notes", "gone"], cwd), [join(cwd, ".pi", "skills", "release-notes", "SKILL.md")]);
    let seen: string[] = [];
    const run: ProcessRunner = async (args) => {
      seen = args;
      return { exitCode: 0, killed: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" } }) };
    };
    mkdirSync(join(cwd, ".pi", "bot-lobby"), { recursive: true });
    await runPiAgent({ cwd, task: "t", tools: ["read"], skills: ["pdf-tools"] }, run);
    assert.equal(seen[seen.indexOf("--skill") + 1], join(cwd, ".pi", "skills", "pdf-tools", "SKILL.md"));
  } finally {
    done();
  }
});

test("the grantable MCP tools are pi's connected ones, by server, with their read-only mark", () => {
  const pi = { getAllTools: () => [
    { name: "read", exposure: "direct" },
    { name: "mcp__github__get_issue", description: "Read one issue.\nMore.", exposure: "codemode", annotations: { readOnlyHint: true } },
    { name: "mcp__figma__export", description: "Export.", exposure: "deferred" },
    { name: "mcp__secret__hidden", description: "", exposure: "hidden" },
  ] } as unknown as ExtensionAPI;
  assert.deepEqual(grantableTools(pi), [
    { name: "mcp__figma__export", server: "figma", description: "Export.", readOnly: false },
    { name: "mcp__github__get_issue", server: "github", description: "Read one issue.", readOnly: true },
  ]);
  assert.deepEqual(grantableTools(undefined), []);
});

test("time limits are gone: no setting, no budget action or command, no time talk in the prompts", () => {
  for (const key of ["agentTimeoutMs", "wrapUpAt", "taskBudgetMinutes"]) assert.equal(key in DEFAULT_CONFIG.workflow, false, key);
  const old = resolveConfig({ workflow: { agentTimeoutMs: 60_000, wrapUpAt: 0.5, taskBudgetMinutes: 90 }, scout: { timeoutMs: 1000 }, planner: { timeoutMs: 1000 } });
  for (const key of ["agentTimeoutMs", "wrapUpAt", "taskBudgetMinutes"]) assert.equal(key in old.workflow, false, `${key} is dropped from an old file`);
  assert.equal("timeoutMs" in old.scout, false);
  assert.equal("timeoutMs" in old.planner, false);
  assert.equal((ORCHESTRATE_ACTIONS as readonly string[]).includes("budget"), false);
  assert.equal(parseCommand("budget 90m").sub, undefined, "budget is no longer a subcommand");
  assert.equal(parseCommand("--budget 90m add login").restText, "--budget 90m add login", "--budget is no longer a flag");
  for (const prompt of ["master.md", "worker.md"]) {
    const text = loadPrompt(prompt);
    assert.doesNotMatch(text, /action=budget|## More Time|## Left Off|15 minutes/, prompt);
  }
  assert.match(loadPrompt("master.md"), /Agents have no time limit/);
});
