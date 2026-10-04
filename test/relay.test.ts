import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_ENV, previewDir, readRelayAnswer, readRelayRequest, relayAsker, RELAY_TITLE } from "../src/ask/relay.ts";
import { answerSummary, registerAskTool } from "../src/ask/tool.ts";
import { ASK_TOOL, type AskQuestion, type AskResult } from "../src/ask/types.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { setAutoMode } from "../src/state/auto.ts";
import { askedDecision, runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { ProcessOutcome, ProcessRunner, ProcessRunOptions } from "../src/execution/pi-runner.ts";

const LENIENT = { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false } };

const layout: AskQuestion = { question: "Which layout?", header: "Layout", options: [{ label: "Sidebar (Recommended)", preview: "┌──┬────┐\n│  │    │\n└──┴────┘", image: "shots/sidebar.png" }, { label: "Top bar" }] };
const picked: AskResult = { cancelled: false, answers: [{ questionIndex: 0, question: layout.question, kind: "option", answer: "Sidebar (Recommended)" }] };

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a subagent's questions travel as an RPC editor dialog, image paths made absolute, and its answers come back", async () => {
  let sent: { title: string; prefill: string } | undefined;
  const ctx = { cwd: "/repo", ui: { editor: async (title: string, prefill: string) => ((sent = { title, prefill }), JSON.stringify(picked)) } } as unknown as ExtensionContext;
  assert.deepEqual(await relayAsker([layout], ctx), picked);
  assert.equal(sent!.title, RELAY_TITLE);
  const carried = readRelayRequest(sent!.title, sent!.prefill)!;
  assert.equal(carried[0]!.options[0]!.image, "/repo/shots/sidebar.png");
  assert.equal(readRelayRequest("Some other editor", sent!.prefill), undefined, "only the marked dialog is a relay");
  assert.equal(readRelayRequest(RELAY_TITLE, "not json"), undefined);
  assert.equal(readRelayRequest(RELAY_TITLE, JSON.stringify({ questions: [{ question: "Q?", header: "H", options: "nope" }] })), undefined, "malformed questions are not asked");
  assert.deepEqual(readRelayRequest(RELAY_TITLE, JSON.stringify({ questions: [{ question: "Q?", header: "H", options: [{ label: "A", extra: 1 }, { nolabel: true }], run: "rm -rf /" }] })), [{ question: "Q?", header: "H", options: [{ label: "A" }] }], "only what the questionnaire shows is kept");
  assert.equal(readRelayAnswer("{\"nope\":1}"), undefined);
  const cancelled = { cwd: "/repo", ui: { editor: async () => undefined } } as unknown as ExtensionContext;
  assert.deepEqual(await relayAsker([layout], cancelled), { answers: [], cancelled: true });
});

test("in a subagent the tool exists only when the master relays it, and says so", () => {
  const register = () => {
    const tools: Array<{ name: string; description: string }> = [];
    registerAskTool({ registerTool: (tool: { name: string; description: string }) => tools.push(tool) } as unknown as ExtensionAPI);
    return tools;
  };
  assert.equal(withEnv({ BOT_LOBBY_SUBAGENT: "1", [ASK_ENV]: undefined }, register).length, 0);
  const relayed = withEnv({ BOT_LOBBY_SUBAGENT: "1", [ASK_ENV]: "1" }, register);
  assert.deepEqual(relayed.map((tool) => tool.name), [ASK_TOOL]);
  assert.match(relayed[0]!.description, /reach the user through the oracle/);
  assert.match(answerSummary([layout], { answers: [], cancelled: true, globalNote: "Auto mode is on." }), /^Auto mode is on\.$/, "a relay that could not ask says why");
});

/* ------------------------------------------------------------ the workflow */

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning"];
const PLAN = "## Objective\nA page.\n## Domains\nbackend, designer\n## Files\nsrc/page.tsx\n## Sequence\n1\n## Dependencies\nnone\n## Testing\nunit\n## Acceptance Criteria\nworks\n## Rollback\nrevert\n## Review\npeer";
const DONE = "## Completed\nthe page\n\n## Files Changed\n- `src/page.tsx` — page\n\n## Verification\n- `npm test` — passing";

interface Seen {
  tools: string;
  env: Record<string, string> | undefined;
  prompt: string;
  answer?: AskResult;
  asked: boolean;
}

/** A fake pi that, when it may, asks the layout question and records what came back. */
function asking(seen: Seen[], before?: () => void): ProcessRunner {
  return async (args, options: ProcessRunOptions): Promise<ProcessOutcome> => {
    const entry: Seen = { tools: args[args.indexOf("--tools") + 1] ?? "", env: options.env, prompt: readFileSync(args[args.indexOf("--append-system-prompt") + 1]!, "utf8"), asked: Boolean(options.onAsk) };
    seen.push(entry);
    if (options.onAsk) {
      before?.();
      entry.answer = await options.onAsk([layout], new AbortController().signal);
    }
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: DONE }], stopReason: "stop" } }), stderr: "", killed: false, timedOut: false };
  };
}

function project(overrides: Partial<WorkflowDeps> = {}, seen: Seen[] = [], before?: () => void) {
  const root = mkdtempSync(join(tmpdir(), "dh-relay-"));
  const deps: WorkflowDeps = { root, configDir: ".pi", cwd: root, config: LENIENT, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: asking(seen, before), ...overrides };
  ensureProjectStructure(root, ".pi");
  const task: Task = createTask("TASK-1", "A page");
  createTaskDir(root, ".pi", task);
  for (const state of FLOW) transition(task, state);
  task.domains = ["backend", "designer"];
  task.plan = PLAN;
  saveTask(root, ".pi", task);
  const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
  return { root, deps, act };
}

