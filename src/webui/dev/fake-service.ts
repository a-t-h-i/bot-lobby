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
import type { BackgroundSession, DialogAnswer, SessionDialog } from "../../lobby/sessions.ts";
import type { PlanComment } from "../../state/comments.ts";
import type { LobbyService } from "../../lobby/host.ts";
import { loadScenario, type ScenarioFixture } from "./fixtures.ts";

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

interface FakeQuickFixJob {
  id: string;
  prompt: string;
  status: string;
  createdAt: number;
  steps: Array<{ at: number; text: string; pending: boolean }>;
  tools: number;
  turns: number;
  note?: string;
  report?: string;
}

function fakeQuickFixJobs(entries: Array<Record<string, unknown>>): FakeQuickFixJob[] {
  return entries.map((job, index) => ({
    id: typeof job.id === "string" ? job.id : `QF-${index + 1}`,
    prompt: typeof job.prompt === "string" ? job.prompt : "",
    status: typeof job.status === "string" ? job.status : "success",
    createdAt: typeof job.createdAt === "number" ? job.createdAt : Date.now(),
    steps: [],
    tools: 0,
    turns: 0,
    ...(typeof job.note === "string" ? { note: job.note } : {}),
    ...(typeof job.report === "string" ? { report: job.report } : {}),
  }));
}

const DETAIL_ONLY = ["body", "state", "mergeable", "files", "notes", "comments"] as const;

/** A list row: the detail fixture without the fields only a detail carries. */
function summaryOf(entry: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = { ...entry };
  for (const key of DETAIL_ONLY) delete row[key];
  return row;
}

/** The Git tab's `PullsState` as canned fixture data (`gh` is never run). */
function fakePulls(entries: Array<Record<string, unknown>>) {
  const details = new Map<number, Record<string, unknown>>();
  const state = {
    pulls: [] as Array<Record<string, unknown>>,
    details,
    loading: false,
    loaded: false,
    error: undefined as string | undefined,
    async refresh() {
      state.pulls = entries.map(summaryOf);
      state.loaded = true;
      lobbyTopics.bump("git");
    },
    async detail(number: number) {
      const found = entries.find((entry) => entry.number === number);
      if (!found) {
        state.error = "GraphQL: Could not resolve to a PullRequest with the number of " + number + ".";
        return undefined;
      }
      state.error = undefined;
      details.set(number, found);
      return { ...found };
    },
    forget() {
      details.clear();
    },
  };
  return state;
}

/** Reviews and Jev's reads as canned data; a started review finishes after a moment. */
function fakeReviews(saved: Array<Record<string, unknown>>, savedReads: Array<Record<string, unknown>>) {
  const reviews = new Map<number, Record<string, unknown>>(saved.map((review) => [review.number as number, { ...review }]));
  const reads = new Map<number, Record<string, unknown>>(savedReads.map((read) => [read.number as number, { ...read }]));
  const finish = (after: () => void): void => {
    const timer = setTimeout(() => {
      after();
      lobbyTopics.bump("git");
    }, 400);
    timer.unref?.();
  };
  return {
    reviews,
    reads,
    review: (number: number) => reviews.get(number),
    running: (number: number) => reviews.get(number)?.status === "running",
    async start(number: number, options: { focus?: string } = {}) {
      const review: Record<string, unknown> = { number, status: "running", startedAt: Date.now(), steps: ["reading the pull request from GitHub"], ...(options.focus ? { focus: options.focus } : {}) };
      reviews.set(number, review);
      lobbyTopics.bump("git");
      finish(() => Object.assign(review, { status: "done", verdict: "comment", finishedAt: Date.now(), model: "mock/qa", thinking: "medium", text: "## Verdict\nCOMMENT\n\n## Summary\nA canned review from the mock.\n\n## Findings\nNone." }));
      return review;
    },
    cancel(number: number): boolean {
      const review = reviews.get(number);
      if (review?.status !== "running") return false;
      review.status = "cancelled";
      review.finishedAt = Date.now();
      lobbyTopics.bump("git");
      return true;
    },
    async readWithJev(number: number) {
      const read: Record<string, unknown> = { number, status: "running" };
      reads.set(number, read);
      lobbyTopics.bump("git");
      finish(() => Object.assign(read, { status: "done", line: "small · low risk", read: { size: "small", sizeConfidence: 0.9, risky: 0.1, breaking: 0.05, security: 0.02, testsMissing: 0.2, model: "mock/jev", ms: 200 } }));
      return read;
    },
  };
}

