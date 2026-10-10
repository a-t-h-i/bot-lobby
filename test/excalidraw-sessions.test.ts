import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runAgent, type AgentRequest } from "../src/execution/agent-runner.ts";
import { runPiAgent, type ProcessOutcome, type ProcessRunner } from "../src/execution/pi-runner.ts";
import { agentOfRun, AGENT_LABELS, bindExcalidraw, EXCALIDRAW_AGENTS, ExcalidrawBook, excalidrawGrant, grantEnv, grantNote, grantOption, MAX_SESSIONS, readGrant, toolsOf } from "../src/excalidraw/sessions.ts";
import { newRoomLink, parseRoomLink } from "../src/excalidraw/room.ts";

function book(): { book: ExcalidrawBook; file: string; root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "bl-xd-project-"));
  const dir = mkdtempSync(join(tmpdir(), "bl-xd-lists-"));
  const made = new ExcalidrawBook({ root, dir, now: () => new Date("2026-09-30T12:00:00.000Z") });
  return { book: made, file: made.path, root, dir };
}

test("at most five sessions: links added or rooms made, the sixth is refused and says what to do", () => {
  const { book: sessions } = book();
  assert.deepEqual(sessions.list(), []);
  for (let index = 0; index < 3; index += 1) assert.ok(sessions.add(newRoomLink().url, `Board ${index + 1}`).session);
  for (let index = 0; index < 2; index += 1) assert.ok(sessions.create(`Made ${index + 1}`).session);
  assert.equal(sessions.list().length, MAX_SESSIONS);
  assert.equal(MAX_SESSIONS, 5);
  const sixthLink = sessions.add(newRoomLink().url, "Sixth");
  assert.equal(sixthLink.session, undefined);
  assert.match(sixthLink.notice, /all 5 sessions are in use — remove one first/);
  assert.equal(sessions.create("Sixth").session, undefined);
  assert.equal(sessions.list().length, 5, "nothing was added");
  // Room for another once one is removed.
  const first = sessions.list()[0]!;
  assert.equal(sessions.remove(first.id), `removed “${first.name}”`);
  assert.ok(sessions.create("Again").session);
});

test("a session keeps its name, its cleaned link and a default of no agents and drawing allowed", () => {
  const { book: sessions } = book();
  const link = newRoomLink("https://draw.example.org");
  const { session, notice } = sessions.add(`  ${link.url}  `, "  Architecture   review  ");
  assert.equal(session?.name, "Architecture review");
  assert.equal(session?.link, link.url);
  assert.deepEqual([session?.agents, session?.contribute, session?.addedAt], [[], true, "2026-09-30T12:00:00.000Z"]);
  assert.match(notice, /added “Architecture review” \(1 of 5\)/);
  assert.equal(sessions.add(link.url, "Same room again").session, undefined, "a room is added once");
  assert.match(sessions.add(link.url).notice, /already added/);
  assert.equal(sessions.add("https://excalidraw.com/#room=abc").session, undefined);
  assert.match(sessions.add("nonsense").notice, /not an Excalidraw room link/);
  assert.equal(sessions.add(newRoomLink().url).session?.name, "Session 2", "unnamed: numbered");
  assert.equal(sessions.add(newRoomLink().url, "x".repeat(100)).session?.name.length, 40);
});

test("sessions are assigned to one agent or several, and taken back", () => {
  const { book: sessions } = book();
  const id = sessions.create("Board").session!.id;
  assert.equal(sessions.toggleAgent(id, "qa"), "QA has this session now");
  assert.equal(sessions.toggleAgent(id, "master"), "Master (oracle) has this session now");
  assert.equal(sessions.toggleAgent(id, "designer"), "Designer has this session now");
  assert.deepEqual(sessions.list()[0]!.agents, ["master", "designer", "qa"], "kept in the agents' own order");
  assert.equal(sessions.toggleAgent(id, "qa"), "QA no longer has this session");
  assert.deepEqual(sessions.list()[0]!.agents, ["master", "designer"]);
  assert.equal(sessions.toggleAll(id), "assigned to every agent");
  assert.deepEqual(sessions.list()[0]!.agents, [...EXCALIDRAW_AGENTS]);
  assert.equal(sessions.toggleAll(id), "taken back from every agent");
  assert.deepEqual(sessions.list()[0]!.agents, []);
  assert.equal(sessions.toggleAgent("nope", "qa"), "no such session");
  assert.equal(Object.keys(AGENT_LABELS).length, EXCALIDRAW_AGENTS.length, "every assignable agent has a name");
});

test("agents may draw or only look, and a session can be renamed or removed", () => {
  const { book: sessions } = book();
  const id = sessions.create("Board").session!.id;
  assert.equal(sessions.toggleContribute(id), "agents may only look at this session");
  assert.equal(sessions.list()[0]!.contribute, false);
  assert.equal(sessions.toggleContribute(id), "agents may draw in this session");
  assert.equal(sessions.rename(id, "  New   name "), "renamed to “New name”");
  assert.equal(sessions.list()[0]!.name, "New name");
  assert.equal(sessions.rename(id, "   "), "a session needs a name");
  assert.equal(sessions.rename("nope", "x"), "no such session");
  assert.equal(sessions.remove("nope"), "no such session");
  assert.equal(sessions.remove(id), "removed “New name”");
  assert.deepEqual(sessions.list(), []);
});

