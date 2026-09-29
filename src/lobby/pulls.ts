/**
 * Pull requests through the `gh` CLI, for the Git tab: the repository's open
 * pull requests, one with its files, reviews and comments, and its diff.
 * Like issues, `gh` owns authentication and repository detection; every
 * failure becomes one readable line.
 */
import { gh, type Exec } from "./issues.ts";

export type ChecksState = "passing" | "failing" | "pending";

export interface PullSummary {
  number: number;
  title: string;
  author?: string;
  /** The branch the pull request comes from, and the one it merges into. */
  headRef: string;
  baseRef: string;
  draft: boolean;
  updatedAt?: string;
  url?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`, when the repository asks for reviews. */
  decision?: string;
  checks?: ChecksState;
  /** How many checks ran. */
  checkCount: number;
  labels: string[];
  /** The head commit: a saved review is stale once it moves. */
  headSha?: string;
}

export interface PullFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface PullNote {
  author?: string;
  body: string;
  at?: string;
  /** A review's verdict: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`. */
  state?: string;
}

export interface PullDetail extends PullSummary {
  body: string;
  state?: string;
  mergeable?: string;
  files: PullFile[];
  /** Reviews and comments, oldest first. */
  notes: PullNote[];
}

const LIST_FIELDS = "number,title,author,headRefName,baseRefName,isDraft,updatedAt,url,additions,deletions,changedFiles,reviewDecision,statusCheckRollup,labels,headRefOid";
const VIEW_FIELDS = `${LIST_FIELDS},body,state,mergeable,files,comments,reviews`;
export const PULL_LIMIT = 50;
/** Longest diff kept for a review: `gh pr diff` can be enormous. */
export const DIFF_CHARS = 200_000;

interface RawCheck {
  status?: unknown;
  conclusion?: unknown;
  state?: unknown;
}

interface RawUser {
  login?: unknown;
}

