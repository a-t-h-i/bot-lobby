import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DESIGN_FIELD_KEYS, choiceValue, designRecordBlock, designRecordPath, designStanding, parseDesignRecord, recordDesignChoices,
  styleFields, styleQuestions, withDesignChoices, withoutDesignRecord,
} from "../src/knowledge/design-record.ts";
import { parseMemberReply } from "../src/lobby/planner.ts";
import { styleAnswers } from "../src/lobby/ask.ts";
import { dataRoot } from "../src/state/project.ts";
import { runWorkflowAction } from "../src/workflow/workflow.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "bl-design-record-"));
}

test("choices go under ## Design record, replace in place, and leave the rest of the file alone", () => {
  const start = "# Design Language\n\nVisual language.\n\n# 2026-10-01\n\n- Use the Button component.\n";
  const once = withDesignChoices(start, [{ field: "radius", value: "Soft: 6 to 8px corners", by: "you", date: "2026-10-26" }]);
  assert.match(once, /- Use the Button component\./, "other entries stay");
  assert.match(once, /## Design record\n\nSettled visual choices[^\n]*\n\n- \*\*Corner radius:\*\* Soft: 6 to 8px corners _\(you, 2026-10-26\)_\n$/);
  const twice = withDesignChoices(once, [
    { field: "radius", value: "Round", by: "you" },
    { field: "spacing", value: "Compact", by: "agent", taskId: "T-12", date: "2026-10-27" },
  ]);
  assert.equal((twice.match(/Corner radius/g) ?? []).length, 1, "replaced, not added");
  assert.ok(twice.indexOf("Spacing and padding") < twice.indexOf("Corner radius"), "kept in the fields' order");
  const record = parseDesignRecord(twice);
  assert.deepEqual(record.get("radius"), { field: "radius", value: "Round", by: "you" });
  assert.deepEqual(record.get("spacing"), { field: "spacing", value: "Compact", by: "agent", taskId: "T-12", date: "2026-10-27" });
  assert.doesNotMatch(withoutDesignRecord(twice), /Design record|Corner radius/);
  assert.match(withoutDesignRecord(twice), /Use the Button component/);
});

test("a line edited by hand in Knowledge still reads, by label or key", () => {
  const text = "# Design Language\n\n## Design record\n\n- **corner radius:** 4px everywhere\n- **motion:** none _(agent, T-3)_\n- **Unknown:** x\n";
  const record = parseDesignRecord(text);
  assert.equal(record.get("radius")?.value, "4px everywhere");
  assert.equal(record.get("radius")?.by, "you");
  assert.equal(record.get("motion")?.by, "agent");
  assert.equal(record.size, 2);
});

test("what the code settles is read from its tokens and most-used classes; only the rest are gaps", () => {
  const root = tempRoot();
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "lib"), { recursive: true });
  writeFileSync(join(root, "src", "index.css"), ":root { --radius: 0.5rem; --shadow-card: 0 1px 2px #0002; }\n.btn:hover{} a:hover{} li:hover{}\n");
  writeFileSync(join(root, "src", "App.tsx"), `export const A = () => <div className="p-4 gap-2 p-4 px-3 p-4 border border border border border">x</div>;\n`);
  writeFileSync(join(root, "node_modules", "lib", "x.css"), ":root{--duration-fast: 100ms}");
  const data = dataRoot(root, ".pi");
  const standing = designStanding(data, root);
  assert.deepEqual(standing.sheets, [join("src", "index.css")]);
  assert.match(standing.fromCode.get("radius")!, /--radius: 0\.5rem/);
  assert.match(standing.fromCode.get("shadows")!, /--shadow-card/);
  assert.match(standing.fromCode.get("spacing")!, /p-4 \(3×\)/);
  assert.match(standing.fromCode.get("borders")!, /border \(5×\)/);
  assert.match(standing.fromCode.get("hover")!, /3 :hover rules/);
  assert.deepEqual(standing.gaps, ["motion"], "node_modules is not the project's style");
  recordDesignChoices(data, [{ field: "motion", value: "Quick and calm", by: "you" }]);
  const after = designStanding(data, root);
  assert.deepEqual(after.gaps, []);
  const block = designRecordBlock(after, "task");
  assert.match(block, /Motion: Quick and calm \(the user chose this\)/);
  assert.match(block, /Corner radius: follow the code/);
  assert.doesNotMatch(block, /Not settled/);
});

test("the open fields read differently in planning (request them under ## Style) and in a task (never ask, report the choice)", () => {
  const root = tempRoot();
  const standing = designStanding(dataRoot(root, ".pi"), root);
  assert.deepEqual(standing.gaps, DESIGN_FIELD_KEYS);
  assert.match(designRecordBlock(standing, "planning"), /list the ones it touches under ## Style/);
  assert.match(designRecordBlock(standing, "task"), /Do not ask the user about them[\s\S]*Design choices/);
});

test("DESIGN's ## Style names fields; the engine's questions offer fixed options, each drawn, and the answers map back to fields", () => {
  const reply = parseMemberReply("## Status\nOPEN\n## Questions\n1. Modal or drawer?\n   - Modal — x\n   - Drawer — y\n## Style\n- Radius, hover\n- typography");
  assert.deepEqual(reply.style, ["radius", "hover"]);
  assert.deepEqual(styleFields(undefined), []);
  const questions = styleQuestions(["radius", "hover"]).map((question) => ({ ...question, from: "DESIGN" }));
  assert.equal(questions[0]!.text, "How rounded should corners be?");
  assert.ok(questions.every((question) => question.options.length >= 3 && question.options.every((option) => option.mockup.html && option.mockup.css)));
  const answers = styleAnswers(questions, [{ cancelled: false, answers: [{ questionIndex: 0, kind: "single", answer: "Soft" }, { questionIndex: 1, kind: "single", answer: "only a colour change" }] } as never]);
  assert.deepEqual(answers, [{ field: "radius", answer: "Soft" }, { field: "hover", answer: "only a colour change" }]);
  assert.equal(choiceValue("radius", "soft"), "Soft: 6 to 8px corners");
  assert.equal(choiceValue("hover", "only a colour change"), "only a colour change");
});

test("action=design records a choice without a task, the user's with note=user, and rejects an unknown field", async () => {
  const root = tempRoot();
  const deps = { root, configDir: ".pi" } as never;
  const ok = await runWorkflowAction({ action: "design", name: "Spacing", text: "Roomy" } as never, deps);
  assert.equal(ok.ok, true, ok.message);
  const user = await runWorkflowAction({ action: "design", name: "motion", text: "none", note: "user" } as never, deps);
  assert.equal(user.ok, true, user.message);
  const record = parseDesignRecord(readFileSync(designRecordPath(dataRoot(root, ".pi")), "utf8"));
  assert.equal(record.get("spacing")?.by, "agent");
  assert.equal(record.get("motion")?.by, "you");
  const bad = await runWorkflowAction({ action: "design", name: "colour", text: "blue" } as never, deps);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /one of spacing, radius/);
});
