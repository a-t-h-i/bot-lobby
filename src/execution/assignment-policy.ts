import type { WorkerAssignment } from "./assignment.ts";

export interface AssignmentToolInventory {
  /** Full combined role, coordination, knowledge, ask and configured MCP grants. */
  granted: readonly string[];
  /** Known names may include configured tools which are currently disconnected. */
  known: readonly string[];
  available: readonly string[];
}

export class AssignmentPolicyError extends Error {
  constructor(message: string) { super(`Assignment tool policy: ${message}`); this.name = "AssignmentPolicyError"; }
}

function names(values: readonly string[]): string[] { return [...new Set(values)].sort(); }

/** Replacement, never an additive loadout; codemode confers no implicit nested grants. */
export function selectAssignmentTools(assignment: Pick<WorkerAssignment, "tools">, inventory: AssignmentToolInventory): string[] {
  const selected = names(assignment.tools.map((tool) => tool.name));
  for (const name of selected) {
    if (!inventory.known.includes(name)) throw new AssignmentPolicyError(`unknown tool ${name}; request a valid exact tool name`);
    if (!inventory.granted.includes(name)) throw new AssignmentPolicyError(`ungranted tool ${name}; request a master tool expansion and existing role/configuration grant`);
    if (!inventory.available.includes(name)) throw new AssignmentPolicyError(`unavailable tool ${name}; reconnect its provider before dispatch`);
  }
  return selected;
}

export interface AssignmentToolCall {
  name: string;
  /** Host-decoded calls, not untrusted model classifications or arbitrary source code. */
  children?: readonly AssignmentToolCall[];
  purpose?: "discovery" | "assigned-read" | "assigned-verification" | "work";
}

const DISCOVERY_TOOLS = new Set(["read", "bash", "grep", "find", "ls", "find_relevant_files", "tool_search", "search_knowledge"]);

/** Validate every decoded direct/discovered/nested leaf before any batch dispatch. */
export function assignmentCallDiscovery(selected: readonly string[], calls: readonly AssignmentToolCall[]): number {
  let count = 0;
  for (const call of calls) {
    if (!selected.includes(call.name)) throw new AssignmentPolicyError(`unselected call ${call.name}; request a tool expansion before execution`);
    if (call.purpose !== "assigned-read" && call.purpose !== "assigned-verification" && call.purpose !== "work" && (call.purpose === "discovery" || DISCOVERY_TOOLS.has(call.name))) count++;
    count += assignmentCallDiscovery(selected, call.children ?? []);
  }
  return count;
}