/** The Issues tab's `IssuesState` as canned fixture data. */
function fakeIssues(entries: Array<Record<string, unknown>>) {
  const details = new Map<number, Record<string, unknown>>();
  const state = {
    issues: [] as Array<Record<string, unknown>>,
    details,
    loading: false,
    loaded: false,
    error: undefined as string | undefined,
    notice: undefined as string | undefined,
    async refresh() {
      state.issues = entries.map(summaryOf);
      state.loaded = true;
      lobbyTopics.bump("issues");
    },
    async detail(number: number) {
      const found = entries.find((entry) => entry.number === number);
      if (!found) {
        state.error = "GraphQL: Could not resolve to an Issue with the number of " + number + ".";
        return undefined;
      }
      return { ...found };
    },
    async create(text: string) {
      const title = text.trim().split("\n")[0]!.replace(/^#+\s*/, "");
      const number = Math.max(0, ...entries.map((entry) => entry.number as number)) + 1;
      entries.unshift({ number, title, labels: [], body: text.trim().split("\n").slice(1).join("\n").trim(), state: "OPEN", comments: [] });
      state.notice = `created #${number} — https://github.com/example/bot-lobby/issues/${number}`;
      await state.refresh();
    },
  };
  return state;
}

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
    },
    answer(id: string, _answer: DialogAnswer) {
      const index = dialogs.findIndex((dialog) => dialog.id === id);
      if (index >= 0) dialogs.splice(index, 1);
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
  let planning = fakePlanner(fixture.mockPlanner ?? defaultPlanner());
  let config: BotLobbyConfig = resolveConfig(fixture.settings?.config ?? {});
  const models = fixture.settings?.models ?? DEFAULT_MODELS;
  const metrics = (fixture.mockMetrics ?? []).map((record) => ({ ...record }));
  const classifierMetrics = (fixture.mockClassifierMetrics ?? []).map((record) => ({ ...record }));
  const knowledgeFiles = (fixture.mockKnowledge ?? []).map((file) => ({ ...file }));
  const knowledgeView = fixture.mockKnowledgeView ? { ...fixture.mockKnowledgeView, entries: [...fixture.mockKnowledgeView.entries], attached: [...fixture.mockKnowledgeView.attached], detached: [...fixture.mockKnowledgeView.detached] } : undefined;
  const xSessions = (fixture.mockExcalidraw ?? []).map((session) => ({ ...session, agents: [...session.agents] }));
  const xLinks = new Map<string, string>();
  if (xSessions[0] && fixture.mockExcalidrawLink) xLinks.set(xSessions[0].id, fixture.mockExcalidrawLink);
  const xLinkOf = (id: string): string => xLinks.get(id) ?? `https://whiteboard.example/#room=${id},AAAAAAAAAAAAAAAAAAAAAA`;
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
  };
  const excalidraw = {
    list: () => xSessions.map((session) => ({ id: session.id, name: session.name, link: xLinkOf(session.id), agents: [...session.agents], contribute: session.contribute, addedAt: session.addedAt })),
    add: (link: string, name?: string) => {
      if (!link.includes("#room=")) return { notice: "that is not an Excalidraw room link — it looks like https://excalidraw.com/#room=<id>,<key>" };
      const session = { id: `x${xSessions.length + 1}`, name: name || `Session ${xSessions.length + 1}`, link, agents: [] as string[], contribute: true, addedAt: new Date().toISOString() };
      xSessions.push({ id: session.id, name: session.name, masked: "", agents: [], contribute: true, addedAt: session.addedAt });
      xLinks.set(session.id, link);
      return { notice: `added “${session.name}” — assign it to agents with enter`, session };
    },
    create: (name?: string) => {
      const id = `x${xSessions.length + 1}`;
      const link = `https://whiteboard.example/#room=mock${xSessions.length + 1},AAAAAAAAAAAAAAAAAAAAAA`;
      const session = { id, name: name || `Session ${xSessions.length + 1}`, link, agents: [] as string[], contribute: true, addedAt: new Date().toISOString() };
      xSessions.push({ id, name: session.name, masked: "", agents: [], contribute: true, addedAt: session.addedAt });
      xLinks.set(id, link);
      return { notice: `added “${session.name}” — assign it to agents with enter`, session };
    },
    remove: (id: string) => {
      const index = xSessions.findIndex((session) => session.id === id);
      if (index < 0) return "no such session";
      const [gone] = xSessions.splice(index, 1);
      return `removed “${gone!.name}”`;
    },
    rename: (id: string, name: string) => {
      const session = xSessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      if (!name.trim()) return "a session needs a name";
      session.name = name.trim().slice(0, 40);
      return `renamed to “${session.name}”`;
    },
    toggleAgent: (id: string, agent: string) => {
      const session = xSessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      const at = session.agents.indexOf(agent);
      if (at >= 0) session.agents.splice(at, 1);
      else session.agents.push(agent);
      return at >= 0 ? `${agent} no longer has this session` : `${agent} has this session now`;
    },
    toggleAll: (id: string) => {
      const session = xSessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      session.agents = session.agents.length > 0 ? [] : ["master"];
      return session.agents.length > 0 ? "assigned to every agent" : "taken back from every agent";
    },
    toggleContribute: (id: string) => {
      const session = xSessions.find((entry) => entry.id === id);
      if (!session) return "no such session";
      session.contribute = !session.contribute;
      return session.contribute ? "agents may draw in this session" : "agents may only look at this session";
    },
  };
  const qfJobs = fakeQuickFixJobs(fixture.mockQuickfix ?? []);
  let qfCounter = qfJobs.length;
  const quickfix = {
    jobs: qfJobs,
    get running() {
      return qfJobs.find((job) => job.status === "running");
    },
    submit(prompt: string) {
      const job: FakeQuickFixJob = { id: `QF-${(qfCounter += 1)}`, prompt: prompt.trim(), status: "queued", createdAt: Date.now(), steps: [], tools: 0, turns: 0 };
      qfJobs.push(job);
      return job;
    },
    cancel(id: string): boolean {
      const job = qfJobs.find((entry) => entry.id === id);
      if (!job || (job.status !== "queued" && job.status !== "running")) return false;
      job.status = "cancelled";
      return true;
    },
    runAnyway(id: string): boolean {
      const job = qfJobs.find((entry) => entry.id === id);
      if (!job || job.status !== "held") return false;
      job.status = "queued";
      delete job.note;
      return true;
    },
    movedToTask(id: string): boolean {
      const job = qfJobs.find((entry) => entry.id === id);
      if (!job || job.status !== "held") return false;
      job.status = "cancelled";
      job.note = "started as a task in a new session";
      return true;
    },
  };
  let commentSeq = 0;
  const service = {
    sessionId: () => fixture.status.sessionId,
    sessionName: () => fixture.status.sessionName,
    masterBusy: () => fixture.status.busy,
    config: () => config,
    linters: () => fixture.settings?.linters ?? [{ tool: "ESLint", folder: "", installed: true }, { tool: "Ruff", folder: "services/api", installed: false }],
    saveConfig: (next: BotLobbyConfig) => {
      config = next;
    },
    configChanged: () => {},
    models: () => models.map((model) => ({ id: model.id, label: model.label, thinkingLevels: [...model.thinkingLevels] })),
    issuesEnabled: () => fixture.status.issuesEnabled,
    workspace: () => ({ ...fixture.status.workspace }),
    zen: () => ({ ...(fixture.zen.task ? { task: { ...fixture.zen.task } } : {}), runs: [...fixture.zen.runs] }),
    feed,
    toOracle: (text: string) => {
      feed.say("you", text);
      streamReply(service, feed, fixture);
      return undefined;
    },
    abortMaster: () => {
      stopStream(service);
      feed.replyEnd();
    },
    chatHistory: () => [...history],
    tasks: () => [...tasks],
    plans: () => [...plans],
    metrics: () => metrics.map((record) => ({ ...record })),
    classifierMetrics: () => classifierMetrics.map((record) => ({ ...record })),
    knowledge,
    excalidraw,
    checkExcalidraw: async () => ({ ok: true, text: "reached the server; nobody has this session open yet — open the link in Excalidraw, and agents can read and draw" }),
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
      return `archived ${taskId} — v shows archived tasks, a restores one`;
    },
    restoreTask: (taskId: string) => {
      const index = archived.findIndex((task) => (task as { id: string }).id === taskId);
      if (index < 0) return `no archived task ${taskId}`;
      tasks.unshift(archived.splice(index, 1)[0]!);
      return `restored ${taskId} to the task list`;
    },
    deleteTask: (taskId: string, where: "list" | "archive") => {
      const list = where === "list" ? tasks : archived;
      const index = list.findIndex((task) => (task as { id: string }).id === taskId);
      if (index < 0) return `no task ${taskId}`;
      list.splice(index, 1);
      return `deleted ${taskId} for good`;
    },
    isAuto: (taskId: string) => auto.has(taskId),
    setAuto: (taskId: string, on: boolean) => {
      if (on) auto.add(taskId);
      else auto.delete(taskId);
    },
    sendToTask: (taskId: string, _text: string) => (tasks.some((task) => (task as { id: string }).id === taskId) ? `sent — the session driving ${taskId} passes it to its oracle` : `no task ${taskId}`),
    sendToSession: (_sessionId: string, _text: string) => "sent — that session passes it to its oracle within a few seconds",
    sessions: () => [...backgrounds],
    startSession: (start: { request?: string; plan?: { id: string; title: string }; auto?: boolean }) => {
      const key = `S${backgrounds.length + 1}`;
      const session = fakeBackground({ key, name: start.plan?.title ?? start.request?.trim().slice(0, 40) ?? "mock session", status: "starting", ...(start.plan ? { planId: start.plan.id } : {}) });
      backgrounds.push(session);
      return session;
    },
    liveSessions: () => [...(fixture.liveSessions ?? [])],
    planner: () => planning,
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
    quickfix,
    pulls: fakePulls(fixture.mockPulls ?? []),
    reviews: fakeReviews(fixture.mockReviews ?? [], fixture.mockReads ?? []),
    issues: fakeIssues((fixture.mockIssues ?? []).map((issue) => ({ ...issue }))),
    sessionChat: () => [],
    hasOlderChat: () => false,
    switchTo: async (target: { name: string }) => `switching this window to ${target.name}…`,
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
