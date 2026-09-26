/**
 * The file desk inside a parallel worker's pi process. Registered only when
 * bot-lobby runs as a subagent with a desk address in its environment: it
 * refuses `edit`/`write` on files the worker has not checked out, and gives
 * the worker the tools to claim, hand over and wait for files.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createDeskClient, type DeskClient } from "./ipc.ts";
import { DESK_ENV, isEditTool, MAX_WAIT_MS } from "./session.ts";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

function editPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const path = record.path ?? record.file_path;
  return typeof path === "string" ? path : undefined;
}

/** True when this process is a worker in a parallel batch. */
export function deskAddress(env: NodeJS.ProcessEnv = process.env): { address: string; worker: string } | undefined {
  const address = env[DESK_ENV.address];
  const worker = env[DESK_ENV.worker];
  return address && worker ? { address, worker } : undefined;
}

export function registerDeskClient(pi: ExtensionAPI, client?: DeskClient): void {
  const target = deskAddress();
  if (!target && !client) return;
  const desk = client ?? createDeskClient(target!.address, target!.worker);

  pi.on("session_start", () => {
    void desk.request({ op: "hello" });
  });
  pi.on("session_shutdown", () => desk.close());

  pi.on("tool_call", async (event) => {
    if (!isEditTool(event.toolName)) return undefined;
    const path = editPath(event.input);
    if (!path) return undefined;
    const answer = await desk.request({ op: "check", path });
    // If the desk is gone the batch is over; never wedge the worker on it.
    if (!answer.ok || answer.allowed) return undefined;
    return { block: true, reason: answer.text };
  });

  pi.registerTool({
    name: "claim_file",
    label: "Claim file",
    description:
      "Check a repository file out from the file desk before editing it. Give the path and a one-line intent (what you are about to change). A free file is yours at once; a busy one queues you behind its holder, who is told your intent.",
    parameters: Type.Object({
      path: Type.String({ description: "File path, relative to the repository root" }),
      intent: Type.String({ description: "One line: what you will change in this file" }),
    }),
    async execute(_id, params) {
      return text((await desk.request({ op: "claim", path: params.path, intent: params.intent })).text);
    },
  });

  pi.registerTool({
    name: "handover_file",
    label: "Hand over file",
    description:
      "Release a file you hold to the next worker in its queue. Write the note for their stated intent: what you changed, what to build on, and what to watch out for.",
    parameters: Type.Object({
      path: Type.String({ description: "File path you hold" }),
      note: Type.String({ description: "Handover note for the next worker" }),
    }),
    async execute(_id, params) {
      return text((await desk.request({ op: "handover", path: params.path, note: params.note })).text);
    },
  });

  pi.registerTool({
    name: "my_files",
    label: "My files",
    description: "List the files you hold (with who is queued behind you and why) and the files you are queued for.",
    parameters: Type.Object({}),
    async execute() {
      return text((await desk.request({ op: "mine" })).text);
    },
  });

  pi.registerTool({
    name: "wait_for_files",
    label: "Wait for files",
    description:
      "Wait until a file you are queued for is handed to you (up to 2 minutes). Use only when nothing else is left to do; hand over files others wait for first.",
    parameters: Type.Object({
      seconds: Type.Optional(Type.Number({ description: "How long to wait, at most 120 seconds" })),
    }),
    async execute(_id, params) {
      const timeoutMs = Math.min(MAX_WAIT_MS, Math.max(1, params.seconds ?? 120) * 1000);
      return text((await desk.request({ op: "wait", timeoutMs }, timeoutMs + 5000)).text);
    },
  });
}
