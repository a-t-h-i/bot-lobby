/**
 * The Plan tab over HTTP: reading the planning session, starting a new one,
 * sending a message, seating members, retrying, commenting on a draft line,
 * answering the round's questions and saving the draft. Actions answer with
 * the same notice text the terminal shows.
 */
import { MEMBER_LABELS, type PlannerMessage } from "../../lobby/planner.ts";
import type { PanelMember } from "../../schemas/configuration.ts";
import type { PlannerSnapshot } from "../protocol.ts";
import type { ApiContext } from "./index.ts";
import { withAttachments } from "../uploads.ts";
import { fail } from "./index.ts";

/** The planning session as the page reads it; absent means no session yet. */
export function plannerGet(ctx: ApiContext): PlannerSnapshot {
  const session = ctx.service.planner();
  if (!session) {
    return {
      seats: [...ctx.service.defaultPanel()],
      members: [],
      messages: [],
      questions: [],
      notes: [],
      round: 0,
      limit: ctx.service.planningRounds?.() ?? 0,
      retryable: false,
      busy: false,
    };
  }
  return {
    seats: [...session.seats],
    members: session.members.map((member) => ({ ...member })),
    messages: session.messages.map((message) => ({ ...message })),
    ...(session.reply?.plan ? { draft: session.reply.plan } : {}),
    questions: session.questions.map((question) => ({ ...question })),
    notes: session.notes.map((note) => ({ ...note })),
    round: session.turns,
    limit: ctx.service.planningRounds?.() ?? 0,
    retryable: session.retryable,
    busy: session.busy,
  };
}

/** Start over with a fresh planning session, from an issue or nothing. */
export function plannerNew(body: { seed?: { issue: { number: number; title: string; url?: string }; body: string }; seats?: PanelMember[] }, ctx: ApiContext): { notice: string } {
  ctx.service.newPlanner(body.seed, body.seats);
  return { notice: "new planning session — describe the task to plan" };
}

/** Send a message to the panel; the round runs in the background. */
export function plannerSend(body: { text: string; attachments?: string[] }, ctx: ApiContext): { notice: string } {
  if (!body.text.trim() && !body.attachments?.length) fail(400, "bad_request", "describe the task to plan");
  const text = withAttachments(body.text, body.attachments, undefined, ctx.service.projectRoot?.());
  const session = ctx.service.planner() ?? ctx.service.newPlanner(undefined, [...ctx.service.defaultPanel()]);
  if (session!.busy) fail(409, "conflict", "the panel is still thinking — wait for the round to finish");
  session!.send(text).catch(() => {});
  return { notice: "sent — the panel is on the next round" };
}

/** Correct a user turn synchronously, then revise the plan in the background. */
export function plannerEditMessage(body: { messageIndex: number; at: number; text: string }, ctx: ApiContext): { message: PlannerMessage; notice: string } {
  const session = ctx.service.planner();
  if (!session) fail(404, "not_found", "no planning session");
  const message = session.messages[body.messageIndex];
  if (session.busy) fail(409, "conflict", "the panel is still thinking — wait for the round to finish");
  if (!message || message.at !== body.at) fail(409, "conflict", "the message has changed — refresh the conversation");
  if (message.role !== "you" || message.settled?.length) fail(403, "forbidden", "only ordinary user messages can be edited");
  if (!body.text.trim()) fail(400, "bad_request", "an edited message needs some text");
  session.editMessage(body.messageIndex, body.at, body.text).catch(() => {});
  return { message: structuredClone(session.messages[body.messageIndex]!), notice: "message edited — the panel revises the plan" };
}

/** Seat or unseat a member for the next round. */
export function plannerToggleSeat(body: { member: PanelMember }, ctx: ApiContext): { notice: string; seated: boolean } {
  const session = ctx.service.planner() ?? ctx.service.newPlanner(undefined, [...ctx.service.defaultPanel()]);
  const seated = session!.toggle(body.member);
  return { notice: `${MEMBER_LABELS[body.member]} ${seated ? "joins the panel from the next round and sits every round" : "leaves the panel from the next round"}`, seated };
}

/** Run the last round again; a quiet round has nothing to redo. */
export function plannerRetry(ctx: ApiContext): { notice: string } {
  const session = ctx.service.planner();
  if (!session) fail(404, "not_found", "no planning session");
  if (!session!.retryable) return { notice: "nothing to retry" };
  void session!.retry();
  return { notice: "retrying the round…" };
}

/** Comment on one line of the draft; it rides with the answers or starts a round. */
export function plannerCommentLine(body: { line: string; text: string }, ctx: ApiContext): { notice: string } {
  if (!body.line.trim() || !body.text.trim()) fail(400, "bad_request", "a draft line and a comment are required");
  const session = ctx.service.planner();
  if (!session?.reply?.plan) fail(409, "conflict", "there is no draft to comment on yet");
  const sent = session!.commentOnLine(body.line, body.text);
  if (sent) return { notice: "comment sent — the panel revises the draft" };
  if (session!.busy) return { notice: "comment kept — it goes to the panel after this round" };
  return { notice: "comment kept — it goes with your answers (a answers the questions)" };
}

/** The oracle puts the round's questions to the user through the questionnaire. */
export async function plannerAnswer(ctx: ApiContext): Promise<{ notice: string }> {
  const session = ctx.service.planner();
  if (!session) fail(404, "not_found", "no planning session");
  if (!session!.awaitingAnswers) return { notice: session!.busy ? "the panel is still thinking" : "no open questions" };
  return { notice: await ctx.service.answerPanel() };
}

/** Save the draft as a pending task; a long plan is first offered a split. */
export async function plannerSave(ctx: ApiContext): Promise<{ notice: string }> {
  const session = ctx.service.planner();
  if (!session?.reply?.plan) fail(409, "conflict", "no plan to save yet — describe a task in the Plan tab");
  return { notice: await ctx.service.savePlan() };
}
