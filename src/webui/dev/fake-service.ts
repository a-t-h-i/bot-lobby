/**
 * A fixture-backed `LobbyService` for `npm run web:dev`: the real server
 * answers the protocol calls from one scenario's fixtures, so the page
 * builds with no Pi. Dev-only; never imported by production code or tests
 * (tests use `test/webui-fake.ts`).
 */
import { resolveConfig, type BotLobbyConfig } from "../../schemas/configuration.ts";
import { LobbyFeed } from "../../lobby/feed.ts";
import { promptHub } from "../../lobby/prompt-hub.ts";
import { lobbyTopics } from "../../lobby/topics.ts";
import { CHAT_AGENT_SOURCES, parseLobbyCommand, parseMention } from "../../lobby/prompts.ts";
import { piCommands } from "../../lobby/pi-commands.ts";
import type { BackgroundSession, DialogAnswer, SessionDialog } from "../../lobby/sessions.ts";
import { cleanSessionName } from "../../lobby/sessions.ts";
import type { PlanComment } from "../../state/comments.ts";
import type { LobbyService } from "../../lobby/host.ts";
import { loadScenario, type ScenarioFixture } from "./fixtures.ts";
import { HARNESSES, harnessCommand, harnessModels } from "../../harness/catalog.ts";
import { HARNESS_IDS } from "../../schemas/harness.ts";
import type { PlanRecord, PlanSummary } from "../../state/plan-history.ts";

interface StreamState {
  step?: ReturnType<typeof setTimeout>;
  followUp?: ReturnType<typeof setTimeout>;
}

/** A planning session as canned fixture data: the same fields the planner calls read. */
function fakePlanner(entry: NonNullable<ScenarioFixture["mockPlanner"]>): Record<string, unknown> & { seats: Set<string> } {
  const seats = new Set<string>(entry.seats);
  const session = {
    seats,
    members: entry.members.map((member) => ({ ...member })),
    messages: entry.messages.map((message) => ({ ...message })),
    reply: entry.draft ? { status: "grilling", questions: [], plan: entry.draft } : undefined,
    questions: entry.questions.map((question) => ({ ...question })),
    notes: entry.notes.map((note) => ({ ...note })),
    turns: entry.round,
    busy: false,
    awaitingAnswers: entry.questions.length > 0,
    retryable: entry.retryable,
    lineComments: [] as Array<{ line: string; text: string }>,
    toggle(member: string): boolean {
      if (seats.has(member)) seats.delete(member);
      else seats.add(member);
      return seats.has(member);
    },
    async send(text: string): Promise<void> {
      (session.messages as Array<Record<string, unknown>>).push({ role: "you", text, at: Date.now() });
    },
    async editMessage(messageIndex: number, at: number, text: string): Promise<void> {
      const message = session.messages[messageIndex];
      if (session.busy || !message || message.at !== at) throw new Error("the message has changed");
      if (message.role !== "you" || (Array.isArray(message.settled) && message.settled.length > 0)) throw new Error("only ordinary user messages can be edited");
      if (!text.trim()) throw new Error("an edited message needs some text");
      session.messages[messageIndex] = { ...message, text: text.trim(), editedAt: Date.now() };
    },
    async retry(): Promise<void> {},
    commentOnLine(line: string, text: string): boolean {
      session.lineComments.push({ line, text });
      return false;
    },
  };
  return session;
}

function defaultPlanner(): NonNullable<ScenarioFixture["mockPlanner"]> {
  return { seats: ["backend", "designer", "qa", "researcher"], members: [], messages: [], questions: [], notes: [], round: 0, retryable: false };
}

const DETAIL_ONLY = ["body", "state", "mergeable", "files", "notes", "comments"] as const;