test("the list is shared by every pi session of the project; a damaged or hand-edited file cannot break it", () => {
  const { book: sessions, file, root, dir } = book();
  const id = sessions.create("Board").session!.id;
  sessions.toggleAgent(id, "backend");
  const other = new ExcalidrawBook({ root, dir });
  assert.deepEqual(other.list().map((session) => [session.name, session.agents]), [["Board", ["backend"]]]);
  writeFileSync(file, "{ not json");
  assert.deepEqual(other.list(), []);
  const link = newRoomLink().url;
  // Eight entries, one id twice, one without a link, one with junk agents and no name: the first five good ones are kept.
  const entries = [
    ...Array.from({ length: 4 }, (_, index) => ({ id: `s${index}`, name: `S${index}`, link: newRoomLink().url, agents: ["qa", "ghost"], contribute: false })),
    { id: "s0", name: "Duplicate id", link },
    { id: "bad", name: "No link" },
    { id: "s4", link, agents: "everyone" },
    { id: "s5", name: "Too many", link: newRoomLink().url },
  ];
  writeFileSync(file, JSON.stringify({ sessions: entries }));
  const list = other.list();
  assert.deepEqual(list.map((session) => session.id), ["s0", "s1", "s2", "s3", "s4"]);
  assert.deepEqual(list[0]!.agents, ["qa"], "unknown agents are dropped");
  assert.equal(list[0]!.contribute, false);
  assert.equal(list[4]!.name, `Session ${parseRoomLink(link)!.roomId.slice(0, 6)}`, "a session without a name is named after its room");
  assert.deepEqual(list[4]!.agents, []);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).sessions.length, 8, "reading does not rewrite the file");
});

test("an agent is handed only the sessions assigned to it, with whether it may draw", () => {
  const { book: sessions } = book();
  const one = sessions.create("Architecture").session!;
  const two = sessions.create("Wireframes").session!;
  sessions.toggleAgent(one.id, "designer");
  sessions.toggleAgent(one.id, "backend");
  sessions.toggleAgent(two.id, "designer");
  sessions.toggleContribute(two.id);
  assert.equal(sessions.grantFor("qa"), undefined, "nothing assigned, no grant");
  const backend = sessions.grantFor("backend")!;
  assert.deepEqual(backend.sessions.map((session) => [session.name, session.contribute]), [["Architecture", true]]);
  const designer = sessions.grantFor("designer")!;
  assert.equal(designer.agent, "designer");
  assert.deepEqual(designer.sessions.map((session) => [session.name, session.contribute]), [["Architecture", true], ["Wireframes", false]]);
  assert.deepEqual(toolsOf(designer), ["excalidraw_read", "excalidraw_draw"]);
  assert.deepEqual(toolsOf({ agent: "designer", sessions: [designer.sessions[1]!] }), ["excalidraw_read"], "only look-only sessions: no drawing tool");
  assert.match(grantNote(designer), /"Architecture", "Wireframes" \(look only\)/);
  assert.match(grantNote(designer), /excalidraw_read.*excalidraw_draw/s);
  assert.doesNotMatch(grantNote({ agent: "designer", sessions: [designer.sessions[1]!] }), /excalidraw_draw/);
});

test("a subagent reads its grant from its environment, and a damaged one gives it nothing", () => {
  const { book: sessions } = book();
  const made = sessions.create("Board").session!;
  sessions.toggleAgent(made.id, "scout");
  const grant = sessions.grantFor("scout")!;
  assert.deepEqual(readGrant(grantEnv(grant)), grant);
  assert.equal(readGrant({}), undefined);
  for (const bad of ["", "{", "[]", "null", JSON.stringify({ agent: "ghost", sessions: grant.sessions }), JSON.stringify({ agent: "scout", sessions: "x" }), JSON.stringify({ agent: "scout", sessions: [{ id: "a", link: "nope" }] }), JSON.stringify({ agent: "scout", sessions: [] })]) {
    assert.equal(readGrant({ BOT_LOBBY_EXCALIDRAW: bad }), undefined, `"${bad}"`);
  }
  assert.equal(readGrant({ BOT_LOBBY_EXCALIDRAW: JSON.stringify({ agent: "scout", sessions: [{ id: "a", link: made.link, name: "", contribute: false }, { nope: 1 }] }) })?.sessions.length, 1, "a good entry survives a bad one");
});

test("a workflow run is the agent of its role or its domain", () => {
  assert.equal(agentOfRun("backend", "scout"), "scout");
  assert.equal(agentOfRun("qa", "researcher"), "researcher");
  assert.equal(agentOfRun("backend", "worker"), "backend");
  assert.equal(agentOfRun("designer", "worker"), "designer");
  assert.equal(agentOfRun("qa", "reviewer"), "qa");
});

