/**
 * The Git tab over HTTP: the open pull requests with their checks, size and
 * review marks; one pull request with its files and discussion, our review
 * and Jev's read; starting and stopping a review; asking Jev. Everything goes
 * through the lobby's `PullsState` and `PullReviews`, so the terminal and the
 * page see one set of reviews. Nothing is ever posted to GitHub.
 *
 * Only types come from `src/lobby/pulls.ts` and `pr-review.ts` (erased at
 * compile time): the review module loads the agent runner, and the server
 * needs none of it.
 */
import type { PullDetail, PullSummary } from "../../lobby/pulls.ts";
import type { PullReadState, PullReview } from "../../lobby/pr-review.ts";
import type { GitPull, GitPulls, PullInfo, PullReadInfo, PullReviewInfo, PullReviewMark } from "../protocol.ts";
import type { ApiContext } from "./index.ts";
import { ghRefusal } from "./gh-error.ts";

/** The pull request has commits the review did not see (mirrors `isStale`). */
function staleOf(review: PullReview, headSha: string | undefined): boolean {
  return Boolean(review.headSha && headSha && review.headSha !== headSha);
}

function markOf(review: PullReview | undefined, headSha: string | undefined): PullReviewMark | undefined {
  if (!review) return undefined;
  return { status: review.status, ...(review.verdict ? { verdict: review.verdict } : {}), stale: staleOf(review, headSha) };
}

function pullInfo(pull: PullSummary, review: PullReview | undefined): PullInfo {
  const { headSha, ...rest } = pull;
  const mark = markOf(review, headSha);
  return { ...rest, labels: [...rest.labels], ...(mark ? { review: mark } : {}) };
}

function reviewInfo(review: PullReview, headSha: string | undefined): PullReviewInfo {
  const { headSha: _seen, ...rest } = review;
  return { ...rest, steps: [...rest.steps], stale: staleOf(review, headSha) };
}

function readInfo(state: PullReadState): PullReadInfo {
  return { ...state, ...(state.read ? { read: { ...state.read } } : {}) };
}

/** The open pull requests; read from `gh` the first time or when `refresh` asks (a failure is not retried until asked). */
export async function gitPulls(body: { refresh?: boolean }, ctx: ApiContext): Promise<GitPulls> {
  const state = ctx.service.pulls;
  if (body.refresh || (!state.loaded && !state.error)) {
    state.forget();
    await state.refresh();
  }
  const pulls = state.pulls.map((pull) => pullInfo(pull, ctx.service.reviews.review(pull.number)));
  return { pulls, loading: state.loading, loaded: state.loaded, ...(state.error ? { error: state.error } : {}) };
}

/** One pull request with its files, description, reviews and comments, our review and Jev's read. */
export async function gitPull(body: { number: number }, ctx: ApiContext): Promise<GitPull> {
  const detail: PullDetail | undefined = await ctx.service.pulls.detail(body.number);
  if (!detail) ghRefusal(ctx.service.pulls.error, `#${body.number}`);
  const { body: text, state, mergeable, files, notes, ...summary } = detail!;
  const review = ctx.service.reviews.review(body.number);
  const read = ctx.service.reviews.reads.get(body.number);
  return {
    pull: {
      ...pullInfo(summary, review),
      body: text,
      ...(state ? { state } : {}),
      ...(mergeable ? { mergeable } : {}),
      files: files.map((file) => ({ ...file })),
      notes: notes.map((note) => ({ ...note })),
    },
    ...(review ? { review: reviewInfo(review, detail!.headSha) } : {}),
    ...(read ? { read: readInfo(read) } : {}),
  };
}

/** Start a review by a read-only agent; it runs on, streaming into the activity log. */
export function gitReview(body: { number: number; focus?: string }, ctx: ApiContext): { notice: string } {
  const { reviews, pulls } = ctx.service;
  const number = body.number;
  if (reviews.running(number)) return { notice: `already reviewing #${number}` };
  const focus = body.focus?.trim();
  const detail = pulls.details.get(number);
  reviews.start(number, { ...(focus ? { focus } : {}), ...(detail ? { detail } : {}) }).catch(() => undefined);
  return { notice: `reviewing #${number}${focus ? ` — looking at: ${focus.length > 40 ? `${focus.slice(0, 39)}…` : focus}` : ""} — it streams into the activity log` };
}

/** Stop a running review. */
export function gitCancelReview(body: { number: number }, ctx: ApiContext): { notice: string } {
  const stopped = ctx.service.reviews.cancel(body.number);
  return { notice: stopped ? `stopping the review of #${body.number}` : `no review of #${body.number} is running` };
}

/** Ask Jev for a quick read; the answer arrives with `git.pull`. */
export function gitJev(body: { number: number }, ctx: ApiContext): { notice: string } {
  const { reviews, pulls } = ctx.service;
  if (reviews.reads.get(body.number)?.status === "running") return { notice: `Jev is already reading #${body.number}` };
  reviews.readWithJev(body.number, pulls.details.get(body.number)).catch(() => undefined);
  return { notice: `asking Jev to read #${body.number}…` };
}
