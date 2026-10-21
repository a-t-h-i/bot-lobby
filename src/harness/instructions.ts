/**
 * How Bot Lobby's prompts reach a third-party harness.
 *
 * Codex takes them as developer instructions and Claude Code appends them to
 * its own system prompt; ACP has no system prompt field, so they ride in the
 * first prompt, wrapped so they cannot be mistaken for the user's words.
 * Adapted from T3 Code, `packages/provider-core/src/server/runtimeInstructions.ts`
 * (`buildRuntimeInstructions`) and `orchestrationInstructions.ts`
 * (`t3AcpPromptWithInstructions`).
 */
import type { HarnessRun } from "../schemas/harness.ts";
import { HARNESSES } from "./catalog.ts";

/** Pi's tool names in the role prompts, and what stands in for them on another harness. */
const HARNESS_NOTE = `## Running on another harness

You run in Bot Lobby through a third-party harness, not pi. Where these instructions name pi's tools (read, edit, write, bash, grep, find, ls), use your own equivalents. Bot Lobby's own tools (ask_user_question, ask_expert, the file desk and task board tools, web_search and fetch_content) are not available here: work from the brief, use your own web tools if you have them, and put any open question or blocker in your report instead of asking.`;

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/** Who and what the agent runs as, in case it is asked. */
export function runtimeInstructions(harness: HarnessRun, effort?: string): string {
  const model = toSingleLine(harness.model);
  const modelInfo = model ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${toSingleLine(effort)} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in Bot Lobby through the ${HARNESSES[harness.id].label} harness${modelInfo}${effortInfo}. No need to mention this otherwise.</runtime_info>`;
}

/**
 * The instructions a harness run gets: the compiled role prompt and the
 * harness note when prompts are injected, else only the report format the
 * engine parses (`contract`), which a run cannot do without.
 */
export function harnessInstructions(input: { harness: HarnessRun; systemPrompt?: string; contract?: string; effort?: string }): string {
  const body = input.harness.settings.injectPrompts ? [input.systemPrompt ?? "", HARNESS_NOTE] : [input.contract ?? ""];
  return [...body, runtimeInstructions(input.harness, input.effort)].filter((part) => part.trim().length > 0).join("\n\n---\n\n");
}

/** ACP: the instructions go in front of the first prompt, wrapped; a native slash command stays first. */
export function acpPromptWithInstructions(prompt: string, instructions: string): string {
  if (prompt.trimStart().startsWith("/") || !instructions.trim()) return prompt;
  return `<bot_lobby_instructions>\n${instructions}\n</bot_lobby_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}
