import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike, Question } from "../src/classifier/client.ts";
import { candidateSections, keepSections, knowledgePicker, KNOWLEDGE_BUDGET_CHARS, leftOutNote, MAX_SECTIONS, SECTION_EXCERPT_CHARS, sectionRequest } from "../src/classifier/knowledge.ts";
import { selectKnowledge } from "../src/knowledge/selector.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { runReviewer, runScouts, runWorker } from "../src/master/master.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

/** A section of about `size` characters under a heading. */
function section(title: string, body: string, size = 450): string {
  const text = `## ${title}\n${body} `;
  return `${text}${"filler words for length ".repeat(Math.ceil(size / 25))}`.slice(0, size).trimEnd();
}

/** A file over the prompt budget: twelve sections, of which `billing` and `auth` are the ones a test asks about. */
function longFile(heading = "# Knowledge"): string {
  const topics = ["billing", "auth", "email", "search", "uploads", "cron", "logging", "cache", "i18n", "exports", "webhooks", "audit"];
  return [heading, ...topics.map((topic) => section(topic, `The ${topic} module lives in src/${topic}.`))].join("\n\n");
}

interface Call {
  questions: number;
  task: string;
  sections: string[];
}

/** A fake Jev: each section's relevance from `relevance(text)`. */
function sectionJev(relevance: (text: string) => number, calls: Call[] = [], options: { fail?: boolean; delayMs?: number } = {}): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { state: { task: string; sections: Record<string, string> }; questions: Record<string, Question> };
    calls.push({ questions: Object.keys(body.questions).length, task: body.state.task, sections: Object.values(body.state.sections) });
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    init.signal?.throwIfAborted();
    if (options.fail) return new Response("{}", { status: 400 });
    const answers: Record<string, Answer> = {};
    for (const key of Object.keys(body.questions)) answers[key] = { type: "noul", noul: relevance(body.state.sections[key]!) };
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  };
}

function jev(fetch: FetchLike, overrides: Partial<ClassifierConfig> = {}): Classifier {
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, ...overrides }), keys: async () => "ts_key", fetch, sleep: async () => {} });
}

const PATHS = { knowledge: "/data/Backend/knowledge/knowledge.md", standards: "/data/Backend/knowledge/engineering-standards.md", decisions: "/data/Backend/knowledge/decisions.md" };

test("one question per section, each section clipped to what Jev needs to judge it, the task clipped too", () => {
  const sections = ["## A\nshort", `## B\n${"x".repeat(2000)}`];
  const { request, keys } = sectionRequest("y".repeat(5000), sections, [0, 1]);
  assert.deepEqual([...keys], [["s1", 0], ["s2", 1]]);
  const state = request.state as { task: string; sections: Record<string, string> };
  assert.ok(state.task.length <= 3000);
  assert.equal(state.sections.s1, "## A\nshort");
  assert.ok(state.sections.s2!.length <= SECTION_EXCERPT_CHARS);
  assert.deepEqual(Object.keys(request.questions), ["s1", "s2"]);
  assert.match(JSON.stringify(request.questions.s2), /sections\.s2/);
});

test("a file with many sections is narrowed to the ones sharing the task's words, kept in file order", () => {
  const sections = Array.from({ length: MAX_SECTIONS + 20 }, (_, index) => `## Part ${index}\n${index % 7 === 0 ? "webhook retries" : "unrelated"}`);
  assert.deepEqual(candidateSections("x", sections.slice(0, 5)), [0, 1, 2, 3, 4], "few sections: all of them");
  const chosen = candidateSections("webhook retries", sections);
  assert.equal(chosen.length, MAX_SECTIONS);
  assert.deepEqual(chosen, [...chosen].sort((a, b) => a - b));
  for (const index of sections.map((_, at) => at).filter((at) => at % 7 === 0)) assert.ok(chosen.includes(index), `part ${index} shares the words`);
});

