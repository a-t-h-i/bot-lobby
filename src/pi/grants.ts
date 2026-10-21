/**
 * What Settings can grant an agent: the MCP tools pi has connected and the
 * skills pi finds. The main session's pi is the source (its MCP servers and
 * skill settings are the user's); a skill grant is kept as names and turned
 * into files only when an agent starts, so a moved skill still loads.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, loadSkills } from "@earendil-works/pi-coding-agent";

/** An MCP tool an agent can be granted. */
export interface GrantableTool {
  name: string;
  /** The server it comes from (`github` for `mcp__github__get_issue`). */
  server: string;
  description: string;
  /** The server marks it read-only: scouts, QA and the researcher may call it too. */
  readOnly: boolean;
}

/** A skill an agent can be granted. */
export interface GrantableSkill {
  name: string;
  description: string;
  /** Its SKILL.md (or skill file). */
  path: string;
}

let source: ExtensionAPI | undefined;

/** Read grants from this session's pi from now on. */
export function bindGrants(pi: ExtensionAPI): void {
  source = pi;
}

/** Forget the session (tests). */
export function unbindGrants(): void {
  source = undefined;
}

function serverOf(name: string): string {
  return /^mcp__([A-Za-z0-9_]+?)__/.exec(name)?.[1] ?? "";
}

/** The MCP tools pi has connected, by server then name. */
export function grantableTools(pi: ExtensionAPI | undefined = source): GrantableTool[] {
  let tools: ReturnType<ExtensionAPI["getAllTools"]> = [];
  try {
    tools = pi?.getAllTools() ?? [];
  } catch {
    // Not bound to a running session yet.
  }
  return tools
    .filter((tool) => tool.name.startsWith("mcp__") && tool.exposure !== "hidden")
    .map((tool) => ({ name: tool.name, server: serverOf(tool.name), description: (tool.description ?? "").split("\n")[0]!.trim(), readOnly: tool.annotations?.readOnlyHint === true }))
    .sort((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name));
}

/**
 * The skills an agent working in `cwd` would find: the session's own (its
 * skill commands, which include packages and settings paths) and pi's default
 * folders for `cwd`, first one per name.
 */
export function grantableSkills(cwd: string, pi: ExtensionAPI | undefined = source): GrantableSkill[] {
  const found = new Map<string, GrantableSkill>();
  try {
    for (const command of pi?.getCommands() ?? []) {
      if (command.source !== "skill") continue;
      const name = command.name.replace(/^skill:/, "");
      if (!found.has(name)) found.set(name, { name, description: command.description ?? "", path: command.sourceInfo.path });
    }
  } catch {
    // Not bound to a running session yet.
  }
  try {
    for (const skill of loadSkills({ cwd, agentDir: getAgentDir(), skillPaths: [], includeDefaults: true }).skills) {
      if (!found.has(skill.name)) found.set(skill.name, { name: skill.name, description: skill.description, path: skill.filePath });
    }
  } catch {
    // An unreadable skill folder grants nothing.
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The files of the granted skills that still exist; a name pi no longer finds is left out. */
export function skillFiles(names: readonly string[], cwd: string): string[] {
  if (names.length === 0) return [];
  const byName = new Map(grantableSkills(cwd).map((skill) => [skill.name, skill.path]));
  return names.flatMap((name) => byName.get(name) ?? []);
}