interface RawPull {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  url?: unknown;
  updatedAt?: unknown;
  isDraft?: unknown;
  author?: RawUser | null;
  headRefName?: unknown;
  baseRefName?: unknown;
  headRefOid?: unknown;
  additions?: unknown;
  deletions?: unknown;
  changedFiles?: unknown;
  reviewDecision?: unknown;
  mergeable?: unknown;
  statusCheckRollup?: RawCheck[] | null;
  labels?: Array<{ name?: unknown }> | null;
  files?: Array<{ path?: unknown; additions?: unknown; deletions?: unknown }> | null;
  comments?: Array<{ author?: RawUser | null; body?: unknown; createdAt?: unknown }> | null;
  reviews?: Array<{ author?: RawUser | null; body?: unknown; submittedAt?: unknown; state?: unknown }> | null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** The checks as one state: any failure fails, any unfinished check is pending, otherwise passing; none at all, undefined. */
export function checksOf(rollup: readonly RawCheck[] | null | undefined): { state?: ChecksState; count: number } {
  const checks = rollup ?? [];
  if (checks.length === 0) return { count: 0 };
  let pending = false;
  for (const check of checks) {
    // A check run has a status and a conclusion; a commit status just a state.
    const verdict = String(check.conclusion || check.state || "").toUpperCase();
    if (FAILED.has(verdict)) return { state: "failing", count: checks.length };
    if (!PASSED.has(verdict)) pending = true;
  }
  return { state: pending ? "pending" : "passing", count: checks.length };
}

function summary(raw: RawPull): PullSummary | undefined {
  if (typeof raw.number !== "number" || typeof raw.title !== "string") return undefined;
  const author = str(raw.author?.login);
  const updatedAt = str(raw.updatedAt);
  const url = str(raw.url);
  const decision = str(raw.reviewDecision);
  const headSha = str(raw.headRefOid);
  const checks = checksOf(raw.statusCheckRollup);
  return {
    number: raw.number,
    title: raw.title,
    headRef: str(raw.headRefName) ?? "",
    baseRef: str(raw.baseRefName) ?? "",
    draft: raw.isDraft === true,
    additions: count(raw.additions),
    deletions: count(raw.deletions),
    changedFiles: count(raw.changedFiles),
    checkCount: checks.count,
    labels: (raw.labels ?? []).map((label) => str(label?.name)).filter((name): name is string => Boolean(name)),
    ...(author ? { author } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(url ? { url } : {}),
    ...(decision ? { decision } : {}),
    ...(checks.state ? { checks: checks.state } : {}),
    ...(headSha ? { headSha } : {}),
  };
}

function parseJson<T>(stdout: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error("gh returned output bot-lobby could not read");
  }
}

export async function listPulls(exec: Exec, cwd: string, limit = PULL_LIMIT): Promise<PullSummary[]> {
  const stdout = await gh(exec, cwd, ["pr", "list", "--state", "open", "--limit", String(limit), "--json", LIST_FIELDS]);
  const raw = parseJson<RawPull[]>(stdout);
  return (Array.isArray(raw) ? raw : []).map(summary).filter((pull): pull is PullSummary => Boolean(pull));
}

export async function viewPull(exec: Exec, cwd: string, number: number): Promise<PullDetail> {
  const stdout = await gh(exec, cwd, ["pr", "view", String(number), "--json", VIEW_FIELDS]);
  const raw = parseJson<RawPull>(stdout);
  const base = summary(raw);
  if (!base) throw new Error(`gh returned no pull request #${number}`);
  const state = str(raw.state);
  const mergeable = str(raw.mergeable);
  type Loose = { author?: string | undefined; body: string; at?: string | undefined; state?: string | undefined };
  const notes: PullNote[] = ([
    ...(raw.reviews ?? []).map((review) => ({ author: str(review?.author?.login), body: typeof review?.body === "string" ? review.body : "", at: str(review?.submittedAt), state: str(review?.state) })),
    ...(raw.comments ?? []).map((comment) => ({ author: str(comment?.author?.login), body: typeof comment?.body === "string" ? comment.body : "", at: str(comment?.createdAt) })),
  ] as Loose[])
    // A review with a verdict but no words still says something; a bare comment does not.
    .filter((note) => note.body.trim() || (note.state && note.state !== "COMMENTED"))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
    .map(({ author, body, at, state: verdict }) => ({ body, ...(author ? { author } : {}), ...(at ? { at } : {}), ...(verdict ? { state: verdict } : {}) }));
  return {
    ...base,
    body: typeof raw.body === "string" ? raw.body : "",
    ...(state ? { state } : {}),
    ...(mergeable ? { mergeable } : {}),
    files: (raw.files ?? []).flatMap((file) => (typeof file?.path === "string" ? [{ path: file.path, additions: count(file.additions), deletions: count(file.deletions) }] : [])),
    notes,
  };
}

/** The pull request's diff as `gh` prints it, bounded. */
export async function pullDiff(exec: Exec, cwd: string, number: number, limit = DIFF_CHARS): Promise<string> {
  const stdout = await gh(exec, cwd, ["pr", "diff", String(number), "--color", "never"]);
  return stdout.length > limit ? `${stdout.slice(0, limit)}\n[…the diff continues: ${stdout.length - limit} more characters]` : stdout;
}

/** Lobby state for the Git tab: the list, the open pull request, and what is loading. */
export class PullsState {
  pulls: PullSummary[] = [];
  details = new Map<number, PullDetail>();
  loading = false;
  loaded = false;
  error?: string;
  private readonly exec: Exec;
  private readonly cwd: string;
  private readonly onChange: () => void;

  constructor(exec: Exec, cwd: string, onChange: () => void = () => {}) {
    this.exec = exec;
    this.cwd = cwd;
    this.onChange = onChange;
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.error = undefined;
    this.onChange();
    try {
      this.pulls = await listPulls(this.exec, this.cwd);
      this.loaded = true;
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
      this.onChange();
    }
  }

  /** The pull request with its files and discussion; cached until the list is reloaded. */
  async detail(number: number): Promise<PullDetail | undefined> {
    const cached = this.details.get(number);
    if (cached) return cached;
    try {
      const detail = await viewPull(this.exec, this.cwd, number);
      this.details.set(number, detail);
      this.error = undefined;
      this.onChange();
      return detail;
    } catch (error) {
      this.error = (error as Error).message;
      this.onChange();
      return undefined;
    }
  }

  /** Forget what was read, so the next look asks `gh` again. */
  forget(): void {
    this.details.clear();
  }
}