/** The models the mock offers, unless a scenario's settings name its own. */
const DEFAULT_MODELS: Array<{ id: string; label: string; thinkingLevels: string[] }> = [
  { id: "mock/gpt-5", label: "Mock GPT-5", thinkingLevels: ["low", "medium", "high"] },
  { id: "mock/gpt-5-mini", label: "Mock GPT-5 mini", thinkingLevels: ["minimal", "low", "medium"] },
];

const streams = new WeakMap<object, StreamState>();
const opened = new WeakMap<object, string[]>();

function track(service: object, id: string): void {
  const list = opened.get(service) ?? [];
  list.push(id);
  opened.set(service, list);
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  timer.unref?.();
}

function stopStream(service: object): void {
  const state = streams.get(service);
  if (!state) return;
  if (state.step) clearTimeout(state.step);
  if (state.followUp) clearTimeout(state.followUp);
  streams.delete(service);
}

function seedFeed(feed: LobbyFeed, fixture: ScenarioFixture): void {
  feed.seedChat(fixture.feed.chat);
  feed.chatOlder = fixture.feed.chatOlder;
  for (const entry of fixture.feed.activity) {
    if (entry.pending) feed.begin(entry.source, entry.text);
    else feed.log(entry.source, entry.text, entry.kind);
  }
  for (const entry of fixture.feed.thoughts) {
    if (entry.live) feed.thinkDelta(entry.source, entry.text);
    else feed.thought(entry.source, entry.text);
  }
  if (fixture.feed.reply) feed.replyDelta(fixture.feed.reply);
}

function seedPrompts(service: object, fixture: ScenarioFixture): void {
  for (const prompt of fixture.prompts) track(service, promptHub.open(prompt.kind, prompt.from, prompt.payload).id);
  for (const settled of fixture.settled) promptHub.answer(promptHub.open(settled.kind, settled.from, settled.payload).id, settled.answer);
}

/** A background session as live fixture data: its own feed, dialogs, and canned answers. */
function fakeBackground(entry: NonNullable<ScenarioFixture["backgroundSessions"]>[number]): BackgroundSession {
  const feed = new LobbyFeed();
  let status = entry.status;
  const dialogs = ((entry.dialogs ?? []) as unknown as SessionDialog[]).map((dialog) => ({ ...dialog }));
  const session = {
    key: entry.key,
    name: entry.name,
    get status() {
      return status;
    },
    set status(next: string) {
      status = next;
    },
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.planId ? { planId: entry.planId } : {}),
    ...(entry.taskId ? { taskId: entry.taskId } : {}),
    feed,
    dialogs,
    get alive() {
      return status !== "exited";
    },
    get busy() {
      return status === "working";
    },
    send(text: string) {
      feed.say("you", text);
    },
    stop() {
      status = "exited";
      dialogs.length = 0;
      lobbyTopics.bump("sessions");
    },
    answer(id: string, _answer: DialogAnswer) {
      const index = dialogs.findIndex((dialog) => dialog.id === id);
      if (index >= 0) dialogs.splice(index, 1);
    },
    rename(name: string) {
      session.name = name;
      lobbyTopics.bump("sessions");
    },
  };
  return session as unknown as BackgroundSession;
}

function sliceReply(text: string): string[] {
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += 120) parts.push(text.slice(index, index + 120));
  return parts;
}

/** Stream the scripted reply, then record it; a scripted question follows a send when the fixture has one. */
function streamReply(service: object, feed: LobbyFeed, fixture: ScenarioFixture): void {
  stopStream(service);
  const parts = sliceReply(fixture.oracleReply);
  const state: StreamState = {};
  streams.set(service, state);
  const step = (): void => {
    const next = parts.shift();
    if (next === undefined) {
      feed.replyEnd();
      feed.say("oracle", fixture.oracleReply);
      return;
    }
    feed.replyDelta(next);
    state.step = setTimeout(step, 25);
    unref(state.step);
  };
  state.step = setTimeout(step, 25);
  unref(state.step);
  const followUp = fixture.questionAfterSend;
  if (followUp) {
    state.followUp = setTimeout(() => {
      track(service, promptHub.open(followUp.kind, followUp.from, followUp.payload).id);
    }, 150);
    unref(state.followUp);
  }
}

