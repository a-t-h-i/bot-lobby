/**
 * The classifier's model when it is not Jev on a host: whatever
 * `classifier.engine` names (`provider/id`), looked up in pi's own model
 * registry, so it is called with the logins pi already holds (an OpenAI or
 * Anthropic account, an API key, OpenRouter, …). A classifier model (Jev,
 * Cloudflare's clef, Liquid's d1, Upstage's solar-decide, …) answers through
 * pi's `classify`; a chat model answers the same questions as JSON (see
 * `chat.ts`).
 */
import { clampThinkingLevel, type Api, type ClassifierApi, type ClassifierContext, type ClassifierModel, type Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Answer, SystemOneRequest, SystemOneResponse } from "./client.ts";
import { chatClassify } from "./chat.ts";

export type Registry = Pick<ExtensionContext["modelRegistry"], "find" | "findOfType" | "classify" | "streamSimple" | "getAvailableOfType">;

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

/** Answers a request with the model `ref` names; throws when pi has no such model or the call fails. */
export type EngineAnswer = (ref: string, request: SystemOneRequest, options: AnswerOptions) => Promise<SystemOneResponse>;

/** `provider/id` split at the first slash (ids may hold more: `openrouter/liquid/d1`). */
export function splitRef(ref: string): { provider: string; id: string } | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/** pi's `bool` answers are Jev's `noul`; the rest carry over as they are. */
function fromPi(answers: Record<string, unknown>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [key, answer] of Object.entries(answers)) {
    const value = answer as { type?: string; probability?: number };
    out[key] = value.type === "bool" ? { type: "noul", noul: value.probability ?? 0 } : (answer as Answer);
  }
  return out;
}

/** Jev's request as pi's classifier context: `noul` questions are `bool` there, everything else is sent as it is. */
function toPi(request: SystemOneRequest): ClassifierContext {
  return {
    state: request.state,
    questions: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => [key, question.type === "noul" ? { ...question, type: "bool" } : question])),
  } as unknown as ClassifierContext;
}

async function classifyWith(registry: Registry, model: ClassifierModel<ClassifierApi>, request: SystemOneRequest, options: AnswerOptions): Promise<SystemOneResponse> {
  const result = await registry.classify(model, toPi(request), { timeoutMs: options.timeoutMs, ...(options.signal ? { signal: options.signal } : {}) });
  if (result.stopReason !== "stop") throw new Error(result.errorMessage || (result.stopReason === "aborted" ? "cancelled" : "the classifier failed"));
  return {
    model: `${model.provider}/${result.model || model.id}`,
    answers: fromPi(result.answers as Record<string, unknown>),
    ...(result.usage ? { usage: { input_tokens: result.usage.input, output_tokens: result.usage.output } } : {}),
  };
}

/** The least thinking a model allows: none when it can switch it off. */
function leastThinking(model: Model<Api>): "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (!model.reasoning) return undefined;
  const level = clampThinkingLevel(model, "off");
  return level === "off" ? undefined : level;
}

async function chatWith(registry: Registry, model: Model<Api>, request: SystemOneRequest, options: AnswerOptions): Promise<SystemOneResponse> {
  const reasoning = leastThinking(model);
  const timeoutMs = Math.max(options.timeoutMs, options.chatTimeoutMs);
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    return await chatClassify(request, async ({ system, user, maxTokens }) => {
      const stream = registry.streamSimple(model, { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] }, { maxTokens, signal: controller.signal, ...(reasoning ? { reasoning } : {}) });
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
      const reply = await Promise.race([stream.result(), aborted]);
      if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage || `the model stopped (${reply.stopReason})`);
      const text = reply.content.filter((part) => part.type === "text").map((part) => part.text).join("");
      return { text, model: `${model.provider}/${model.id}`, usage: { input_tokens: reply.usage.input, output_tokens: reply.usage.output } };
    }, Boolean(reasoning));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Answers with pi's registry: a classifier model natively, else a chat model through a JSON prompt. */
export function engineAnswer(registry: Registry): EngineAnswer {
  return async (ref, request, options) => {
    const parts = splitRef(ref);
    if (!parts) throw new Error(`"${ref}" is not a provider/model reference`);
    const classifierModel = registry.findOfType("classifier", parts.provider, parts.id);
    if (classifierModel) return classifyWith(registry, classifierModel, request, options);
    const chatModel = registry.find(parts.provider, parts.id);
    if (chatModel) return chatWith(registry, chatModel, request, options);
    throw new Error(`pi has no model ${ref}: pick one you are signed in to in Settings → Classifier`);
  };
}

/** The classifier models pi can call with the logins it holds, as the settings picker lists them. */
export async function engineClassifiers(registry: Registry): Promise<EngineModel[]> {
  const models = await registry.getAvailableOfType("classifier");
  return models.map((model) => ({ id: `${model.provider}/${model.id}`, label: model.name && model.name !== model.id ? model.name : `${model.provider}/${model.id}`, kind: "classifier" as const }));
}
