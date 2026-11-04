import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerOrchestrateTool } from "../src/pi/tools.ts";
import { setQuiet } from "../src/pi/quiet.ts";

type Rendered = { render(width: number): string[] };

/** A pi that keeps what bot-lobby registers: its transcript entry renderer and its tool. */
function capture() {
  const got: { entry?: (entry: unknown, options: { expanded: boolean }, theme: unknown) => Rendered; tool?: { renderResult: (result: unknown, options: { expanded: boolean }, theme: unknown) => Rendered } } = {};
  const pi = {
    registerEntryRenderer: (_name: string, render: typeof got.entry) => { got.entry = render; },
    registerTool: (tool: typeof got.tool) => { got.tool = tool; },
  } as unknown as ExtensionAPI;
  registerOrchestrateTool(pi, ".pi");
  return got;
}

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const text = (component: Rendered) => component.render(60).map((line) => stripTerminalSequences(line).trimEnd()).join("\n");

test("in pi's own chat, a proposal and an expanded orchestrate report render as Markdown", () => {
  initTheme("dark", false);
  const got = capture();
  const proposal = text(got.entry!({ data: { kind: "proposal", taskId: "TASK-1", text: "- **Save** buttons keep their fill\n- quick view returns `focus`" } }, { expanded: true }, theme));
  assert.match(proposal, /^bot-lobby TASK-1 — proposal\n- Save buttons keep their fill\n- quick view returns focus$/);
  const escaped = text(got.entry!({ data: { kind: "proposal", taskId: "TASK-1", text: "- one\\n- two" } }, { expanded: true }, theme));
  assert.match(escaped, /- one\n- two/, "written-out line breaks read as breaks");
  setQuiet(false);
  const report = text(got.tool!.renderResult({ content: [{ type: "text", text: "QA gate: PASS\nFindings:\n- [minor] rename `helper`" }], details: { ok: true, taskId: "TASK-1", state: "reviewing" } }, { expanded: true }, theme));
  assert.match(report, /✓ orchestrate TASK-1 → reviewing\nQA gate: PASS\nFindings:\n\n?- \[minor\] rename helper/);
  const collapsed = text(got.tool!.renderResult({ content: [{ type: "text", text: "QA gate: PASS" }], details: { ok: true, taskId: "TASK-1", state: "reviewing" } }, { expanded: false }, theme));
  assert.equal(collapsed, "✓ orchestrate TASK-1 → reviewing");
  setQuiet(true);
});