test("the designer may ask the user: its questions reach the questionnaire as DESIGN's and the answers become decisions", async () => {
  const seen: Seen[] = [];
  const asked: Array<{ from: string; questions: AskQuestion[] }> = [];
  const { root, act } = project({ askQuestions: async (questions, from) => (asked.push({ from, questions }), picked) }, seen);
  const result = await act({ action: "implement", domain: "designer", task: "Build the page" });
  assert.equal(result.ok, true, result.message);
  assert.equal(seen[0]!.asked, true);
  assert.ok(seen[0]!.tools.split(",").includes(ASK_TOOL), "the tool is on its allowlist");
  assert.equal(seen[0]!.env?.[ASK_ENV], "1");
  assert.match(seen[0]!.prompt, /You can ask the user with ask_user_question/);
  assert.ok(seen[0]!.prompt.includes(previewDir("TASK-1", root)), "it is told where to save images");
  assert.deepEqual(asked.map((entry) => entry.from), ["DESIGN"]);
  assert.deepEqual(seen[0]!.answer, picked);
  const decisions = loadTask(root, ".pi", "TASK-1")!.decisions.map((decision) => decision.text);
  assert.ok(decisions.includes("DESIGN asked the user: [Layout] Which layout? → Sidebar (Recommended)"), decisions.join("\n"));
  await act({ action: "implement", domain: "backend", task: "Add the endpoint" });
  assert.equal(seen[1]!.asked, false, "the backend worker does not ask");
  assert.ok(!seen[1]!.tools.split(",").includes(ASK_TOOL));
});

test("nobody is asked without a UI or in auto mode, and auto mode turned on while the designer works answers for nobody", async () => {
  const noUi: Seen[] = [];
  await project({}, noUi).act({ action: "implement", domain: "designer", task: "Build the page" });
  assert.equal(noUi[0]!.asked, false, "no UI, no relay");

  const auto: Seen[] = [];
  const unattended = project({ askQuestions: async () => picked }, auto);
  setAutoMode(unattended.root, ".pi", "TASK-1", true);
  await unattended.act({ action: "implement", domain: "designer", task: "Build the page" });
  assert.equal(auto[0]!.asked, false, "auto mode: the designer decides");

  const switched: Seen[] = [];
  let questioned = 0;
  const midway = project({ askQuestions: async () => ((questioned += 1), picked) }, switched, () => setAutoMode(midway.root, ".pi", "TASK-1", true));
  await midway.act({ action: "implement", domain: "designer", task: "Build the page" });
  assert.equal(questioned, 0);
  assert.match(switched[0]!.answer!.globalNote!, /Auto mode is on, so nobody can answer/);
});

test("the decision record reads each answer, several picks, the user's own words, and a put-away", () => {
  const colour: AskQuestion = { question: "Which accents?", header: "Colour", options: [{ label: "Teal" }, { label: "Amber" }], multiSelect: true };
  assert.equal(
    askedDecision("DESIGN", [layout, colour], { cancelled: false, answers: [{ questionIndex: 0, question: layout.question, kind: "custom", answer: "A drawer" }, { questionIndex: 1, question: colour.question, kind: "multi", answer: "Teal, Amber", selected: ["Teal", "Amber"] }] }),
    "DESIGN asked the user: [Layout] Which layout? → A drawer (in their words); [Colour] Which accents? → Teal, Amber",
  );
  assert.equal(askedDecision("DESIGN", [layout, colour], { answers: [], cancelled: true }), "DESIGN asked the user about Layout, Colour; they did not answer, so DESIGN decides.");
});

test("questions the user leaves are put to them again, and the designer decides only when they say so", async () => {
  const gone = { answers: [], cancelled: true };
  const seen: Seen[] = [];
  let asked = 0;
  const offered: string[][] = [];
  const answers = ["Answer the questions now", "Let DESIGN decide with its recommendation"];
  const first = project({
    askQuestions: async () => ((asked += 1), gone),
    choose: async (_title, options) => (offered.push([...options]), answers.shift()),
  }, seen);
  await first.act({ action: "implement", domain: "designer", task: "Build the page" });
  assert.equal(asked, 2, "left once, asked again on their say-so, and decided only after they let it");
  assert.deepEqual(seen[0]!.answer, gone);
  assert.match(offered[0]![0]!, /Answer the questions now/);

  // They answer on the second try: the answers are used.
  const again: Seen[] = [];
  let tries = 0;
  const second = project({ askQuestions: async () => (++tries === 1 ? gone : picked), choose: async () => "Answer the questions now" }, again);
  await second.act({ action: "implement", domain: "designer", task: "Build the page" });
  assert.deepEqual(again[0]!.answer, picked);

  // Nobody at the prompt (no answer to the nudge) is bounded, not endless.
  let endless = 0;
  const bounded: Seen[] = [];
  const third = project({ askQuestions: async () => ((endless += 1), gone), choose: async () => undefined }, bounded);
  await third.act({ action: "implement", domain: "designer", task: "Build the page" });
  assert.ok(endless > 1 && endless <= 7, `asked ${endless} times`);
});
