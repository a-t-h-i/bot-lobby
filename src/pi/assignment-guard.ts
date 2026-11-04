/**
 * The in-process guard for a worker running a structured assignment. The
 * engine passes the assignment's replacement tool allowlist, its files and
 * its discovery ledger through `BOT_LOBBY_ASSIGNMENT`; inside the pi process
 * this guard:
 *
 * - reapplies the allowlist before every run and checks the declared tools
 *   (the active set and the tools in each provider request) against it,
 *   writing an attestation the engine requires after the run, and stopping
 *   the worker when an unauthorized declaration survives;
 * - blocks every call outside the allowlist, direct, discovered or nested
 *   (codemode scripts' calls arrive here too), so codemode never reaches an
 *   unselected MCP tool;
 * - charges discovery lookups (reads of unassigned files, searches, listings)
 *   one by one against the persisted ledger, under its lock, so concurrent and
 *   nested calls count separately and a retry keeps what was spent;
 * - refuses edits to files the assignment does not mark edit or create.
 *
 * Shell use is instruction-governed: a `bash` call is never charged or
 * blocked here (only an exact assigned verification command is named free).
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { consumeAssignmentDiscovery } from "../execution/assignment-discovery.ts";

export const ASSIGNMENT_ENV = "BOT_LOBBY_ASSIGNMENT";

/** What the engine hands the worker's process; host-authored, never from model output. */
export interface AssignmentGuardSpec {
  taskDir: string;
  assignmentId: string;
  revision: number;
  /** The replacement allowlist, sorted and deduplicated. */
  tools: string[];
  cwd: string;
  files: { path: string; access: "reference" | "edit" | "create" }[];
  verification: string[];
  /** Where the guard writes what it saw and enforced, for the engine to check after the run. */
  attestation: string;
}

export interface AssignmentAttestation {
  assignmentId: string;
  revision: number;
  allowed: string[];
  declared: string[];
  /** Tools a script could reach by name; every call to one outside the allowlist is blocked. */
  blockedCallable: string[];
  unauthorized: string[];
  ok: boolean;
}

/** Tools that look things up; each call (outside the assigned files) is one discovery lookup. */
export const DISCOVERY_TOOLS: readonly string[] = ["grep", "find", "ls", "tool_search", "search_knowledge", "find_relevant_files"];
const EDIT_TOOLS = new Set(["edit", "write"]);

export function parseAssignmentGuard(raw: string | undefined): AssignmentGuardSpec | undefined {
  if (!raw) return undefined;
  const spec = JSON.parse(raw) as AssignmentGuardSpec;
  const valid = typeof spec?.taskDir === "string" && typeof spec.assignmentId === "string" && Number.isSafeInteger(spec.revision) && Array.isArray(spec.tools)
    && typeof spec.cwd === "string" && Array.isArray(spec.files) && Array.isArray(spec.verification) && typeof spec.attestation === "string";
  if (!valid) throw new Error("Invalid bot-lobby assignment guard.");
  return spec;
}

function inputPath(input: unknown): string | undefined {
  const record = (input ?? {}) as { path?: unknown; file_path?: unknown };
  const path = record.path ?? record.file_path;
  return typeof path === "string" && path.trim() ? path.trim().replace(/^@/, "") : undefined;
}

/** Tool names a provider request declares, across the payload shapes pi's providers send. */
export function payloadToolNames(payload: unknown): string[] | undefined {
  const tools = (payload as { tools?: unknown } | undefined)?.tools;
  if (!Array.isArray(tools)) return undefined;
  return tools.map((tool) => {
    const entry = tool as { name?: unknown; function?: { name?: unknown }; functionDeclarations?: { name?: unknown }[] };
    return typeof entry.name === "string" ? entry.name : typeof entry.function?.name === "string" ? entry.function.name : "";
  }).filter(Boolean);
}

