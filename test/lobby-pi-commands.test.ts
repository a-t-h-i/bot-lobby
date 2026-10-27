import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompactOptions, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { piCommands, sendPiCommand } from "../src/lobby/pi-commands.ts";
import { onNotice } from "../src/webui/notices.ts";

function fake(mode = "tui") {
  const sent: unknown[] = [];
  const editor: string[] = [];
  const compactions: CompactOptions[] = [];
  const pi = { getCommands: () => [], sendUserMessage: (...args: unknown[]) => sent.push(args) } as unknown as ExtensionAPI;
  const ctx = { mode, isIdle: () => true, compact: (options: CompactOptions) => compactions.push(options),
    ui: { getEditorText: () => "", setEditorText: (text: string) => editor.push(text) } } as unknown as ExtensionContext;
  return { pi, ctx, sent, editor, compactions };
}

function installed(pi: ExtensionAPI) {
  pi.getCommands = () => [
    { name: "skill:pdf-tools", description: "Read PDFs", source: "skill", sourceInfo: { path: "/skills/pdf/SKILL.md" } },
    { name: "review", description: "Review code", source: "prompt", sourceInfo: { path: "/prompts/review.md" } },
    { name: "mcp", description: "MCP servers", source: "extension", sourceInfo: { path: "/extensions/mcp.ts" } },
    { name: "compact", description: "collision", source: "prompt", sourceInfo: { path: "/prompts/compact.md" } },
  ] as ReturnType<ExtensionAPI["getCommands"]>;
}

test("Pi command discovery includes every native command and installed resources without paths or duplicates", () => {
  const { pi } = fake(); installed(pi);
  const commands = piCommands(pi);
  for (const name of ["settings", "model", "tree", "thinking", "scoped-models", "export", "import", "share", "bug", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout", "new", "compact", "resume", "reload", "quit", "skill:pdf-tools", "review", "mcp"]) {
    assert.ok(commands.some((command) => command.name === name), name);
  }
  assert.equal(commands.filter((command) => command.name === "compact").length, 1);
  assert.ok(commands.find((command) => command.name === "login")!.terminal);
  assert.equal(commands.find((command) => command.name === "compact")!.terminal, undefined);
  assert.doesNotMatch(JSON.stringify(commands), /SKILL\.md|\/prompts\//);
});

test("the native catalog matches the supported Pi version", async () => {
  const file = new URL("./core/slash-commands.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { BUILTIN_SLASH_COMMANDS } = await import(file.href);
  assert.deepEqual(piCommands().map((command) => command.name), BUILTIN_SLASH_COMMANDS.map((command: { name: string }) => command.name));
});

test("compact invokes Pi compaction with instructions, reports completion and errors, never prompts", () => {
  const f = fake(); const notices: string[] = [];
  const stop = onNotice((notice) => notices.push(notice.text));
  try {
    assert.match(sendPiCommand(f.pi, f.ctx, "/compact keep the API contract"), /compacting/i);
    assert.equal(f.compactions[0]!.customInstructions, "keep the API contract");
    f.compactions[0]!.onComplete!({} as never);
    f.compactions[0]!.onError!(new Error("provider offline"));
    assert.ok(notices.some((text) => /compacted/i.test(text)));
    assert.ok(notices.some((text) => /provider offline/.test(text)));
    assert.deepEqual(f.sent, []);
    assert.deepEqual(f.editor, []);
  } finally { stop(); }
});

test("compact refuses to interrupt active work", () => {
  const f = fake(); f.ctx.isIdle = () => false;
  assert.match(sendPiCommand(f.pi, f.ctx, "/compact"), /stop|working|idle/i);
  assert.deepEqual(f.compactions, []);
  assert.deepEqual(f.sent, []);
});

test("native terminal commands preserve arguments and never become model prompts", () => {
  const f = fake();
  assert.match(sendPiCommand(f.pi, f.ctx, "/login anthropic"), /press Enter.*terminal/i);
  assert.deepEqual(f.editor, ["/login anthropic"]);
  assert.deepEqual(f.sent, []);
});

test("terminal handoff refuses to overwrite a draft or claim success in RPC mode", () => {
  const f = fake(); f.ctx.ui.getEditorText = () => "unfinished request";
  assert.match(sendPiCommand(f.pi, f.ctx, "/tree"), /draft/i);
  assert.deepEqual(f.editor, []);
  const rpc = fake("rpc");
  assert.match(sendPiCommand(rpc.pi, rpc.ctx, "/resume"), /requires.*terminal/i);
  assert.deepEqual(rpc.editor, []);
  assert.deepEqual(rpc.sent, []);
});

test("skills, prompt templates and extension commands use Pi expansion and queue while busy", () => {
  const f = fake(); installed(f.pi); f.ctx.isIdle = () => false;
  for (const text of ["/skill:pdf-tools extract report.pdf", "/review changes", "/mcp"]) {
    assert.match(sendPiCommand(f.pi, f.ctx, text), /sent/);
    assert.deepEqual(f.sent.at(-1), [text, { expandPromptTemplates: true, deliverAs: "followUp" }]);
  }
});

test("manually typed skills work even when hidden from discovery; unknown commands do not prompt", () => {
  const f = fake();
  sendPiCommand(f.pi, f.ctx, "/skill:manual-only arguments");
  assert.deepEqual(f.sent[0], ["/skill:manual-only arguments", { expandPromptTemplates: true }]);
  assert.match(sendPiCommand(f.pi, f.ctx, "/not-a-command"), /unknown/i);
  assert.equal(f.sent.length, 1);
});
