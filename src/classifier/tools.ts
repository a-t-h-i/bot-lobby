/**
 * `find_relevant_files` inside a subagent: the agent describes what it is
 * looking for in plain words and gets the repository's files ranked by the
 * classifier, instead of walking the tree with find and grep. The engine adds
 * the tool to an agent's allowlist only while file hints are on; when the
 * classifier is off or does not answer, the tool says so and the agent
 * searches as usual.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { classifier, sessionScope } from "./instance.ts";
import { FIND_FILES_TOOL, likelyFiles, type LikelyFiles } from "./files.ts";
import type { Classifier } from "./classifier.ts";
import type { FileScope } from "./files.ts";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

export const MAX_TOP_K = 25;

/** The tool's answer: ranked paths with their relevance, or why there are none. */
export function formatLikely(query: string, result: LikelyFiles | undefined): string {
  if (!result) return "The classifier did not answer; search with grep and find instead.";
  if (result.files.length === 0) return `No file stands out for "${query}" (any file relevant: ${result.anyRelevant.toFixed(2)}, ${result.judged} judged); search with grep and find instead.`;
  return [
    `Files most likely needed for "${query}" (any file relevant: ${result.anyRelevant.toFixed(2)}; ${result.judged} judged):`,
    ...result.files.map((file, index) => `${index + 1}. ${file.path} — ${file.relevance.toFixed(2)}`),
    "Read the top ones first; relevance is a hint, not a fact.",
  ].join("\n");
}

/** Run one lookup; exported for tests. */
export async function findRelevantFiles(jev: Classifier, scope: FileScope | undefined, query: string, topK: number | undefined, signal?: AbortSignal): Promise<string> {
  if (!jev.enabled("files")) return "The classifier's file hints are off; search with grep and find instead.";
  if (!scope) return "No session scope yet; search with grep and find instead.";
  const k = Math.max(1, Math.min(MAX_TOP_K, Math.round(topK ?? 10)));
  const result = await likelyFiles(jev, scope, query, { topK: k, ...(signal ? { signal } : {}) });
  return formatLikely(query, result);
}

export function registerClassifierTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: FIND_FILES_TOOL,
    label: "Find relevant files",
    description:
      "Rank this repository's files by how likely your task needs them, with a fast classifier (no index to build, no embeddings). " +
      "Describe what you are looking for in plain words — \"where the session cookie is validated\", \"tests for the export endpoint\" — not keywords. " +
      "Returns up to top_k paths with a relevance from 0 to 1, and how likely any file answers at all. Use it before a broad find or grep, then read the top files.",
    parameters: Type.Object({
      query: Type.String({ description: "What you are looking for, in plain words" }),
      top_k: Type.Optional(Type.Number({ description: `How many files to return (1-${MAX_TOP_K}, default 10)` })),
    }),
    async execute(_id, params, signal) {
      return text(await findRelevantFiles(classifier(), sessionScope(), params.query, params.top_k, signal));
    },
  });
}