/** Drop undeclared tools from a provider payload; other shapes pass through untouched. */
function filterPayload(payload: unknown, allowed: ReadonlySet<string>): unknown {
  const record = payload as { tools?: unknown[] };
  if (!Array.isArray(record?.tools)) return payload;
  const tools = record.tools.filter((tool) => {
    const entry = tool as { name?: unknown; function?: { name?: unknown } };
    const name = typeof entry.name === "string" ? entry.name : typeof entry.function?.name === "string" ? entry.function.name : undefined;
    return name === undefined || allowed.has(name);
  });
  return tools.length === record.tools.length ? payload : { ...record, tools };
}

export type GuardDecision = { block: true; reason: string; terminate?: boolean } | { charge: number } | undefined;

/** The pure part of the call check: allowlist, edit scope, and how many lookups the call costs. */
export function checkAssignedCall(spec: AssignmentGuardSpec, name: string, input: unknown): GuardDecision {
  if (!spec.tools.includes(name)) return { block: true, reason: `${name} is not selected for assignment ${spec.assignmentId}. Add a tools need ({"kind":"tools", ...}) to your report and continue with the work it does not affect.` };
  const path = inputPath(input);
  const target = path ? resolve(spec.cwd, path) : undefined;
  const assigned = target ? spec.files.find((file) => resolve(spec.cwd, file.path) === target) : undefined;
  if (EDIT_TOOLS.has(name)) {
    if (assigned && assigned.access !== "reference") return undefined;
    return { block: true, reason: `${path ?? "That file"} is not an edit or create path of assignment ${spec.assignmentId}. Finding a file does not let you edit it: add a files need ({"kind":"files", ...}) to your report.` };
  }
  if (name === "read") return assigned ? undefined : { charge: 1 };
  if (name === "bash") return undefined;
  return DISCOVERY_TOOLS.includes(name) ? { charge: 1 } : undefined;
}

function writeAttestation(path: string, attestation: AssignmentAttestation): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(attestation)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function registerAssignmentGuard(pi: ExtensionAPI, spec = parseAssignmentGuard(process.env[ASSIGNMENT_ENV])): void {
  if (!spec) return;
  const allowed = new Set(spec.tools);
  let failure: string | undefined;

  pi.on("before_agent_start", (_event, ctx) => {
    // Reapply: a restored conversation or another extension may have widened the active set.
    pi.setActiveTools(pi.getActiveTools().filter((name) => allowed.has(name)));
    const declared = [...new Set(pi.getActiveTools())].sort();
    const unauthorized = declared.filter((name) => !allowed.has(name));
    const scripted = declared.includes("codemode") ? pi.getAllTools().filter((tool) => tool.exposure === "codemode" || tool.exposure === "deferred").map((tool) => tool.name) : [];
    const blockedCallable = [...new Set(scripted.filter((name) => !allowed.has(name)))].sort();
    writeAttestation(spec.attestation, { assignmentId: spec.assignmentId, revision: spec.revision, allowed: [...allowed].sort(), declared, blockedCallable, unauthorized, ok: unauthorized.length === 0 });
    if (unauthorized.length > 0) {
      failure = `Assigned execution compatibility: ${unauthorized.join(", ")} stayed declared after the allowlist was reapplied; the worker was stopped.`;
      ctx.abort();
    }
  });

  pi.on("before_provider_request", (event) => {
    if (failure) throw new Error(failure);
    const names = payloadToolNames(event.payload);
    if (!names || names.every((name) => allowed.has(name))) return undefined;
    return filterPayload(event.payload, allowed);
  });

  pi.on("tool_call", async (event) => {
    if (failure) return { block: true, reason: failure, terminate: true };
    const decision = checkAssignedCall(spec, event.toolName, event.input);
    if (!decision || !("charge" in decision)) return decision;
    try {
      await consumeAssignmentDiscovery(spec.taskDir, spec.assignmentId, spec.revision, decision.charge);
      return undefined;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { block: true, reason: `${reason}. Work with your assigned files; add a discovery need ({"kind":"discovery", ...}) to your report for anything else.` };
    }
  });
}
