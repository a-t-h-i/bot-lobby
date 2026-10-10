import type { AgentRequest, LivePatch } from "./agent-runner.ts";
import type { AgentRun } from "../schemas/findings.ts";
import type { PiStreamEvent } from "./pi-runner.ts";
import { EditLog } from "../state/changes.ts";
import { activityDetail, activityWord, describeToolCall } from "../pi/activity.ts";
import { shortDuration, truncate } from "../text.ts";

const THROTTLE_MS = 2000;

/**
 * Tracks one attempt's live state from its stream and reports it through
 * `onUpdate`: activity changes, retries and notes immediately, counters and
 * heartbeats at most every couple of seconds.
 */
export function createLiveRun(base: AgentRun, request: Pick<AgentRequest, "onUpdate" | "timeoutMs" | "time">, edits: EditLog) {
  let state: AgentRun = base;
  let lastEmit = 0;
  const emit = (patch: Partial<AgentRun>, force: boolean) => {
    state = { ...state, ...patch, lastEventAt: Date.now() };
    const now = Date.now();
    if (!force && now - lastEmit < THROTTLE_MS) return;
    lastEmit = now;
    request.onUpdate?.(state);
  };
  const changed = (activity: string, detail: string | undefined) => activity !== state.activity || detail !== state.detail;
  const onEvent = (event: PiStreamEvent) => {
    switch (event.type) {
      case "tool_execution_start": {
        edits.note(event.toolName, event.args);
        const activity = activityWord(event.toolName);
        const detail = activityDetail(event.toolName, event.args);
        const step = describeToolCall(event.toolName, event.args);
        emit({ activity, detail, step, tools: (state.tools ?? 0) + 1 }, changed(activity, detail) || step !== state.step);
        return;
      }
      case "thought":
        emit({ thought: event.text }, true);
        return;
      case "thinking":
      case "writing":
        emit({ activity: event.type, detail: undefined }, changed(event.type, undefined));
        return;
      case "turn_start":
        emit({ turns: (state.turns ?? 0) + 1 }, false);
        return;
      case "retry":
        emit({ note: `provider retry ${event.attempt}/${event.maxAttempts}: ${truncateLine(event.error)}`, noteKind: "warning" }, true);
        return;
      case "retry_end":
        emit({ note: undefined, noteKind: undefined }, true);
        return;
      case "compaction":
        emit({ note: "compacting context", noteKind: "info" }, true);
        return;
      case "compaction_end":
        emit({ note: event.error, noteKind: event.error ? "warning" : undefined }, true);
        return;
      case "wrap_up":
        emit({ note: `asked to wrap up (${shortDuration(request.timeoutMs)} limit)`, noteKind: "warning", wrappedUp: true }, true);
        return;
      case "time_up":
        emit({ note: request.time?.onTimeUp ? "out of time: reporting where it left off" : "out of time: reporting", noteKind: "warning" }, true);
        return;
      case "extended":
        emit({ endsAt: request.time?.endsAt, extendedMs: (state.extendedMs ?? 0) + event.ms }, true);
        return;
      case "asking":
        emit({ note: `waiting on you: ${event.questions} question${event.questions === 1 ? "" : "s"}`, noteKind: "info" }, true);
        return;
      case "answered":
        // Its time waited with it.
        if (request.time) request.time.endsAt += event.waitedMs;
        emit({ note: "you answered; carrying on", noteKind: "info", ...(request.time ? { endsAt: request.time.endsAt } : {}) }, true);
        return;
      case "usage": {
        const usage = state.usage ?? { input: 0, output: 0, cost: 0, turns: 0 };
        const next = { input: usage.input + event.input, output: usage.output + event.output, cost: usage.cost + event.cost, turns: usage.turns + 1 };
        emit({ usage: next, model: event.model ?? state.model }, false);
        return;
      }
      default:
        emit({}, false);
    }
  };
  return {
    onEvent,
    annotate: (patch: LivePatch) => emit(patch, true),
    current: () => state,
  };
}

function truncateLine(text: string): string {
  const first = text.split("\n")[0] ?? "";
  return truncate(first, 48).split("\n")[0]!;
}
