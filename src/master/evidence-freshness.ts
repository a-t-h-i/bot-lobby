/** Task-local background validation. Briefs and persistent notes remain separate. */
import { contentHash } from "../knowledge/file-notes.ts";

export interface EvidenceHint {
  id: string;
  scope: "file" | "repository";
  source: string;
  fingerprint: string;
}

export interface FreshnessInvalidation {
  assignmentId: string;
  revision: number;
  hintIds: string[];
  pause: true;
  recheckCompletedWork: boolean;
}

interface EvidenceRevision {
  revision: number;
  pending: number;
  invalid: Set<string>;
  completed: boolean;
}

export type EvidenceStatus = "unverified hints" | "verified" | "invalidated" | "superseded";

/** File-local checks never establish current callers, coverage or broad behavior. */
export async function verifyEvidenceHint(cwd: string, hint: EvidenceHint, currentTree: () => Promise<string | undefined>): Promise<boolean> {
  const fingerprint = hint.scope === "file" ? await contentHash(cwd, hint.source) : await currentTree();
  return fingerprint !== undefined && fingerprint === hint.fingerprint;
}

export class EvidenceFreshness {
  private readonly revisions = new Map<string, EvidenceRevision>();
  private readonly checks = new Map<string, Promise<boolean>>();

  private readonly check: (hint: EvidenceHint) => Promise<boolean>;
  private readonly notify: (event: FreshnessInvalidation) => void | Promise<void>;

  constructor(check: (hint: EvidenceHint) => Promise<boolean>, notify: (event: FreshnessInvalidation) => void | Promise<void>) {
    this.check = check;
    this.notify = notify;
  }

  /** Launch alongside dispatch; await the returned promise before accepting work. */
  start(input: { assignmentId: string; revision: number; hints: readonly EvidenceHint[] }): Promise<void> {
    const previous = this.revisions.get(input.assignmentId);
    if (previous && (previous.revision > input.revision || (previous.revision === input.revision && !previous.completed))) {
      throw new Error("Freshness checks require an increasing assignment revision or a completed dispatch retry.");
    }
    const hints = [...new Map(input.hints.map((hint) => [hint.id, { ...hint }])).values()];
    const state: EvidenceRevision = { revision: input.revision, pending: hints.length, invalid: new Set(), completed: false };
    this.revisions.set(input.assignmentId, state);
    // A failed status delivery must not end the acceptance barrier while other checks still run.
    return Promise.allSettled(hints.map((hint) => this.validate(input.assignmentId, state, hint))).then((results) => {
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
  }

  completed(assignmentId: string, revision: number): void {
    const state = this.revisions.get(assignmentId);
    if (state?.revision === revision) state.completed = true;
  }

  status(assignmentId: string, revision: number): EvidenceStatus {
    const state = this.revisions.get(assignmentId);
    if (state?.revision !== revision) return "superseded";
    if (state.invalid.size) return "invalidated";
    return state.pending ? "unverified hints" : "verified";
  }

  canAccept(assignmentId: string, revision: number): boolean {
    return this.status(assignmentId, revision) === "verified";
  }

  private sharedCheck(hint: EvidenceHint): Promise<boolean> {
    const key = JSON.stringify([hint.scope, hint.source, hint.fingerprint]);
    const existing = this.checks.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(() => this.check(hint)).catch(() => false);
    this.checks.set(key, pending);
    void pending.then(() => { if (this.checks.get(key) === pending) this.checks.delete(key); });
    return pending;
  }

  private async validate(assignmentId: string, state: EvidenceRevision, hint: EvidenceHint): Promise<void> {
    const valid = await this.sharedCheck(hint);
    if (this.revisions.get(assignmentId) !== state) return;
    state.pending -= 1;
    if (valid) return;
    state.invalid.add(hint.id);
    await this.notify({ assignmentId, revision: state.revision, hintIds: [hint.id], pause: true, recheckCompletedWork: state.completed });
  }
}
