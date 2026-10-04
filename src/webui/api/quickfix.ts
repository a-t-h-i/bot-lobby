/**
 * The Quick fix tab over HTTP: the job list newest first, submitting a new
 * job, cancelling one, running a held one anyway, and moving a held one to a
 * task in a new session. Actions answer with the same notice text the
 * terminal shows.
 */
import type { ApiContext } from "./index.ts";
import { withAttachments } from "../uploads.ts";
import { fail } from "./index.ts";
import type { QuickFixJob } from "../../lobby/quickfix.ts";

/** Every job, newest first like the terminal shows them. */
export function quickfixList(ctx: ApiContext): { jobs: QuickFixJob[] } {
  return { jobs: [...ctx.service.quickfix.jobs].reverse() };
}

/** Queue a quick fix; it starts at once when nothing else is running. */
export function quickfixSubmit(body: { text: string; attachments?: string[] }, ctx: ApiContext): { notice: string; id: string } {
  if (!body.text.trim() && !body.attachments?.length) fail(400, "bad_request", "describe a quick change first");
  const job = ctx.service.quickfix.submit(withAttachments(body.text, body.attachments, undefined, ctx.service.projectRoot?.()));
  return { notice: ctx.service.quickfix.running?.id === job.id ? `${job.id} started` : `${job.id} queued behind the running quick fix`, id: job.id };
}

/** Cancel a queued or running job; finished jobs are left alone. */
export function quickfixCancel(body: { id: string }, ctx: ApiContext): { notice: string } {
  const job = ctx.service.quickfix.jobs.find((entry) => entry.id === body.id);
  if (!job) fail(404, "not_found", `no quick fix ${body.id}`);
  if (!ctx.service.quickfix.cancel(body.id)) fail(409, "conflict", `${body.id} already ${job!.status}`);
  return { notice: `cancelling ${body.id}` };
}

/** Run a held job anyway: it goes back in the queue and is not sized again. */
export function quickfixRunAnyway(body: { id: string }, ctx: ApiContext): { notice: string } {
  const job = ctx.service.quickfix.jobs.find((entry) => entry.id === body.id);
  if (!job) fail(404, "not_found", `no quick fix ${body.id}`);
  if (!ctx.service.quickfix.runAnyway(body.id)) fail(409, "conflict", `only a held job runs anyway — ${body.id} is ${job!.status}`);
  return { notice: `running ${body.id} anyway` };
}

/** A held job that became a task: it starts in a new session and leaves the queue. */
export function quickfixMovedToTask(body: { id: string }, ctx: ApiContext): { notice: string; key?: string } {
  const job = ctx.service.quickfix.jobs.find((entry) => entry.id === body.id);
  if (!job) fail(404, "not_found", `no quick fix ${body.id}`);
  if (job!.status !== "held") fail(409, "conflict", `only a held job moves to a task — ${body.id} is ${job!.status}`);
  const session = ctx.service.startSession({ request: job!.prompt });
  ctx.service.quickfix.movedToTask(body.id);
  if (typeof session === "string") return { notice: session };
  return { notice: `started ${session.name} in a new session`, key: session.key };
}
