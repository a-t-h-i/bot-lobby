/**
 * The task board inside a worker's pi process: `post_board` adds a typed post
 * (through the desk when one runs, so peers hear about contracts and
 * blockers at once; straight to the board's file otherwise), `read_board`
 * reads what the task's agents posted, filtered to the reader's role, and
 * `ack_board` records the events the worker actually incorporated — reading
 * alone proves receipt, not incorporation.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createDeskClient, type DeskClient } from "./ipc.ts";
import { appendPost, BOARD_ENV, formatPosts, isPostKind, POST_KINDS, recentPost, readBoard, subscriptionFor, type BoardPost, type PostKind } from "./board.ts";
import { ackRelevant, deliveryPath, markDelivered, markHandled, markSeen, provenThrough, readDelivery } from "./delivery.ts";
import { deskAddress } from "./client-extension.ts";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

/**
 * A read proves receipt of what its window showed: the delivered cursor grows
 * only over the posts relevant to the reader that the window included — it
 * stops at the first one the window omitted — and shown posts beyond that are
 * recorded out of order. Posts routed only by files wait for the desk that
 * knows the claims. Nothing is marked handled: receipt is not incorporation.
 */
function recordRead(path: string, self: string, kinds: readonly PostKind[], shownPosts: readonly BoardPost[]): void {
  const statePath = deliveryPath(path);
  const prior = readDelivery(statePath).recipients[self]?.lastSeq ?? 0;
  const shown = new Set(shownPosts.map((post) => post.seq));
  const through = provenThrough(readBoard(path), shown, (post) => ackRelevant(post, self, kinds), prior);
  if (through > prior) markDelivered(statePath, self, through);
  for (const post of shownPosts) if (post.seq > through) markSeen(statePath, self, post.seq);
}

export function registerBoardClient(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, client?: DeskClient): void {
  const path = env[BOARD_ENV];
  if (!path) return;
  const target = deskAddress(env);
  const desk = client ?? (target ? createDeskClient(target.address, target.worker) : undefined);
  // Posts and subscriptions follow the worker's domain; a desk id is only the fallback.
  const self = env.BOT_LOBBY_BOARD_FROM ?? target?.worker ?? "worker";
  if (desk) pi.on("session_shutdown", () => desk.close());

  pi.registerTool({
    name: "post_board",
    label: "Post to the task board",
    description:
      "Post a short, typed entry on the task board that every agent on this task can read: `contract` (an interface others build against: a route, a payload shape, a type, an event name, file location), `decision` (a choice others should follow), `blocker` (something stopping you that someone else must change), `question` (open, for the oracle), `done` (a piece is finished and ready to test), `note`. Unaddressed contracts and blockers reach the other running workers at once; `to` (worker ids: backend, designer, qa, a child id) or `files` narrows who is pushed it. Post facts, not progress chatter.",
    parameters: Type.Object({
      kind: Type.Union(POST_KINDS.map((kind) => Type.Literal(kind))),
      text: Type.String({ description: "The post: the exact facts, at most a short paragraph" }),
      files: Type.Optional(Type.Array(Type.String(), { description: "Files the post is about; pushed to the workers holding them" })),
      to: Type.Optional(Type.Array(Type.String(), { description: "Recipients the post is addressed to: a domain (`backend`) reaches every worker of that role, an assignment id (`backend:9f2c1e`) that worker alone; pushed only to them" })),
    }),
    async execute(_id, params) {
      const post = { from: self, kind: params.kind, text: params.text, ...(params.files ? { files: params.files } : {}), ...(params.to ? { to: params.to } : {}) };
      if (desk) {
        let answer: { ok: boolean; text: string } | undefined;
        try {
          answer = await desk.request({ op: "post", from: self, kind: params.kind, text: params.text, files: params.files ?? [], targets: params.to ?? [] });
        } catch {
          // The request failed mid-flight; the post may already be on the board, so a retry must not duplicate it.
        }
        if (answer) {
          // Only a desk without the board, or one never reached, leaves the post to the file below; any other answer may follow a write.
          if (answer.ok || !/^This task has no board\.$|^the file desk is unavailable$/.test(answer.text)) return text(answer.text);
        } else {
          const landed = recentPost(path, self, params.kind, params.text);
          if (landed) return text(`Posted #${landed.seq} (already on the board).`);
        }
      }
      try {
        const stored = appendPost(path, post);
        return text(`Posted #${stored.seq}.`);
      } catch (error) {
        return text(`Not posted: ${(error as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "read_board",
    label: "Read the task board",
    description: "Read the task board. By default you see the kinds your role follows, newest last; pass kinds to see others, or after to see only posts newer than one you have read. Reading is receipt only: acknowledge what you incorporate with ack_board.",
    parameters: Type.Object({
      kinds: Type.Optional(Type.Array(Type.String(), { description: `Any of: ${POST_KINDS.join(", ")}` })),
      after: Type.Optional(Type.Number({ description: "Only posts after this number" })),
    }),
    async execute(_id, params) {
      const kinds: readonly PostKind[] = params.kinds?.filter(isPostKind).length ? params.kinds.filter(isPostKind) : subscriptionFor(self);
      const matching = readBoard(path)
        .filter((post) => kinds.includes(post.kind) && (!params.after || post.seq > params.after))
        .sort((a, b) => a.seq - b.seq);
      const posts = matching.slice(-50);
      if (posts.length > 0) recordRead(path, self, kinds, posts);
      return text(posts.length > 0 ? formatPosts(posts) : "Nothing on the board for those kinds yet.");
    },
  });

  pi.registerTool({
    name: "ack_board",
    label: "Acknowledge board events",
    description:
      "Acknowledge the board events you have actually incorporated into your work: the numbers shown as `#3` (or the posts' ids). Receipt is not acknowledgement — reading or being steered a post does not count; only this does. Out-of-order acknowledgements are kept, and events relevant to you that you have not acknowledged yet stay pending.",
    parameters: Type.Object({
      events: Type.Array(Type.Union([Type.String(), Type.Number()]), { description: "The events: `#3`-style numbers, plain numbers, or post ids" }),
    }),
    async execute(_id, params) {
      if (desk) {
        let answer: { ok: boolean; text: string } | undefined;
        try {
          answer = await desk.request({ op: "ack", events: params.events });
        } catch {
          // Fall through to the file: acknowledging is idempotent, so a retry cannot double-record.
        }
        if (answer && (answer.ok || !/^the file desk is unavailable$|^the file desk closed$/.test(answer.text))) return text(answer.text);
      }
      return text(ackText(markHandled(path, self, params.events)));
    },
  });
}

/** The worker-facing result of one acknowledgement, whether anything was recorded or not. */
export function ackText(result: { acknowledged: { seq: number }[]; unknown: string[]; refused: string[]; state: { handled?: number[] } }): string {
  if (result.refused.length > 0) return `Not acknowledged: ${result.refused.join(", ")} ${result.refused.length === 1 ? "is" : "are"} outside what your role follows. Nothing was recorded.`;
  const parts = [`Acknowledged ${result.acknowledged.map((post) => `#${post.seq}`).join(", ")}.`];
  if (result.unknown.length > 0) parts.push(`No board event matches: ${result.unknown.join(", ")}.`);
  const pending = result.state.handled ?? [];
  if (pending.length > 0) parts.push(`${pending.length} earlier event${pending.length === 1 ? "" : "s"} you have not acknowledged still hold${pending.length === 1 ? "s" : ""} your acknowledgement cursor.`);
  return parts.join(" ");
}
