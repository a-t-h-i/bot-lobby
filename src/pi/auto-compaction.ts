import { compact, CONFIG_DIR_NAME, DEFAULT_COMPACTION_SETTINGS, estimateTokens, findCutPoint, type ExtensionAPI, type ExtensionContext, type TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { contextMarks, freshContextOn } from "./fresh-context.ts";
import { AUTO_COMPACT_ENV, isSubagentProcess } from "./quiet.ts";
import { dataRoot, detectProjectRoot, loadConfig } from "../state/project.ts";
import { describeShared, DIGEST_INSTRUCTION, parseDigest, shareDigest, type DigestItem } from "../knowledge/oracle-digest.ts";

const CHECKPOINT = "Write a concise checkpoint with: Requirements and constraints; Decisions; Files changed; Verification and evidence; Failed approaches (do not repeat); Unfinished work and next action; Outstanding children and their assignments. Preserve concrete file references and distinguish verified facts from guesses. The parent remains responsible for integration and verification.";

export interface AutoCompactionOptions {
  /** Whether this agent compacts on its own: a subagent by its environment, the oracle by its settings. */
  enabled?: () => boolean;
  /** Where the oracle's shared knowledge goes; by default the project's knowledge files. */
  share?: (items: DigestItem[], ctx: ExtensionContext) => string;
}

function enabledBySettings(): boolean {
  if (isSubagentProcess()) return process.env[AUTO_COMPACT_ENV] !== "0";
  try {
    return loadConfig().master.autoCompact !== false;
  } catch {
    return true;
  }
}

function shareWithAgents(items: DigestItem[], ctx: ExtensionContext): string {
  const root = detectProjectRoot(ctx.cwd, CONFIG_DIR_NAME);
  return describeShared(shareDigest(dataRoot(root, CONFIG_DIR_NAME), items));
}

export const CONTEXT_TARGET = 64_000;

export function compactionThreshold(window: number, reserve = DEFAULT_COMPACTION_SETTINGS.reserveTokens): number {
  return Math.max(1, Math.min(CONTEXT_TARGET, Math.floor(window * 0.6), window - Math.min(reserve, Math.floor(window / 2))));
}

/**
 * Compact at a settled tool boundary; ctx.compact() would abort the turn we need to continue. Each agent's settings
 * can turn it off. The oracle's checkpoint also lists what it learned that is worth keeping, tagged by agent, and
 * that goes into the knowledge base: its own, and the designer's, backend's and QA's where it concerns them.
 */
export function registerAutoCompaction(pi: ExtensionAPI, summarize: typeof compact = compact, options: AutoCompactionOptions = {}): void {
  const enabled = options.enabled ?? enabledBySettings;
  const share = options.share ?? shareWithAgents;
  const oracle = !isSubagentProcess();
  let busy = false;
  let lastLeaf: string | null | undefined;
  pi.on("session_start", () => { busy = false; lastLeaf = undefined; });
  pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
    if (busy || !ctx.model || !enabled()) return;
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
    const keepRecentTokens = Math.min(16_000, override?.keepRecentTokens ?? configured?.keepRecentTokens ?? DEFAULT_COMPACTION_SETTINGS.keepRecentTokens, Math.floor(threshold / 4));
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
      const result = await summarize({ firstKeptEntryId, messagesToSummarize: messages, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: estimate, previousSummary: previous?.type === "compaction" ? previous.summary : undefined, fileOps, settings: { enabled: true, reserveTokens: reserve, keepRecentTokens } }, auth.baseUrl ? { ...ctx.model, baseUrl: auth.baseUrl } : ctx.model, auth.apiKey, headers, oracle ? `${CHECKPOINT} ${DIGEST_INSTRUCTION}` : CHECKPOINT, ctx.signal, undefined, undefined, auth.env, retryPolicy);
      ctx.signal?.throwIfAborted();
      ctx.ui.notify("Agent context compacted", "info");
      if (oracle) {
        try {
          const items = parseDigest(result.summary);
          const shared = items.length ? share(items, ctx) : "";
          if (shared) ctx.ui.notify(`Knowledge updated: ${shared}`, "info");
        } catch (error) {
          ctx.ui.notify(`Could not update knowledge: ${(error as Error).message}`, "warning");
        }
      }
      return { entries: [...event.entries, { type: "compaction" as const, summary: result.summary, firstKeptEntryId, usage: result.usage, details: result.details }] };
    } catch (error) {
      ctx.ui.notify(`Context compaction failed: ${(error as Error).message}`, "warning");
    } finally { busy = false; }
  });
}