/** How long a scripted @ mention reply takes, so the page shows the agent at work first. */
const ANSWER_MS = 1500;

/** A `LobbyService` answering from the `name` scenario's fixtures. */
export function createFixtureService(name: string, feed = new LobbyFeed()): LobbyService {
  const fixture = loadScenario(name);
  seedFeed(feed, fixture);
  const history = fixture.history.map((entry, index) => ({ id: index + 1, at: Date.now() - (fixture.history.length - index) * 1000, role: entry.role, text: entry.text }));
  const whole = (task: Record<string, unknown>): Record<string, unknown> => ({ amendments: [], blockers: [], approvals: [], ...task });
  const tasks = (fixture.mockTasks ?? []).map(whole);
  const archived = (fixture.mockArchived ?? []).map(whole);
  const plans = (fixture.mockPlans ?? []).map((plan) => ({ ...plan, status: "pending" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  const auto = new Set(fixture.autoTasks ?? []);
  const comments = new Map<string, Array<Record<string, unknown>>>(Object.entries(fixture.taskComments ?? {}));
  const backgrounds = (fixture.backgroundSessions ?? []).map(fakeBackground);
  // The agent other than the oracle answering an @ mention, for as long as its scripted reply takes.
  let answering: string | undefined;
  const archivedBackgrounds: BackgroundSession[] = [];
  // Saved sessions of the project, as pi would list them: a couple from earlier days.
  const saved = [
    { sessionId: "saved-1", name: "Tidy the settings page", at: Date.now() - 26 * 3600_000 },
    { sessionId: "saved-2", name: "Why does the router double-render?", at: Date.now() - 3 * 86_400_000 },
  ];
  const savedArchived = new Set<string>();
  let sessionName = fixture.status.sessionName;
  let planning = fakePlanner(fixture.mockPlanner ?? defaultPlanner());
  let config: BotLobbyConfig = resolveConfig(fixture.settings?.config ?? {});
  const models = fixture.settings?.models ?? DEFAULT_MODELS;
  const metrics = (fixture.mockMetrics ?? []).map((record) => ({ ...record }));
  const classifierMetrics = (fixture.mockClassifierMetrics ?? []).map((record) => ({ ...record }));
  const knowledgeFiles = (fixture.mockKnowledge ?? []).map((file) => ({ ...file }));
  const knowledgeView = fixture.mockKnowledgeView ? { ...fixture.mockKnowledgeView, entries: [...fixture.mockKnowledgeView.entries], attached: [...fixture.mockKnowledgeView.attached], detached: [...fixture.mockKnowledgeView.detached] } : undefined;
  const knowledge = {
    files: () => knowledgeFiles.map((file) => ({ ...file })),
    open: (agent: string, file: string) => {
      if (knowledgeView && knowledgeView.agent === agent && knowledgeView.file === file) return { ...knowledgeView, entries: [...knowledgeView.entries], attached: [...knowledgeView.attached], detached: [...knowledgeView.detached] };
      return { agent, file, label: file, chars: 0, over: false, notes: 0, content: "", entries: [], attached: [], detached: [] };
    },
    edit: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
    add: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
    remove: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
    replaceFile: () => "saved mock/agent/mock.md — the version before is in archive/Mock",
    comment: () => "note saved — every agent reads it under this entry",
    unnote: () => "note removed",
    // A few days of history, an Inbox and recent runs, so the Knowledge page shows pins, usage and proposals offline.
    ledger: () => mockLedger(fixture.mockKnowledgeView),
    pin: (_agent: string, _file: string, _ref: unknown, on: boolean) => (on ? "pinned — it loads first for this agent" : "unpinned"),
    restore: () => "restored the earlier version",
    move: () => "moved — saved mock/agent/mock.md",
    accept: () => "accepted — saved",
    dismiss: () => "dismissed",
    threshold: () => 6000,
  };
  let commentSeq = 0;
  const service = {
    sessionId: () => fixture.status.sessionId,
    sessionName: () => sessionName,
    commands: () => [...piCommands(),
      { name: "skill:pdf-tools", description: "Extract text and tables from PDF files." },
      { name: "skill:release-notes", description: "Write release notes from merged pull requests." },
      { name: "skill:tailwind-review", description: "Check Tailwind classes against the design tokens." },
      { name: "mcp", description: "Manage MCP servers" },
      { name: "review", description: "Review changes" },
    ],
    masterBusy: () => fixture.status.busy || answering !== undefined,
    answering: () => answering,
    config: () => config,
    linters: () => fixture.settings?.linters ?? [{ tool: "ESLint", folder: "", installed: true }, { tool: "Ruff", folder: "services/api", installed: false }],
    saveConfig: (next: BotLobbyConfig) => {
      config = next;
    },
    configChanged: () => {},
    models: () => models.map((model) => ({ id: model.id, label: model.label, thinkingLevels: [...model.thinkingLevels] })),
    // A fixed machine for screenshots and browser tests: Codex and Claude Code installed, the rest not.
    harnesses: () => HARNESS_IDS.map((id) => {
      const info = HARNESSES[id];
      const installed: Partial<Record<string, string>> = { codex: "0.163.0", claude: "2.1.306" };
      const command = harnessCommand(id, config.harnesses[id]).command;
      return {
        id, label: info.label, blurb: info.blurb, protocol: info.protocol, command, providers: info.providers, effort: info.effort,
        ...(installed[id] ? { path: `/usr/local/bin/${command}`, version: installed[id] } : {}),
        models: harnessModels(id, config.harnesses[id]),
      };
    }),
    classifierModels: () => [{ id: "opencode/jev-1.13-free", label: "Jev 1.13 (free)" }, { id: "openrouter/liquid/d1", label: "Liquid D1" }],
    grants: () => ({
      mcpTools: [
        { name: "mcp__github__get_issue", server: "github", description: "Read one issue with its comments.", readOnly: true },
        { name: "mcp__github__create_pull_request", server: "github", description: "Open a pull request.", readOnly: false },
        { name: "mcp__github__search_code", server: "github", description: "Search code across repositories.", readOnly: true },
        { name: "mcp__figma__get_frame", server: "figma", description: "Read a frame's layers and styles.", readOnly: true },
        { name: "mcp__figma__export_image", server: "figma", description: "Export a frame as PNG or SVG.", readOnly: false },
      ],
      skills: [
        { name: "pdf-tools", description: "Extract text and tables from PDF files.", path: "~/.pi/agent/skills/pdf-tools/SKILL.md" },
        { name: "release-notes", description: "Write release notes from merged pull requests.", path: ".pi/skills/release-notes/SKILL.md" },
        { name: "tailwind-review", description: "Check Tailwind classes against the design tokens.", path: ".agents/skills/tailwind-review/SKILL.md" },
      ],
    }),
    workspace: () => ({ ...fixture.status.workspace }),
    zen: () => ({ ...(fixture.zen.task ? { task: { ...fixture.zen.task } } : {}), runs: [...fixture.zen.runs] }),
    feed,
    toOracle: (text: string) => {
      const command = parseLobbyCommand(text);
      if (command?.command === "plan") return { notice: "planning on the Plan tab", open: "plan" as const };
      if (command) return "starting a task — the oracle takes it from here";
      const mention = parseMention(text);
      if (mention && mention.agent !== "master") {
        const source = CHAT_AGENT_SOURCES[mention.agent];
        answering = source;
        feed.say("you", mention.rest, Date.now(), { to: source });
        lobbyTopics.bump("lobby");
        lobbyTopics.bump("status");
        const reply = setTimeout(() => {
          answering = undefined;
          feed.say("oracle", `${source} here: looked into it, and it is done.`, Date.now(), { agent: source });
          lobbyTopics.bump("lobby");
          lobbyTopics.bump("status");
        }, ANSWER_MS);
        unref(reply);
        return undefined;
      }
      feed.say("you", mention?.rest || text);
      streamReply(service, feed, fixture);
      return undefined;
    },
    askKnowledge: (text: string) => {
      feed.say("you", text);
      streamReply(service, feed, fixture);
    },
    abortMaster: () => {
      stopStream(service);
      feed.replyEnd();
    },
    chatHistory: () => [...history],
    tasks: () => [...tasks],
    work: (taskId: string) => {
      const work = fixture.mockWork?.[taskId];
      if (!work) return undefined;
      const now = Date.now();
      return { workedMs: work.workedMs, running: work.running, active: (work.active ?? []).map((run) => ({ runId: run.runId, parentRunId: run.parentRunId, stepInstruction: run.stepInstruction, instruction: run.instruction, startedAt: new Date(now - run.startedAgoMs).toISOString() })) };
    },
    plans: () => [...plans],
    metrics: () => metrics.map((record) => ({ ...record })),
    classifierMetrics: () => classifierMetrics.map((record) => ({ ...record })),
    knowledge,
    comments: (taskId: string) => [...(comments.get(taskId) ?? [])],
    comment: (taskId: string, text: string) => {
      const entry = { id: `C-mock-${(commentSeq += 1)}`, taskId, text, by: fixture.status.sessionId, createdAt: new Date().toISOString(), status: "open" };
      comments.set(taskId, [...(comments.get(taskId) ?? []), entry]);
      return "comment sent to the oracle — it will amend the plan";
    },
    editComment: (taskId: string, commentId: string, text: string) => {
      const existing = (comments.get(taskId) ?? []).find((entry) => entry.id === commentId);
      if (!existing) throw new Error(`no comment ${commentId}`);
      if (!existing.by || existing.by !== fixture.status.sessionId) throw new Error("only your own comments can be edited");
      const entry: Record<string, unknown> = { ...existing, text: text.trim(), editedAt: new Date().toISOString(), status: "open" };
      delete entry.deliveredAt;
      delete entry.addressedAt;
      comments.set(taskId, [...(comments.get(taskId) ?? []).map((other) => (other.id === commentId ? entry : other))]);
      return entry as unknown as PlanComment;
    },
    startPlanned: (plan: { id: string }) => `starting ${plan.id} here — its agreed plan needs no approval…`,
    discardPlan: (id: string) => {
      const index = plans.findIndex((plan) => plan.id === id);
      if (index >= 0) plans.splice(index, 1);
    },
    archivedTasks: () => [...archived],
    archiveTask: (taskId: string) => {
      const index = tasks.findIndex((task) => (task as { id: string }).id === taskId);
      if (index < 0) return `no task ${taskId}`;
      archived.unshift(tasks.splice(index, 1)[0]!);
      lobbyTopics.bump("tasks");
      return `archived ${taskId} — v shows archived tasks, a restores one`;
    },
    restoreTask: (taskId: string) => {
      const index = archived.findIndex((task) => (task as { id: string }).id === taskId);
      if (index < 0) return `no archived task ${taskId}`;
      tasks.unshift(archived.splice(index, 1)[0]!);
      lobbyTopics.bump("tasks");
      return `restored ${taskId} to the task list`;
    },
    deleteTask: (taskId: string, where: "list" | "archive") => {
      const list = where === "list" ? tasks : archived;
      const index = list.findIndex((task) => (task as { id: string }).id === taskId);
      if (index < 0) return `no task ${taskId}`;
      list.splice(index, 1);
      lobbyTopics.bump("tasks");
      return `deleted ${taskId} for good`;
    },
    isAuto: (taskId: string) => auto.has(taskId),
    setAuto: (taskId: string, on: boolean) => {
      if (on) auto.add(taskId);
      else auto.delete(taskId);
    },
    sendToTask: (taskId: string, _text: string) => (tasks.some((task) => (task as { id: string }).id === taskId) ? `sent — the session driving ${taskId} passes it to its oracle` : `no task ${taskId}`),
    sendToSession: (_sessionId: string, _text: string) => "sent — that session passes it to its oracle within a few seconds",
    skipTaskStep: async (taskId: string, step: number, text: string, reason: string) => {
      const task = tasks.find((entry) => (entry as { id: string }).id === taskId) as { id: string; skippedSteps?: Array<{ text: string; reason: string; at: string }>; decisions?: Array<{ domain: string; text: string; createdAt: string }> } | undefined;
      if (!task) throw new Error(`no task ${taskId}`);
      const at = new Date().toISOString();
      task.skippedSteps = [...(task.skippedSteps ?? []), { text, reason: reason.trim(), at }];
      task.decisions = [...(task.decisions ?? []), { domain: "master", text: `The user skipped step ${step + 1} ("${text}") from the Tasks screen. Reason: ${reason.trim()}`, createdAt: at }];
      lobbyTopics.bump("tasks");
      return { notice: `step ${step + 1} skipped; the oracle has been told` };
    },
    resumeTask: async (taskId: string) => {
      const task = tasks.find((entry) => (entry as { id: string }).id === taskId) as { id: string; title: string; paused?: boolean; ownerSessionId?: string } | undefined;
      if (!task) return { notice: `no task ${taskId}` };
      const owner = task.ownerSessionId;
      const background = backgrounds.find((session) => session.alive && ((owner && session.sessionId === owner) || session.taskId === taskId));
      const elsewhere = Boolean(owner && (fixture.liveSessions ?? []).some((session) => session.sessionId === owner));
      lobbyTopics.bump("tasks");
      if (owner === fixture.status.sessionId || background || elsewhere) {
        task.paused = false;
        const where = background ? `in ${background.name}` : elsewhere ? "— the session driving it in another terminal carries on" : "in this window";
        return { notice: `resumed ${taskId} ${where}`, ...(background ? { key: background.key } : {}) };
      }
      task.paused = false;
      const session = fakeBackground({ key: `S${backgrounds.length + 1}`, name: task.title, status: "starting", taskId });
      backgrounds.push(session);
      lobbyTopics.bump("sessions");
      return { notice: `resumed ${taskId} in a background session`, key: session.key };
    },
    sessions: () => [...backgrounds],
    renameSession: (key: string | undefined, name: string) => {
      const clean = cleanSessionName(name);
      if (!key) {
        sessionName = clean;
        lobbyTopics.bump("status");
        lobbyTopics.bump("sessions");
        return `renamed this window to ${clean}`;
      }
      const session = backgrounds.find((entry) => entry.key === key);
      if (!session) throw new Error(`no session ${key}`);
      session.rename(clean);
      return `renamed ${key} to ${clean}`;
    },
    archiveSession: (key: string, archived: boolean) => {
      const from = archived ? backgrounds : archivedBackgrounds;
      const index = from.findIndex((entry) => entry.key === key);
      if (index < 0) throw new Error(archived ? `no session ${key} to archive` : `no archived session ${key}`);
      const session = from[index]!;
      if (session.alive) throw new Error(`${session.name} is still running: stop it before archiving it`);
      from.splice(index, 1);
      (archived ? archivedBackgrounds : backgrounds).push(session);
      lobbyTopics.bump("sessions");
      return archived ? `archived ${session.name}` : `brought back ${session.name}`;
    },
    startSession: (start: { request?: string; plan?: { id: string; title: string }; auto?: boolean }) => {
      const key = `S${backgrounds.length + 1}`;
      const session = fakeBackground({ key, name: start.plan?.title ?? start.request?.trim().slice(0, 40) ?? "mock session", status: "starting", ...(start.plan ? { planId: start.plan.id } : {}) });
      backgrounds.push(session);
      return session;
    },
    liveSessions: () => [...(fixture.liveSessions ?? [])],
    savedSessions: () => saved.map((session) => ({ ...session, ...(savedArchived.has(session.sessionId) ? { archived: true } : {}) })),
    archiveSaved: (sessionId: string, archived: boolean) => {
      const session = saved.find((entry) => entry.sessionId === sessionId);
      if (!session) throw new Error(`no saved session ${sessionId}`);
      if (archived) savedArchived.add(sessionId);
      else savedArchived.delete(sessionId);
      lobbyTopics.bump("sessions");
      return archived ? `archived ${session.name}` : `brought back ${session.name}`;
    },
    deleteSaved: (sessionId: string) => {
      const index = saved.findIndex((entry) => entry.sessionId === sessionId);
      if (index < 0) throw new Error(`no saved session ${sessionId}`);
      const [session] = saved.splice(index, 1);
      lobbyTopics.bump("sessions");
      return `deleted ${session!.name}`;
    },
    planner: () => planning,
    ...previousPlansFake(fixture.mockPreviousPlans ?? []),
    newPlanner: (seed?: { issue: { number: number; title: string; url?: string }; body: string }, seats?: string[]) => {
      planning = fakePlanner({ ...defaultPlanner(), ...(seed ? { messages: [{ role: "you", text: seed.body, at: Date.now() }] } : {}), ...(seats ? { seats } : {}) });
      return planning;
    },
    answerPanel: async () => {
      planning.questions = [];
      planning.awaitingAnswers = false;
      return "answers sent — the panel is on the next round";
    },
    savePlan: async () => {
      const plan = (planning.reply as { plan?: string } | undefined)?.plan;
      if (!plan) throw new Error("there is no draft plan to save yet");
      return "saved PLAN-mock-1 to the pending tasks — start it from the Tasks tab";
    },
    defaultPanel: () => ["backend", "designer", "qa", "researcher"],
    planningRounds: () => 5,
    sessionChat: () => [],
    hasOlderChat: () => false,
    switchTo: async (target: { name: string }) => (fixture.status.busy ? `${sessionName ?? "this window's session"} carries on in the background; switching this window to ${target.name}…` : `switching this window to ${target.name}…`),
  } as unknown as LobbyService;
  seedPrompts(service, fixture);
  return service;
}

/** Dismiss what `createFixtureService` opened and stop its stream. */
export function disposeFixtureService(service: LobbyService): void {
  stopStream(service);
  for (const id of opened.get(service) ?? []) promptHub.dismiss(id);
  opened.delete(service);
}

/** Previous plans held in memory: listed, read, archived, deleted and carried on as the page asks. */
function previousPlansFake(seed: NonNullable<ScenarioFixture["mockPreviousPlans"]>) {
  const records = seed.map((plan) => ({ ...plan }))
  const find = (id: string) => {
    const record = records.find((entry) => entry.id === id && !entry.savedAs?.length)
    if (!record) throw new Error(`no plan ${id}`)
    return record
  }
  const asRecord = (plan: (typeof records)[number]) => ({
    id: plan.id,
    title: plan.title,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    ...(plan.archivedAt ? { archivedAt: plan.archivedAt } : {}),
    snapshot: { version: 1, messages: plan.messages, ...(plan.draft ? { reply: { status: "grilling", questions: [], plan: plan.draft } } : {}), questions: [], notes: plan.notes ?? [], members: [], seats: ["backend", "designer", "qa", "researcher"], pins: [], satOut: [], lastStatus: [], sat: [], memberNotes: [], turns: plan.rounds ?? 1, mode: "normal", answered: [], lineComments: [], savedParts: [], autoContinued: false, attempts: 1, running: false },
  }) as unknown as PlanRecord
  return {
    previousPlans: (archived: boolean): PlanSummary[] => records
      .filter((plan) => !plan.savedAs?.length && Boolean(plan.archivedAt) === archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((plan) => ({ id: plan.id, title: plan.title, createdAt: plan.createdAt, updatedAt: plan.updatedAt, ...(plan.archivedAt ? { archivedAt: plan.archivedAt } : {}), messages: plan.messages.length, rounds: plan.rounds ?? 1, hasDraft: Boolean(plan.draft) })),
    previousPlan: (id: string) => asRecord(find(id)),
    archivePlan: (id: string, archived: boolean) => {
      const plan = find(id)
      if (archived) plan.archivedAt = new Date().toISOString()
      else delete plan.archivedAt
      lobbyTopics.bump("planner")
      return archived ? `archived "${plan.title}" — show archived plans to bring it back` : `"${plan.title}" is back among the previous plans`
    },
    deletePlan: (id: string) => {
      const plan = find(id)
      records.splice(records.indexOf(plan), 1)
      lobbyTopics.bump("planner")
      return `deleted "${plan.title}" for good`
    },
    reopenPlan: (id: string) => `carrying on "${find(id).title}"`,
  }
}

/** The mock Knowledge ledger: the first note pinned with a history, one note edited, an Inbox of two, and a month of runs. */
function mockLedger(view: { agent: string; file: string; entries: Array<Record<string, unknown>> } | undefined) {
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const iso = (ago: number) => new Date(now - ago).toISOString();
  const bullets = (view?.entries ?? []).filter((entry) => entry.kind === "bullet") as Array<{ text: string }>;
  const agent = (view?.agent ?? "master") as "master";
  const file = view?.file ?? "knowledge.md";
  const first = bullets[0]?.text ?? "- Mock what the offline page needs.";
  const second = bullets[1]?.text ?? first;
  const third = bullets[3]?.text ?? first;
  return {
    pins: [{ agent, file, entry: first, at: iso(3 * day) }],
    events: [
      { id: "ev1", agent, file, entry: first, by: "Oracle", what: "wrote this while planning the offline mock", source: "Planning · offline mock", at: iso(9 * day) },
      { id: "ev2", agent, file, entry: first, by: "you", what: "edited it", before: "- Mock everything the page needs.", at: iso(3 * day) },
      { id: "ev3", agent, file, entry: second, by: "Oracle", what: "saved this from a chat with you", source: "Chat with you", at: iso(14 * day) },
      { id: "ev4", agent, file, entry: third, by: "Backend", what: "wrote this while working on task T-mock-1", source: "Task T-mock-1", at: iso(2 * day) },
    ],
    proposals: [
      { id: "pr1", agent: "backend", kind: "knowledge", text: "Upload retries use exponential backoff, capped at 30 seconds.", source: "Task T-mock-6", confidence: 94, taskId: "T-mock-6", at: iso(2 * 3600 * 1000) },
      { id: "pr2", agent: "qa", kind: "knowledge", text: "The Playwright run goes last; it takes about 40 seconds.", source: "Task T-mock-1", confidence: 88, at: iso(5 * 3600 * 1000) },
      { id: "pr3", agent, kind: "knowledge", text: "Mock what the offline page needs, and nothing it does not.", source: "Task T-mock-1", confidence: 71, replaces: first.replace(/^- /, ""), at: iso(6 * 3600 * 1000) },
    ],
    runs: {
      master: { recent: Array.from({ length: 18 }, (_, index) => ({ at: iso(index * 1.6 * day + 3600 * 1000), ...(index % 3 === 0 ? { taskId: "T-mock-1" } : index % 3 === 1 ? { taskId: "T-mock-5" } : {}) })), lastAt: iso(3600 * 1000) },
      backend: { recent: Array.from({ length: 6 }, (_, index) => ({ at: iso(index * 4 * day + 7200 * 1000), taskId: "T-mock-6" })), lastAt: iso(7200 * 1000) },
      designer: { recent: [], lastAt: iso(74 * day) },
    },
  };
}