test("the sections kept are the relevant ones that fit, best first, and read in the file's order", () => {
  const sections = ["## one\n" + "a".repeat(100), "## two\n" + "b".repeat(100), "## three\n" + "c".repeat(100), "## four\n" + "d".repeat(100)];
  const relevance = new Map([[0, 0.5], [1, 0.9], [2, 0.2], [3, 0.7]]);
  const kept = keepSections(sections, relevance, 0.4, 230);
  assert.equal(kept.kept, 2, "0.9 and 0.7 fit; 0.5 does not; 0.2 is below the floor");
  assert.equal(kept.total, 4);
  assert.equal(kept.text, `${sections[1]}\n\n${sections[3]}`, "file order, not rank order");
  assert.equal(keepSections(sections, relevance, 0.95, 1000).text, "");
  const skipped = keepSections(["## big\n" + "x".repeat(300), "## small\nfits"], new Map([[0, 0.9], [1, 0.8]]), 0.4, 100);
  assert.match(skipped.text, /^## big\nx+ \[…\]$/, "a section too long for the budget alone is cut to it when it is the best there is");
  assert.equal(skipped.kept, 1);
  const rest = keepSections(["## a\n" + "x".repeat(60), "## big\n" + "x".repeat(300), "## c\nfits"], new Map([[0, 0.9], [1, 0.8], [2, 0.7]]), 0.4, 100);
  assert.equal(rest.text, "## a\n" + "x".repeat(60) + "\n\n## c\nfits", "a section that does not fit is skipped, a later one that does is kept");
});

test("the note says what was left out and where all of it is", () => {
  assert.equal(leftOutNote({ text: "x", kept: 2, total: 12 }, "decisions.md", "/d/decisions.md"), "_Kept 2 of 12 sections of decisions.md for this step. The whole file is /d/decisions.md._");
  assert.equal(leftOutNote({ text: "", kept: 0, total: 12 }, "knowledge.md", "/d/knowledge.md"), "_No section of knowledge.md bears on this step (12 sections). The whole file is /d/knowledge.md._");
  assert.equal(leftOutNote({ text: "", kept: 0, total: 3 }, "knowledge"), "_No section of knowledge bears on this step (3 sections)._");
});

test("a file that fits the prompt goes in whole, with no call; a long one keeps what Jev picks and says what it left out", async () => {
  const calls: Call[] = [];
  const log: string[] = [];
  const picker = knowledgePicker(jev(sectionJev((text) => (text.startsWith("## billing") ? 0.93 : text.startsWith("## audit") ? 0.55 : 0.05), calls)), (line) => log.push(line));
  const small = "# Standards\n\nAlways run the linter.";
  const files = { knowledge: longFile(), standards: small, decisions: "# Decisions\n\n- Use cents for money." };
  const picked = await picker.select("Change how invoices round", files, { paths: PATHS });
  assert.equal(picked.standards, small);
  assert.equal(picked.decisions, "# Decisions\n\n- Use cents for money.");
  assert.equal(calls.length, 1, "only the long file is judged");
  assert.equal(calls[0]!.questions, 13, "its preamble and twelve sections");
  assert.match(calls[0]!.task, /^Change how invoices round/);
  assert.match(picked.knowledge, /^## billing\nThe billing module lives in src\/billing\.[\s\S]*## audit\nThe audit module[\s\S]*\n\n_Kept 2 of 13 sections of knowledge\.md for this step\. The whole file is \/data\/Backend\/knowledge\/knowledge\.md\._$/);
  assert.doesNotMatch(picked.knowledge, /## email|## cache/);
  assert.ok(picked.knowledge.length < KNOWLEDGE_BUDGET_CHARS);
  assert.match(log[0]!, /^knowledge: kept 2 of 13 sections of knowledge\.md · \d+ ms$/);
  assert.equal((await picker.select("x", { knowledge: small }, {})).knowledge, small);
  assert.equal(calls.length, 1, "nothing long, nothing asked");
});

test("nothing relevant leaves only the note, except in standards, which are never emptied", async () => {
  const picker = knowledgePicker(jev(sectionJev(() => 0.02)));
  const files = { knowledge: longFile(), standards: longFile("# Engineering Standards"), decisions: longFile("# Decisions") };
  const task = "Rename the export button";
  const picked = await picker.select(task, files, { paths: PATHS });
  assert.equal(picked.knowledge, "_No section of knowledge.md bears on this step (13 sections). The whole file is /data/Backend/knowledge/knowledge.md._");
  assert.equal(picked.decisions, "_No section of decisions.md bears on this step (13 sections). The whole file is /data/Backend/knowledge/decisions.md._");
  assert.equal(picked.standards, selectKnowledge(task, files).standards, "the keyword selection stands");
  assert.doesNotMatch(picked.standards, /No section of/);
});

test("any failure, a slow Jev, or the switch turned off keeps the keyword selection", async () => {
  const files = { knowledge: longFile(), standards: longFile("# Standards"), decisions: longFile("# Decisions") };
  const task = "Change how billing rounds";
  const expected = selectKnowledge(task, files);
  const calls: Call[] = [];
  const features = { ...DEFAULT_CONFIG.classifier.features, knowledge: false };
  for (const classifier of [
    jev(sectionJev(() => 0.9, [], { fail: true })),
    jev(sectionJev(() => 0.9, calls), { enabled: false }),
    jev(sectionJev(() => 0.9, calls), { features }),
    new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true }), keys: async () => undefined, fetch: sectionJev(() => 0.9, calls), sleep: async () => {} }),
  ]) {
    assert.deepEqual(await knowledgePicker(classifier).select(task, files, { paths: PATHS }), expected);
  }
  assert.equal(calls.length, 0, "off or without a key: not even asked");
  assert.deepEqual(await knowledgePicker(jev(sectionJev(() => 0.9))).select("  ", files), selectKnowledge("  ", files), "no task, nothing to judge against");
  const slow = jev(sectionJev(() => 0.9, [], { delayMs: 300 }), { timeoutMs: 20 });
  assert.deepEqual(await knowledgePicker(slow).select(task, files, { paths: PATHS }), expected, "out of time: keywords");
});

