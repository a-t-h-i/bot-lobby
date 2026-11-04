import type { HostAPI, HostContext, SlashCommandInfo } from "../host/api.ts";
import { pushNotice } from "../webui/notices.ts";

export interface LobbySlashCommand {
  name: string;
  description: string;
  terminal?: boolean;
}

// Pi 1.4's native commands are not exported by its public API; getCommands lists only resources.
const NATIVE_COMMANDS = [
  ["settings", "Open Pi settings"],
  ["model", "Select model"],
  ["tree", "Navigate the session tree"],
  ["thinking", "Set thinking level"],
  ["scoped-models", "Choose models for cycling"],
  ["export", "Export the session as HTML or JSONL"],
  ["import", "Import a JSONL session"],
  ["share", "Share the session"],
  ["bug", "Report a bug to Pi developers"],
  ["copy", "Copy the last agent message"],
  ["name", "Set the session name"],
  ["session", "Show session info and usage"],
  ["changelog", "Show Pi changelog"],
  ["hotkeys", "Show Pi keyboard shortcuts"],
  ["fork", "Fork from a previous message"],
  ["clone", "Duplicate the current session"],
  ["trust", "Save the project trust decision"],
  ["login", "Configure provider authentication"],
  ["logout", "Remove provider authentication"],
  ["new", "Start a new session"],
  ["compact", "Compact the session context"],
  ["resume", "Resume a saved session"],
  ["reload", "Reload extensions, skills, prompts and settings"],
  ["quit", "Quit Pi"],
] as const;

function resources(pi?: HostAPI): SlashCommandInfo[] {
  try {
    return pi?.getCommands?.() ?? [];
  } catch {
    return [];
  }
}

export function piCommands(pi?: HostAPI): LobbySlashCommand[] {
  const commands = new Map<string, LobbySlashCommand>(NATIVE_COMMANDS.map(([name, description]) => [
    name, { name, description, ...(name === "compact" ? {} : { terminal: true }) },
  ]));
  for (const command of resources(pi)) {
    if (!commands.has(command.name)) commands.set(command.name, { name: command.name, description: command.description ?? "" });
  }
  return [...commands.values()];
}

function compact(_ctx: HostContext, _instructions: string): string {
  // The Orchestrator's coding agent keeps and compacts its own context.
  return "the coding agent compacts its own context; start a new session to clear it";
}

function handoff(ctx: HostContext, text: string): string {
  if (ctx.mode !== "tui") return `${text.split(/\s+/)[0]} requires Pi's terminal UI; this session has no terminal`;
  const draft = ctx.ui.getEditorText();
  if (draft.trim() && draft !== text) return "Pi's terminal has an unfinished draft — clear it before handing off this command";
  ctx.ui.setEditorText(text);
  return `prepared ${text.split(/\s+/)[0]} in Pi — press Enter in Pi's terminal to run it`;
}

export function sendPiCommand(pi: HostAPI, ctx: HostContext, text: string): string {
  const input = text.trim();
  const name = input.slice(1).split(/\s+/)[0]!;
  if (name === "compact") return compact(ctx, input.slice(name.length + 1).trim());
  const command = piCommands(pi).find((entry) => entry.name === name);
  if (command?.terminal) return handoff(ctx, input);
  if (!command && !/^skill:[^\s/]+$/.test(name)) return `unknown Pi command /${name}`;
  pi.sendUserMessage(input, { expandPromptTemplates: true, ...(!ctx.isIdle() ? { deliverAs: "followUp" as const } : {}) });
  return `sent /${name} to pi`;
}
