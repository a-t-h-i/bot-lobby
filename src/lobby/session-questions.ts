/**
 * A background session's questions, asked wherever the user is. A session
 * started "in a new session" runs headless, so every question it asks (its
 * oracle's questionnaire, a pick, a line of text, a yes/no) reaches this
 * window as an RPC dialog. Each one is put in this window's question queue,
 * the same pop-up the user's own session asks in, named after the session it
 * comes from, so nobody has to switch sessions to answer. The answer goes
 * back to the session; a dialog answered some other way (or a session that
 * ends) takes its question back out of the queue.
 */
import { readRelayRequest } from "../ask/relay.ts";
import { readResult } from "../ask/web.ts";
import { promptHub, type PromptHub } from "./prompt-hub.ts";
import type { DialogAnswer, SessionDialog } from "./sessions.ts";

export interface SessionQuestion {
  /** The session's name, shown as who asks. */
  from: string;
  dialog: SessionDialog;
  signal: AbortSignal;
}

/** Put a session's dialog to the user in the question pop-up; undefined when it was taken back first. */
export async function askForSession({ from, dialog, signal }: SessionQuestion, hub: PromptHub = promptHub): Promise<DialogAnswer | undefined> {
  const options = { signal };
  const relayed = dialog.method === "editor" ? readRelayRequest(dialog.title, dialog.prefill) : undefined;
  if (relayed) {
    const outcome = await hub.ask("questionnaire", from, { questions: relayed }, options);
    if (outcome.how === "cancelled") return undefined;
    const result = outcome.how === "answered" ? readResult(outcome.value) : undefined;
    return { value: JSON.stringify(result ?? { answers: [], cancelled: true }) };
  }
  if (dialog.method === "select") {
    const outcome = await hub.ask("choose", from, { title: dialog.title, options: dialog.options ?? [] }, options);
    return settled(outcome, (value) => (typeof value === "string" ? { value } : undefined));
  }
  if (dialog.method === "confirm") {
    const outcome = await hub.ask("confirm", from, { question: dialog.title, ...(dialog.message ? { detail: dialog.message } : {}) }, options);
    return settled(outcome, (value) => (typeof value === "boolean" ? { confirmed: value } : undefined));
  }
  const outcome = await hub.ask("text", from, { question: dialog.title, ...(dialog.placeholder ? { placeholder: dialog.placeholder } : {}) }, options);
  return settled(outcome, (value) => (typeof value === "string" ? { value } : undefined));
}

function settled(outcome: { how: "answered" | "dismissed" | "cancelled"; value: unknown }, read: (value: unknown) => DialogAnswer | undefined): DialogAnswer | undefined {
  if (outcome.how === "cancelled") return undefined;
  if (outcome.how === "dismissed") return { cancelled: true };
  return read(outcome.value) ?? { cancelled: true };
}
