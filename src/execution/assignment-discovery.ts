import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { assignmentCallDiscovery, type AssignmentToolCall } from "./assignment-policy.ts";

export interface DiscoveryDecision { decisionId: string; reason: string; limit: number }
export interface AssignmentDiscoveryState {
  version: 1;
  assignmentId: string;
  revision: number;
  consumed: number;
  limit: number;
  effectiveLimit: number;
  decisions: DiscoveryDecision[];
}

export class AssignmentDiscoveryError extends Error {
  constructor(message: string) { super(`Assignment discovery: ${message}`); this.name = "AssignmentDiscoveryError"; }
}

function integer(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}
function paths(taskDir: string, id: string) {
  if (!id.trim()) throw new AssignmentDiscoveryError("assignment identity is required");
  const dir = join(taskDir, "assignment-discovery");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash("sha256").update(id).digest("hex")}.json`);
  return { file, lock: `${file}.lock` };
}
function load(file: string, id: string): AssignmentDiscoveryState | undefined {
  try {
    const state: AssignmentDiscoveryState = JSON.parse(readFileSync(file, "utf8"));
    if (state.version !== 1 || state.assignmentId !== id || !integer(state.revision, 1) || !integer(state.consumed, 0) || !integer(state.limit, 0) || !integer(state.effectiveLimit, 0) || state.effectiveLimit > state.limit || state.consumed > state.limit || !Array.isArray(state.decisions)) throw new Error("invalid ledger schema");
    if (state.decisions.some((d) => !d || typeof d.decisionId !== "string" || !d.decisionId.trim() || typeof d.reason !== "string" || !d.reason.trim() || !integer(d.limit, 0))) throw new Error("invalid decision schema");
    if (new Set(state.decisions.map((d) => d.decisionId)).size !== state.decisions.length || (state.limit > 2 && !state.decisions.some((d) => d.limit === state.limit))) throw new Error("allowance lacks a unique persisted master decision");
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new AssignmentDiscoveryError(`cannot recover ledger ${file}: ${error instanceof Error ? error.message : String(error)}; restore it, do not reset consumption`);
  }
}
function save(file: string, state: AssignmentDiscoveryState): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try { writeFileSync(fd, `${JSON.stringify(state)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, file);
  } finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
async function acquire(lock: string): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); }
      catch (error) { closeSync(fd); unlinkSync(lock); throw error; }
      return fd;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await setTimeout(10);
    }
  }
  throw new AssignmentDiscoveryError(`ledger busy at ${lock}; retry, or confirm the owner stopped before explicit lock recovery`);
}
async function update(taskDir: string, id: string, revision: number, change: (state: AssignmentDiscoveryState | undefined) => AssignmentDiscoveryState): Promise<AssignmentDiscoveryState> {
  if (!integer(revision, 1)) throw new AssignmentDiscoveryError("revision must be a positive integer");
  const { file, lock } = paths(taskDir, id);
  const fd = await acquire(lock);
  try {
    const state = load(file, id);
    if (state && revision < state.revision) throw new AssignmentDiscoveryError(`stale revision ${revision}; current revision is ${state.revision}`);
    const next = change(state);
    save(file, next);
    return structuredClone(next);
  } finally { closeSync(fd); unlinkSync(lock); }
}

/** Revision advancement never replenishes allowance, even after process recovery. */
export function prepareAssignmentDiscovery(taskDir: string, id: string, revision: number, requestedLimit = 2): Promise<AssignmentDiscoveryState> {
  if (!integer(requestedLimit, 0)) throw new AssignmentDiscoveryError("limit must be a non-negative integer");
  return update(taskDir, id, revision, (previous) => {
    const state = previous ?? { version: 1 as const, assignmentId: id, revision, consumed: 0, limit: Math.min(requestedLimit, 2), effectiveLimit: Math.min(requestedLimit, 2), decisions: [] };
    if (requestedLimit > state.limit) throw new AssignmentDiscoveryError(`requested limit ${requestedLimit} exceeds approved ${state.limit}; record an explicit master allowance decision first`);
    return { ...state, revision, effectiveLimit: requestedLimit };
  });
}
function current(state: AssignmentDiscoveryState | undefined, revision: number): AssignmentDiscoveryState {
  if (!state) throw new AssignmentDiscoveryError("ledger missing; prepare the persisted assignment before dispatch");
  if (state.revision !== revision) throw new AssignmentDiscoveryError(`revision ${revision} is not prepared; current revision is ${state.revision}`);
  return state;
}

/** Host reads under the same lock; missing/corrupt state is not a fresh allowance. */
export function readAssignmentDiscovery(taskDir: string, id: string, revision: number): Promise<AssignmentDiscoveryState> {
  return update(taskDir, id, revision, (state) => current(state, revision));
}

/** Host/master only: never expose this operation as a worker tool or infer approval from a brief. */
export function approveAssignmentDiscovery(taskDir: string, id: string, revision: number, decision: DiscoveryDecision): Promise<AssignmentDiscoveryState> {
  if (!decision.decisionId.trim() || !decision.reason.trim() || !integer(decision.limit, 0)) throw new AssignmentDiscoveryError("an explicit master decision id, reason and integer limit are required");
  return update(taskDir, id, revision, (previous) => {
    const state = current(previous, revision);
    const old = state.decisions.find((entry) => entry.decisionId === decision.decisionId);
    if (old && (old.limit !== decision.limit || old.reason !== decision.reason)) throw new AssignmentDiscoveryError("decision id already records a different allowance");
    if (old) return state;
    if (decision.limit <= state.limit) throw new AssignmentDiscoveryError("allowance decision must increase the existing total limit");
    return { ...state, limit: decision.limit, decisions: [...state.decisions, { decisionId: decision.decisionId, reason: decision.reason, limit: decision.limit }] };
  });
}

/** Charge before dispatch; failed attempts do not refund discovery. */
export function consumeAssignmentDiscovery(taskDir: string, id: string, revision: number, count = 1): Promise<AssignmentDiscoveryState> {
  if (!integer(count, 0)) throw new AssignmentDiscoveryError("lookup count must be a non-negative integer");
  return update(taskDir, id, revision, (previous) => {
    const state = current(previous, revision);
    if (count === 0) return state;
    if (!Number.isSafeInteger(state.consumed + count) || state.consumed + count > state.effectiveLimit) throw new AssignmentDiscoveryError(`allowance exhausted (${state.consumed}/${state.effectiveLimit}); request a master discovery expansion`);
    return { ...state, consumed: state.consumed + count };
  });
}

/** Future verified runtime boundary: validate the whole batch and atomically charge its leaves. */
export function authorizeAssignmentCalls(taskDir: string, id: string, revision: number, selected: readonly string[], calls: readonly AssignmentToolCall[]): Promise<AssignmentDiscoveryState> {
  return consumeAssignmentDiscovery(taskDir, id, revision, assignmentCallDiscovery(selected, calls));
}
