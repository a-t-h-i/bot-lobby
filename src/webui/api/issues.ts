/**
 * The Issues tab over HTTP: the open issues, one issue with its comments, and
 * filing a new one, all through the lobby's `IssuesState` (so `gh` owns
 * authentication and the repository). With `lobby.issues` off every call is
 * a 404, like the tab being absent from the terminal.
 */
import type { IssueDetailInfo, IssueInfo, IssuesList } from "../protocol.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";
import { ghRefusal } from "./gh-error.ts";

function requireIssues(ctx: ApiContext): void {
  if (!ctx.service.issuesEnabled()) fail(404, "not_found", "issues are off (lobby.issues)");
}

function issueInfo(issue: IssueInfo): IssueInfo {
  return { ...issue, labels: [...issue.labels] };
}

/** The open issues; read from `gh` the first time or when `refresh` asks (a failure is not retried until asked). */
export async function issuesList(body: { refresh?: boolean }, ctx: ApiContext): Promise<IssuesList> {
  requireIssues(ctx);
  const state = ctx.service.issues;
  if (body.refresh || (!state.loaded && !state.error)) {
    state.details.clear();
    await state.refresh();
  }
  return { issues: state.issues.map(issueInfo), loading: state.loading, loaded: state.loaded, ...(state.error ? { error: state.error } : {}) };
}

/** One issue with its description and comments. */
export async function issuesGet(body: { number: number }, ctx: ApiContext): Promise<{ issue: IssueDetailInfo }> {
  requireIssues(ctx);
  const detail = await ctx.service.issues.detail(body.number);
  if (!detail) ghRefusal(ctx.service.issues.error, `issue #${body.number}`);
  const found = detail!;
  return { issue: { ...issueInfo(found), body: found.body, ...(found.state ? { state: found.state } : {}), comments: found.comments.map((comment) => ({ ...comment })) } };
}

/** File an issue: the first line is the title, the rest the body. */
export async function issuesCreate(body: { text: string }, ctx: ApiContext): Promise<{ notice: string }> {
  requireIssues(ctx);
  if (!body.text.trim()) return { notice: "type something first" };
  const state = ctx.service.issues;
  state.notice = undefined;
  state.error = undefined;
  await state.create(body.text);
  if (!state.notice) fail(500, "failed", state.error ?? "could not file the issue");
  return { notice: state.notice! };
}
