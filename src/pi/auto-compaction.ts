import { compact, DEFAULT_COMPACTION_SETTINGS, estimateTokens, findCutPoint, type ExtensionAPI, type TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { contextMarks, freshContextOn } from "./fresh-context.ts";
import { isSubagentProcess } from "./quiet.ts";

export const CONTEXT_TARGET = 250_000;

export function compactionThreshold(window: number, reserve = DEFAULT_COMPACTION_SETTINGS.reserveTokens): number {
  return Math.max(1, Math.min(CONTEXT_TARGET, Math.floor(window * 0.8), window - Math.min(reserve, Math.floor(window / 2))));
}

/** Compact at a settled tool boundary; ctx.compact() would abort the turn we need to continue. */
export function registerAutoCompaction(pi: ExtensionAPI, summarize: typeof compact = compact): void {
  let busy = false;
  let lastLeaf: string | null | undefined;
  pi.on("session_start", () => { busy = false; lastLeaf = undefined; });
  pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
    if (busy || !ctx.model) return;
    const leaf = ctx.sessionManager.getLeafId();
    if (leaf === lastLeaf) return;
    const configured = pi.getSettings().compaction;
    const override = configured?.modelOverrides?.[`${ctx.model.provider}/${ctx.model.id}`];
    const reserve = Math.min(override?.reserveTokens ?? configured?.reserveTokens ?? DEFAULT_COMPACTION_SETTINGS.reserveTokens, Math.floor(ctx.model.contextWindow / 2));
    const threshold = compactionThreshold(ctx.model.contextWindow, reserve);
    const estimate = event.context.contextMessages.reduce((total, message) => total + estimateTokens(message), 0) + Math.ceil(ctx.getSystemPrompt().length / 4);
    const usage = ctx.getContextUsage();
    if (Math.max(estimate, usage?.tokens ?? 0) < threshold) return;
    let entries = ctx.sessionManager.buildContextEntries();
    if (!isSubagentProcess() && freshContextOn()) {
      const boundary = contextMarks(ctx.sessionManager.getBranch()).at(-1)?.at;
      if (boundary !== undefined) entries = entries.filter((entry) => Date.parse(entry.timestamp) >= boundary);
    }
    if (entries.length < 2) return;
    const keepRecentTokens = Math.min(override?.keepRecentTokens ?? configured?.keepRecentTokens ?? DEFAULT_COMPACTION_SETTINGS.keepRecentTokens, Math.floor(threshold / 4));
    const cut = findCutPoint(entries, 0, entries.length, keepRecentTokens);
    if (cut.firstKeptEntryIndex <= 0) return;
    const prefix = entries.slice(0, cut.firstKeptEntryIndex);
    const messages = prefix.flatMap((entry) => entry.type === "message" ? [entry.message] : []);
    if (!messages.length) return;
    const previous = [...entries].reverse().find((entry) => entry.type === "compaction");
    const firstKeptEntryId = entries[cut.firstKeptEntryIndex]!.id;
    const fileOps = { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() };
    const details = previous?.type === "compaction" ? previous.details as { readFiles?: string[]; modifiedFiles?: string[] } | undefined : undefined;
    for (const path of details?.readFiles ?? []) fileOps.read.add(path);
    for (const path of details?.modifiedFiles ?? []) fileOps.edited.add(path);
    for (const message of messages) {
      const calls = message.role === "assistant" ? message.content.filter((part) => part.type === "toolCall") : message.role === "toolResult" ? message.nestedCalls?.calls ?? [] : [];
      for (const call of calls) {
        const path = call.arguments?.path;
        if (typeof path !== "string") continue;
        if (call.name === "read") fileOps.read.add(path);
        if (call.name === "write") fileOps.written.add(path);
        if (call.name === "edit") fileOps.edited.add(path);
      }
    }
    lastLeaf = leaf;
    busy = true;
    ctx.ui.notify("Compacting agent context", "info");
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      if (!auth.ok) throw new Error(auth.error);
      const headers = auth.headers ? Object.fromEntries(Object.entries(auth.headers).filter((entry): entry is [string, string] => entry[1] !== null)) : undefined;
      const retry = pi.getSettings().retry;
      const retryPolicy = { enabled: retry?.enabled ?? true, maxRetries: retry?.maxRetries ?? 3, baseDelayMs: retry?.baseDelayMs ?? 2_000, maxAgentDelayMs: retry?.maxAgentDelayMs };
      const result = await summarize({ firstKeptEntryId, messagesToSummarize: messages, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: estimate, previousSummary: previous?.type === "compaction" ? previous.summary : undefined, fileOps, settings: { enabled: true, reserveTokens: reserve, keepRecentTokens } }, auth.baseUrl ? { ...ctx.model, baseUrl: auth.baseUrl } : ctx.model, auth.apiKey, headers, "Preserve goals, constraints, decisions, file references, verification evidence, unfinished work and outstanding delegated subtasks. The parent remains responsible for integration and verification.", ctx.signal, undefined, undefined, auth.env, retryPolicy);
      ctx.signal?.throwIfAborted();
      ctx.ui.notify("Agent context compacted", "info");
      return { entries: [...event.entries, { type: "compaction" as const, summary: result.summary, firstKeptEntryId, usage: result.usage, details: result.details }] };
    } catch (error) {
      ctx.ui.notify(`Context compaction failed: ${(error as Error).message}`, "warning");
    } finally { busy = false; }
  });
}
