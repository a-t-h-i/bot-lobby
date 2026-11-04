import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { truncate } from "../text.ts";
import { isQuiet, isSubagentProcess } from "./quiet.ts";

type BuiltinName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";

/** Built-in factories; their definitions carry the metadata the model needs. */
const FACTORIES: Record<BuiltinName, (cwd: string) => ToolDefinition<any, any, any>> = {
  read: createReadToolDefinition,
  bash: createBashToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
  grep: createGrepToolDefinition,
  find: createFindToolDefinition,
  ls: createLsToolDefinition,
};

const ARG_CHARS = 100;
const OUTPUT_CHARS = 2000;

/** Minimal theme surface used by the renderers, so they stay easy to unit test. */
interface RenderTheme {
  fg(color: "accent" | "dim" | "error" | "muted" | "success" | "toolTitle", text: string): string;
  bold(text: string): string;
}

const definitions = new Map<string, ToolDefinition<any, any, any>>();

/** Cache one factory definition per cwd so execution keeps the session's cwd. */
function definitionFor(name: BuiltinName, cwd: string): ToolDefinition<any, any, any> {
  const key = `${cwd}\0${name}`;
  let definition = definitions.get(key);
  if (!definition) {
    definition = FACTORIES[name](cwd);
    definitions.set(key, definition);
  }
  return definition;
}

function primaryArg(name: BuiltinName, args: unknown): string {
  const record = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const raw = name === "bash" ? record.command : name === "grep" || name === "find" ? record.pattern : record.path;
  return typeof raw === "string" ? raw : "";
}

/** One-line summary of a call: tool name and its primary argument. */
function summarizeCall(name: BuiltinName, args: unknown): string {
  const primary = primaryArg(name, args).replace(/\s+/g, " ").trim();
  return truncate(primary.length > 0 ? primary : "…", ARG_CHARS);
}

function resultText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
}

function resultSummary(
  name: BuiltinName,
  args: unknown,
  content: Array<{ type: string; text?: string }>,
  expanded: boolean,
  isError: boolean,
  theme: RenderTheme,
): string {
  const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
  const body = resultText(content);
  const head = `${icon} ${theme.fg("toolTitle", theme.bold(name))} ${theme.fg("accent", summarizeCall(name, args))}`;
  if (!expanded || body.length === 0) return head;
  return `${head}\n${theme.fg("dim", truncate(body, OUTPUT_CHARS))}`;
}

function callLine(name: BuiltinName, args: unknown, theme: RenderTheme): string {
  return `${theme.fg("toolTitle", theme.bold(name))} ${theme.fg("accent", summarizeCall(name, args))}`;
}

/** Quiet-aware rendering; execution still delegates to the shipped factory. */
function quietDefinition(name: BuiltinName, definition: ToolDefinition<any, any, any>): ToolDefinition<any, any, any> {
  return {
    ...definition,
    renderShell: "self",
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      definitionFor(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx),
    renderCall: (args, theme) => (isQuiet() ? new Container() : new Text(callLine(name, args, theme), 0, 0)),
    renderResult: (result, options, theme, ctx) =>
      isQuiet()
        ? new Container()
        : new Text(resultSummary(name, ctx.args, result.content, options.expanded, ctx.isError, theme), 0, 0),
  };
}

/**
 * Replace pi's built-in tool definitions with quiet renderers. Called
 * intentionally on every `session_start` (startup, reload, new, resume, fork):
 * re-registering a name replaces that entry because the extension registry is a
 * name-keyed Map (`registerTool` -> `extension.tools.set(name, ...)`), so this
 * never accumulates duplicates. Spreading the factory definition keeps
 * `promptSnippet`/`promptGuidelines`, so the model's tool guidance is unchanged.
 * Must run after the extension runtime is bound because it reads `getAllTools()`
 * to avoid registering phantom tools.
 */
export function registerQuietTools(pi: ExtensionAPI): void {
  if (isSubagentProcess()) return;
  const present = new Set(pi.getAllTools().map((tool) => tool.name));
  for (const name of Object.keys(FACTORIES) as BuiltinName[]) {
    if (!present.has(name)) continue;
    pi.registerTool(quietDefinition(name, definitionFor(name, process.cwd())));
  }
}
