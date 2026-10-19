/**
 * The task board inside a worker's pi process: `post_board` adds a typed post
 * (through the desk when one runs, so peers hear about contracts and
 * blockers at once; straight to the board's file otherwise) and `read_board`
 * reads what the task's agents posted, filtered to the reader's role.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createDeskClient, type DeskClient } from "./ipc.ts";
import { appendPost, BOARD_ENV, filterPosts, formatPosts, isPostKind, POST_KINDS, readBoard, subscriptionFor, type PostKind } from "./board.ts";
import { deskAddress } from "./client-extension.ts";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
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
      "Post a short, typed entry on the task board that every agent on this task can read: `contract` (an interface others build against: a route, a payload shape, a type, an event name), `decision` (a choice others should follow), `blocker` (something stopping you that someone else must change), `question` (open, for the oracle), `done` (a piece is finished and ready to test), `note`. Contracts and blockers reach the other running workers at once. Post facts, not progress chatter.",
    parameters: Type.Object({
      kind: Type.Union(POST_KINDS.map((kind) => Type.Literal(kind))),
      text: Type.String({ description: "The post: the exact facts, at most a short paragraph" }),
      files: Type.Optional(Type.Array(Type.String(), { description: "Files the post is about" })),
    }),
    async execute(_id, params) {
      if (desk) {
        const answer = await desk.request({ op: "post", from: self, kind: params.kind, text: params.text, files: params.files ?? [] });
        // Only a desk without the board, or one never reached, leaves the post to the file below; any other answer may follow a write.
        if (answer.ok || !/^This task has no board\.$|^the file desk is unavailable$/.test(answer.text)) return text(answer.text);
      }
      try {
        const post = appendPost(path, { from: self, kind: params.kind, text: params.text, ...(params.files ? { files: params.files } : {}) });
        return text(`Posted #${post.seq}.`);
      } catch (error) {
        return text(`Not posted: ${(error as Error).message}`);
      }
    },
  });

  pi.registerTool({
    name: "read_board",
    label: "Read the task board",
    description: "Read the task board. By default you see the kinds your role follows, newest last; pass kinds to see others, or after to see only posts newer than one you have read.",
    parameters: Type.Object({
      kinds: Type.Optional(Type.Array(Type.String(), { description: `Any of: ${POST_KINDS.join(", ")}` })),
      after: Type.Optional(Type.Number({ description: "Only posts after this number" })),
    }),
    async execute(_id, params) {
      const kinds: readonly PostKind[] = params.kinds?.filter(isPostKind).length ? params.kinds.filter(isPostKind) : subscriptionFor(self);
      const posts = filterPosts(readBoard(path), { kinds, ...(params.after ? { after: params.after } : {}), limit: 50 });
      return text(posts.length > 0 ? formatPosts(posts) : "Nothing on the board for those kinds yet.");
    },
  });
}
