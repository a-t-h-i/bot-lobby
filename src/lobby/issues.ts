/**
 * GitHub issues through the `gh` CLI: list the repository's open issues, read
 * one with its comments, and file a new one. `gh` owns authentication and repo
 * detection, so bot-lobby holds no token; every failure becomes one readable
 * line (not installed, not signed in, not a GitHub repository).
 */
import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs a command without a shell; `execCommand` in the extension, a fake in tests. */
export type Exec = (command: string, args: string[], options?: { cwd?: string; timeout?: number }) => Promise<ExecResult>;

/**
 * `execFile` as an `Exec`: a non-zero exit resolves with its code and output,
 * while a missing binary rejects with the spawn error (`ENOENT`), so the tab
 * can say "gh is not installed" rather than "exited with code 1".
 */
export const execCommand: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && typeof (error as NodeJS.ErrnoException).code === "string") return reject(error);
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

export interface IssueSummary {
  number: number;
  title: string;
  labels: string[];
  author?: string;
  updatedAt?: string;
  url?: string;
}

export interface IssueComment {
  author?: string;
  body: string;
  createdAt?: string;
}

export interface IssueDetail extends IssueSummary {
  body: string;
  state?: string;
  comments: IssueComment[];
}

const TIMEOUT_MS = 20_000;
export const LIST_LIMIT = 50;

/** One readable line for a failed `gh` call. */
export function ghError(result: Partial<ExecResult> & { error?: string }): string {
  const text = `${result.error ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.code === 127 || /ENOENT|not found|command not found/i.test(text)) return "GitHub CLI (gh) is not installed — install it from https://cli.github.com and run `gh auth login`.";
  if (/auth login|not logged|authentication|GH_TOKEN/i.test(text)) return "gh is not signed in — run `gh auth login` in a terminal.";
  if (/not a git repository|no git remotes|could not determine|none of the git remotes/i.test(text)) return "This project has no GitHub remote gh can use.";
  const first = text.split("\n").find((line) => line.trim()) ?? `gh exited with code ${result.code ?? "?"}`;
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

async function gh(exec: Exec, cwd: string, args: string[]): Promise<string> {
  let result: ExecResult;
  try {
    result = await exec("gh", args, { cwd, timeout: TIMEOUT_MS });
  } catch (error) {
    throw new Error(ghError({ error: (error as Error).message }));
  }
  if (result.code !== 0) throw new Error(ghError(result));
  return result.stdout;
}

interface RawIssue {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  url?: unknown;
  updatedAt?: unknown;
  author?: { login?: unknown } | null;
  labels?: Array<{ name?: unknown }> | null;
  comments?: Array<{ author?: { login?: unknown } | null; body?: unknown; createdAt?: unknown }> | null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summary(raw: RawIssue): IssueSummary | undefined {
  if (typeof raw.number !== "number" || typeof raw.title !== "string") return undefined;
  const author = str(raw.author?.login);
  const updatedAt = str(raw.updatedAt);
  const url = str(raw.url);
  return {
    number: raw.number,
    title: raw.title,
    labels: (raw.labels ?? []).map((label) => str(label?.name)).filter((name): name is string => Boolean(name)),
    ...(author ? { author } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(url ? { url } : {}),
  };
}

function parseJson<T>(stdout: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error("gh returned output bot-lobby could not read");
  }
}

export async function listIssues(exec: Exec, cwd: string, limit = LIST_LIMIT): Promise<IssueSummary[]> {
  const stdout = await gh(exec, cwd, ["issue", "list", "--state", "open", "--limit", String(limit), "--json", "number,title,labels,author,updatedAt,url"]);
  const raw = parseJson<RawIssue[]>(stdout);
  return (Array.isArray(raw) ? raw : []).map(summary).filter((issue): issue is IssueSummary => Boolean(issue));
}

export async function viewIssue(exec: Exec, cwd: string, number: number): Promise<IssueDetail> {
  const stdout = await gh(exec, cwd, ["issue", "view", String(number), "--json", "number,title,body,state,labels,author,url,updatedAt,comments"]);
  const raw = parseJson<RawIssue>(stdout);
  const base = summary(raw);
  if (!base) throw new Error(`gh returned no issue #${number}`);
  const state = str(raw.state);
  return {
    ...base,
    body: typeof raw.body === "string" ? raw.body : "",
    ...(state ? { state } : {}),
    comments: (raw.comments ?? []).map((comment) => {
      const author = str(comment?.author?.login);
      const createdAt = str(comment?.createdAt);
      return { body: typeof comment?.body === "string" ? comment.body : "", ...(author ? { author } : {}), ...(createdAt ? { createdAt } : {}) };
    }),
  };
}

/** First non-empty line is the title, the rest is the body. */
export function splitIssueText(text: string): { title: string; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return { title: "", body: "" };
  return { title: lines[first]!.trim().replace(/^#+\s*/, ""), body: lines.slice(first + 1).join("\n").trim() };
}

/** File an issue; returns its number and URL as `gh` prints it. */
export async function createIssue(exec: Exec, cwd: string, title: string, body: string): Promise<{ number?: number; url: string }> {
  if (!title.trim()) throw new Error("an issue needs a title (the first line)");
  const stdout = await gh(exec, cwd, ["issue", "create", "--title", title.trim(), "--body", body.trim() || " "]);
  const url = stdout.trim().split("\n").reverse().find((line) => /^https?:\/\//.test(line.trim()))?.trim() ?? stdout.trim();
  const number = Number(/\/issues\/(\d+)/.exec(url)?.[1]);
  return { url, ...(Number.isFinite(number) ? { number } : {}) };
}

/** The issue as text for the planner: body plus comments. */
export function issueText(issue: IssueDetail): string {
  const comments = issue.comments
    .filter((comment) => comment.body.trim())
    .map((comment) => `**${comment.author ?? "someone"}** commented:\n${comment.body.trim()}`);
  return [issue.body.trim() || "(no description)", ...comments].join("\n\n");
}

/** Lobby state for the Issues tab: the list, the open issue, and what is loading. */
export class IssuesState {
  issues: IssueSummary[] = [];
  details = new Map<number, IssueDetail>();
  loading = false;
  loaded = false;
  error?: string;
  notice?: string;
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
      this.issues = await listIssues(this.exec, this.cwd);
      this.loaded = true;
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
      this.onChange();
    }
  }

  async detail(number: number): Promise<IssueDetail | undefined> {
    const cached = this.details.get(number);
    if (cached) return cached;
    try {
      const detail = await viewIssue(this.exec, this.cwd, number);
      this.details.set(number, detail);
      this.onChange();
      return detail;
    } catch (error) {
      this.error = (error as Error).message;
      this.onChange();
      return undefined;
    }
  }

  async create(text: string): Promise<void> {
    const { title, body } = splitIssueText(text);
    try {
      const created = await createIssue(this.exec, this.cwd, title, body);
      this.notice = `created ${created.number ? `#${created.number}` : "issue"} — ${created.url}`;
      this.error = undefined;
      this.onChange();
      await this.refresh();
    } catch (error) {
      this.error = (error as Error).message;
      this.onChange();
    }
  }
}
