/**
 * A fixture-backed `LobbyService` for `npm run web:dev`: the real server
 * answers the protocol calls from one scenario's fixtures, so the page
 * builds with no Pi. Dev-only; never imported by production code or tests
 * (tests use `test/webui-fake.ts`).
 */
import { LobbyFeed } from "../../lobby/feed.ts";
import { promptHub } from "../../lobby/prompt-hub.ts";
import type { LobbyService } from "../../lobby/service.ts";
import { loadScenario, type ScenarioFixture } from "./fixtures.ts";

interface StreamState {
  step?: ReturnType<typeof setTimeout>;
  followUp?: ReturnType<typeof setTimeout>;
}

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
  for (const entry of fixture.feed.thoughts) feed.thought(entry.source, entry.text);
  if (fixture.feed.reply) feed.replyDelta(fixture.feed.reply);
}

function seedPrompts(service: object, fixture: ScenarioFixture): void {
  for (const prompt of fixture.prompts) track(service, promptHub.open(prompt.kind, prompt.from, prompt.payload).id);
  for (const settled of fixture.settled) promptHub.answer(promptHub.open(settled.kind, settled.from, settled.payload).id, settled.answer);
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
  const service = {
    sessionId: () => fixture.status.sessionId,
    sessionName: () => fixture.status.sessionName,
    masterBusy: () => fixture.status.busy,
    issuesEnabled: () => fixture.status.issuesEnabled,
    terminalDialog: () => fixture.status.terminalDialog,
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
