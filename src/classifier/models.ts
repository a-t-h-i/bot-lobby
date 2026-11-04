/**
 * The classifier's model when it is not Jev on a host: whatever
 * `classifier.engine` names, answered as JSON by a one-shot call through an
 * installed harness (see `chat.ts`). pi's native classifier models went with
 * pi; Jev hosts are reached over HTTP with their own keys (`hosts.ts`).
 */
import type { Complete } from "../host/api.ts";
import type { SystemOneRequest, SystemOneResponse } from "./client.ts";
import { chatClassify } from "./chat.ts";

/** One model the classifier can use, as the settings picker lists it. */
export interface EngineModel {
  id: string;
  label: string;
  kind: "classifier" | "chat";
}

export interface AnswerOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  /** A chat model gets at least this long: it writes its answers, a classifier model only scores them. */
  chatTimeoutMs: number;
}

/** Answers a request with the model `ref` names; throws when no harness can run it or the call fails. */
export type EngineAnswer = (ref: string, request: SystemOneRequest, options: AnswerOptions) => Promise<SystemOneResponse>;

/** `provider/id` split at the first slash (ids may hold more: `openrouter/liquid/d1`). */
export function splitRef(ref: string): { provider: string; id: string } | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/** Answers through a harness one-shot call: the chat path, JSON in a prompt. */
export function engineAnswer(complete: Complete | undefined): EngineAnswer {
  return async (ref, request, options) => {
    if (!complete) throw new Error(`no coding agent is installed to answer with ${ref}`);
    const timeoutMs = Math.max(options.timeoutMs, options.chatTimeoutMs);
    return chatClassify(request, async ({ system, user, maxTokens }) => {
      const reply = await complete({ system, prompt: user, model: ref, maxTokens, timeoutMs, ...(options.signal ? { signal: options.signal } : {}) });
      return { text: reply.text, model: reply.model, ...(reply.usage ? { usage: reply.usage } : {}) };
    }, false);
  };
}

/** Native classifier models were pi's; harnesses offer none. */
export async function engineClassifiers(): Promise<EngineModel[]> {
  return [];
}
