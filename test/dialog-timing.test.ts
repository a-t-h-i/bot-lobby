import { test } from "node:test";
import assert from "node:assert/strict";
import { BackgroundSession } from "../src/lobby/sessions.ts";
import { FakeSessionProcess } from "./fake-session.ts";

test("background choose/confirm/text/editor waits associate with owner and resolve on answer/abort/exit", () => {
  const proc = new FakeSessionProcess();
  const events: Array<[string, boolean, string?]> = [];
  const session = new BackgroundSession(proc, { name: "Task", projectRoot: "/project", onDialog: (...args) => events.push(args) });
  proc.emit({ type: "response", command: "get_state", data: { sessionId: "owner" } });
  for (const [index, method] of ["select", "confirm", "input", "editor"].entries()) {
    proc.emit({ type: "extension_ui_request", id: String(index), method, title: method });
  }
  assert.deepEqual(events, [["0", true, "owner"], ["1", true, "owner"], ["2", true, "owner"], ["3", true, "owner"]]);
  session.answer("0", { value: "A" });
  session.answer("1", { confirmed: true });
  session.abort();
  assert.deepEqual(events.slice(4), [["0", false, "owner"], ["1", false, "owner"], ["2", false, "owner"], ["3", false, "owner"]]);
  proc.emit({ type: "extension_ui_request", id: "exit", method: "input", title: "Wait" });
  proc.exit(1);
  assert.deepEqual(events.slice(-2), [["exit", true, "owner"], ["exit", false, "owner"]]);
  assert.equal(session.dialogs.length, 0);
});
