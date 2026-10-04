/** Persisted delivery review contract; completion and publication are separate. */
export type DeliveryStatus = "pending_approval" | "deferred" | "in_progress" | "successful" | "recoverable_failure";
export type DeliveryAction = "create_pr" | "merge_main";
export type DeliveryChecksState = "passing" | "failing" | "pending" | "absent" | "unavailable" | "stale";

export interface DeliveryVerification {
  checks: DeliveryChecksState;
  summary: string;
  localVerified: boolean;
  requiredChecks: string[];
  rulesKnown: boolean;
}

export interface DeliveryOperation {
  id: string;
  action: DeliveryAction;
  sourceCommit: string;
  repository?: string;
  remote?: string;
  sourceBranch?: string;
  target?: "main";
  fingerprint?: string;
  reviewId?: string;
  integrationPath?: string;
  targetCommit?: string;
  stage: string;
  mergeCommit?: string;
  pullNumber?: number;
  pullUrl?: string;
  startedAt: string;
}

export interface DeliveryResult {
  action: DeliveryAction;
  commit?: string;
  pullNumber?: number;
  pullUrl?: string;
}

export interface Delivery {
  status: DeliveryStatus;
  reviewId: string;
  repository?: string;
  remote?: string;
  project: string;
  sourceBranch: string;
  sourceCommit?: string;
  target: "main";
  targetCommit?: string;
  reviewedAt: string;
  verification?: DeliveryVerification;
  /** Fingerprint of reviewed rules and check responses; missing means not reviewed. */
  fingerprint?: string;
  blocked: Partial<Record<DeliveryAction, string>>;
  operation?: DeliveryOperation;
  /** Reconciled, non-delivered intents superseded only by explicit fresh approval. */
  previousOperations?: DeliveryOperation[];
  error?: string;
  result?: DeliveryResult;
}