test("a picker that throws never stops an agent starting", async () => {
  const seen: string[] = [];
  const data = mkdtempSync(join(tmpdir(), "bl-kn-"));
  mkdirSync(knowledgeDir(data, "backend"), { recursive: true });
  writeFileSync(join(knowledgeDir(data, "backend"), "knowledge.md"), "# Knowledge\n\nBilling uses cents.");
  const runner: ProcessRunner = async (args) => {
    const file = args[args.indexOf("--append-system-prompt") + 1];
    seen.push(file ? readFileSync(file, "utf8") : "");
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Completed\nx" }], model: "p/m", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } }), stderr: "", killed: false, timedOut: false };
  };
  const picker = { select: async () => { throw new Error("boom"); } };
  await runWorker({ taskId: "T", domain: "backend", instruction: "step", taskText: "Fix billing", scoutOutcomes: [], cwd: data, dataRoots: [data], config: DEFAULT_CONFIG, knowledge: picker }, runner);
  assert.match(seen[0]!, /## Knowledge\n\n# Knowledge\n\nBilling uses cents\./);
});

/** A fake pi that records its system prompt. */
function recorder(seen: string[]): ProcessRunner {
  return async (args) => {
    const file = args[args.indexOf("--append-system-prompt") + 1];
    seen.push(file ? readFileSync(file, "utf8") : "");
    const text = args.includes("read,grep,find,ls") ? "## Scope\nx" : "## Completed\nx\n\n## Verdict\nPASS";
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/m", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } }), stderr: "", killed: false, timedOut: false };
  };
}

test("scouts, workers and the QA gate carry Jev's picks from a long decisions file, with the path to the rest", async () => {
  const data = mkdtempSync(join(tmpdir(), "bl-kn-"));
  mkdirSync(knowledgeDir(data, "backend"), { recursive: true });
  mkdirSync(knowledgeDir(data, "qa"), { recursive: true });
  writeFileSync(join(knowledgeDir(data, "backend"), "decisions.md"), longFile("# Decisions"));
  writeFileSync(join(knowledgeDir(data, "qa"), "decisions.md"), longFile("# Decisions"));
  const calls: Call[] = [];
  const picker = knowledgePicker(jev(sectionJev((text) => (text.startsWith("## webhooks") ? 0.9 : 0.05), calls)));
  const seen: string[] = [];
  const common = { taskId: "T", cwd: data, dataRoots: [data], config: DEFAULT_CONFIG, knowledge: picker };
  await runScouts({ ...common, taskText: "Retry failed deliveries", instruction: "Find the webhooks code.", domains: ["backend"], taskDir: mkdtempSync(join(tmpdir(), "bl-kn-t-")) }, recorder(seen));
  await runWorker({ ...common, domain: "backend", instruction: "Step 1: retry webhooks with backoff", taskText: "Retry failed deliveries", scoutOutcomes: [] }, recorder(seen));
  await runReviewer({ ...common, domain: "qa", taskText: "Retry failed deliveries with webhooks", workerSummary: "webhooks retried", scoutOutcomes: [], diff: "diff" }, recorder(seen));
  assert.equal(seen.length, 3);
  const decisions = join(knowledgeDir(data, "backend"), "decisions.md");
  for (const system of seen.slice(0, 2)) {
    assert.match(system, /## Decisions\n\n## webhooks\nThe webhooks module lives in src\/webhooks\./);
    assert.doesNotMatch(system, /## email\nThe email module/);
    assert.ok(system.includes(`_Kept 1 of 13 sections of decisions.md for this step. The whole file is ${decisions}._`), system.slice(system.indexOf("## Decisions")));
  }
  assert.ok(seen[2]!.includes(`The whole file is ${join(knowledgeDir(data, "qa"), "decisions.md")}._`), "the QA gate is pointed at its own agent's file");
  assert.equal(calls.length, 3, "one call per long file, one file per run");
  assert.match(calls[1]!.task, /^Step 1: retry webhooks with backoff/, "the step leads, so it survives clipping the task");
});