test("the grant of a process's book decides which runs get the tools, the room links and a note", async () => {
  const { book: sessions } = book();
  const made = sessions.create("Board").session!;
  sessions.toggleAgent(made.id, "quickfix");
  bindExcalidraw(sessions);
  try {
    assert.equal(excalidrawGrant("qa"), undefined);
    assert.deepEqual(grantOption("qa"), {});
    let seen: { args: string[]; env?: Record<string, string>; prompt?: string } | undefined;
    const capture: ProcessRunner = async (args, options): Promise<ProcessOutcome> => {
      seen = { args, ...(options.env ? { env: options.env } : {}), ...(options.prompt ? { prompt: options.prompt } : {}) };
      return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } }), stderr: "", killed: false, timedOut: false };
    };
    // A run with an allowlist gets the tools added to it.
    await runPiAgent({ cwd: "/p", task: "fix it", timeoutMs: 1000, tools: ["read", "edit"], env: { KEEP: "1" }, ...grantOption("quickfix") }, capture);
    assert.equal(seen!.args[seen!.args.indexOf("--tools") + 1], "read,edit,excalidraw_read,excalidraw_draw,codemode,tool_search,delegate_subtasks,claim_file,handover_file,my_files,wait_for_files");
    assert.equal(seen!.env!.KEEP, "1");
    assert.deepEqual(readGrant(seen!.env), excalidrawGrant("quickfix"), "the room links travel in the environment");
    assert.match(seen!.prompt!, /^Task: fix it\n\nShared Excalidraw whiteboard assigned to you: "Board"\./);
    // A run without a grant is untouched.
    await runPiAgent({ cwd: "/p", task: "fix it", timeoutMs: 1000, tools: ["read"], ...grantOption("qa") }, capture);
    assert.equal(seen!.args[seen!.args.indexOf("--tools") + 1], "read,codemode,tool_search,delegate_subtasks");
    assert.ok(seen!.env!.BOT_LOBBY_AGENT_POLICY);
    assert.equal(seen!.prompt, "Task: fix it");
    // Without an allowlist the standard built-ins are retained.
    await runPiAgent({ cwd: "/p", task: "x", timeoutMs: 1000, ...grantOption("quickfix") }, capture);
    assert.equal(seen!.args[seen!.args.indexOf("--tools") + 1], "read,bash,edit,write,grep,find,ls,excalidraw_read,excalidraw_draw,codemode,tool_search,delegate_subtasks,claim_file,handover_file,my_files,wait_for_files");
  } finally {
    bindExcalidraw(undefined);
  }
});

test("workflow agents get the tools by their role or domain, and only when a session is assigned to them", async () => {
  const { book: sessions } = book();
  const made = sessions.create("Board").session!;
  sessions.toggleAgent(made.id, "scout");
  sessions.toggleAgent(made.id, "designer");
  sessions.toggleContribute(made.id);
  bindExcalidraw(sessions);
  try {
    const tools: string[] = [];
    const capture: ProcessRunner = async (args): Promise<ProcessOutcome> => {
      tools.push(args[args.indexOf("--tools") + 1]!);
      return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } }), stderr: "", killed: false, timedOut: false };
    };
    const base: AgentRequest = { taskId: "T", domain: "backend", role: "scout", instruction: "look", context: { task: "t" }, timeoutMs: 1000, cwd: "/p" };
    await runAgent(base, capture);
    await runAgent({ ...base, domain: "backend", role: "worker" }, capture);
    await runAgent({ ...base, domain: "designer", role: "worker" }, capture);
    assert.equal(tools[0], "read,grep,find,ls,excalidraw_read,codemode,tool_search,delegate_subtasks", "a scout of any domain is a scout; look-only, so no drawing");
    assert.equal(tools[1], "read,bash,edit,write,grep,find,ls,codemode,tool_search,delegate_subtasks,claim_file,handover_file,my_files,wait_for_files", "the backend worker has no session");
    assert.equal(tools[2], "read,bash,edit,write,grep,find,ls,excalidraw_read,codemode,tool_search,delegate_subtasks,claim_file,handover_file,my_files,wait_for_files", "the designer's worker has the look-only one");
  } finally {
    bindExcalidraw(undefined);
  }
});

test("a room link never lands in the project: each project has its own file among the user's settings", () => {
  const first = book();
  const link = newRoomLink();
  first.book.add(link.url, "Board");
  assert.ok(readFileSync(first.file, "utf8").includes(link.roomKey), "the link is kept whole");
  assert.ok(!first.file.startsWith(first.root), "and not inside the project, where a commit could publish it");
  assert.ok(!existsSync(join(first.root, ".pi")), "nothing was written there at all");
  // Another project, even one with the same folder name, has its own list.
  const rival = new ExcalidrawBook({ root: join(first.root, "..", "..", "elsewhere", basename(first.root)), dir: first.dir });
  assert.deepEqual(rival.list(), []);
  assert.notEqual(rival.path, first.file);
  assert.equal(dirname(rival.path), dirname(first.file));
});
