/**
 * One parallel batch's file desk as the master sees it: the checkout table,
 * the socket the workers talk to, and the messages that keep every worker
 * informed. Queue changes and handovers reach the right worker as steering
 * messages over its RPC stdin, and the zen panel sees who is waiting.
 */
import { basename } from "node:path";
import type { AgentHandle } from "../execution/agent-runner.ts";
import { FileDesk, type Claim, type DeskEvent, type FileView, type Handover, type WorkerId } from "./desk.ts";
import { startDeskServer, type DeskRequest, type DeskResponse, type DeskServer } from "./ipc.ts";

/** Tools the desk adds to every parallel worker's allowlist. */
export const DESK_TOOLS: readonly string[] = ["claim_file", "handover_file", "my_files", "wait_for_files"];

/** Env names the desk client extension reads inside a worker process. */
export const DESK_ENV = { address: "BOT_LOBBY_DESK", worker: "BOT_LOBBY_DESK_ID" } as const;

/** Longest a single `wait_for_files` call may block. */
export const MAX_WAIT_MS = 120_000;

const EDIT_TOOLS = new Set(["edit", "write"]);

export function isEditTool(name: string): boolean {
  return EDIT_TOOLS.has(name);
}

function label(worker: WorkerId): string {
  const names: Record<string, string> = { backend: "DEV", designer: "DESIGN", qa: "QA" };
  return names[worker] ?? worker.toUpperCase();
}

function queueLines(queue: readonly Claim[]): string {
  return queue.map((claim, index) => `${index + 1}) ${label(claim.worker)} — ${claim.intent}`).join("; ");
}

/** Steering text for a holder whose queue changed. */
export function queueMessage(path: string, queue: readonly Claim[]): string {
  if (queue.length === 0) return `bot-lobby desk: nobody is waiting for \`${path}\` any more.`;
  const next = queue[0]!;
  return [
    `bot-lobby desk: queue for \`${path}\` (you hold it): ${queueLines(queue)}.`,
    `As soon as you are done with it, call handover_file with a short note for ${label(next.worker)}, who wants to: ${next.intent}.`,
  ].join(" ");
}

/** Steering text for a worker who just received a file. */
export function grantMessage(event: Extract<DeskEvent, { type: "granted" }>): string {
  const behind = event.queue.length > 0 ? ` Queued behind you: ${queueLines(event.queue)}; hand it over when you are done.` : "";
  return `bot-lobby desk: \`${event.path}\` is yours now (for: ${event.intent}). ${label(event.from)}'s handover note: ${event.note || "none"}. Re-read the file before editing it.${behind}`;
}

function describeHeld(files: readonly FileView[]): string {
  if (files.length === 0) return "You hold no files.";
  return files
    .map((file) => `You hold \`${file.path}\` (${file.holder.intent})${file.queue.length > 0 ? `; waiting: ${queueLines(file.queue)}` : "; nobody waiting"}.`)
    .join("\n");
}

export interface DeskSessionOptions {
  cwd: string;
  /** A worker that finished without handing a file over leaves this note for the next worker. */
  onHandover?: (handover: Handover) => void;
}

/** Master-side desk for one batch of parallel workers. */
export class DeskSession {
  readonly desk: FileDesk;
  private server?: DeskServer;
  private readonly handles = new Map<WorkerId, AgentHandle>();
  private readonly greeted = new Set<WorkerId>();
  private readonly options: DeskSessionOptions;

  constructor(options: DeskSessionOptions) {
    this.options = options;
    this.desk = new FileDesk(options.cwd, (event) => this.onEvent(event));
  }

  async open(): Promise<void> {
    this.server = await startDeskServer((request) => this.handle(request));
  }

  /** Environment that points one worker's pi process at this desk. */
  env(worker: WorkerId): Record<string, string> {
    if (!this.server) throw new Error("desk is not open");
    return { [DESK_ENV.address]: this.server.address, [DESK_ENV.worker]: worker };
  }

  /** Remember the running attempt's handle so the desk can steer it. */
  attach(worker: WorkerId, handle: AgentHandle): void {
    this.handles.set(worker, handle);
  }

  /** True once the worker's desk extension has checked in. */
  greetedBy(worker: WorkerId): boolean {
    return this.greeted.has(worker);
  }

  /** End of one attempt: hand everything it held to whoever is next, with `note` for them. */
  release(worker: WorkerId, note: (path: string, next: Claim) => string): void {
    this.handles.get(worker)?.annotate({ waitingFor: undefined });
    this.handles.delete(worker);
    for (const handover of this.desk.release(worker, note)) this.options.onHandover?.(handover);
  }

  handovers(): Handover[] {
    return this.desk.handovers();
  }

  async close(): Promise<void> {
    this.desk.close();
    await this.server?.close();
    this.server = undefined;
  }

  private steer(worker: WorkerId, text: string): void {
    this.handles.get(worker)?.steer(text);
  }

  private onEvent(event: DeskEvent): void {
    if (event.type === "queue") {
      this.steer(event.to, queueMessage(event.path, event.queue));
      return;
    }
    if (event.type === "queued") {
      this.handles.get(event.worker)?.annotate({ note: `queued for ${basename(event.path)} behind ${label(event.holder)}`, noteKind: "info" });
      return;
    }
    this.steer(event.to, grantMessage(event));
    this.handles.get(event.to)?.annotate({ note: `got ${basename(event.path)} from ${label(event.from)}`, noteKind: "info", waitingFor: undefined });
  }

  private async handle(request: DeskRequest): Promise<Omit<DeskResponse, "id">> {
    const worker = request.worker;
    switch (request.op) {
      case "hello":
        this.greeted.add(worker);
        return { ok: true, text: "desk connected" };
      case "check":
        return this.check(worker, request.path ?? "");
      case "claim":
        return this.claim(worker, request.path ?? "", request.intent ?? "");
      case "handover":
        return this.handover(worker, request.path ?? "", request.note ?? "");
      case "mine":
        return { ok: true, text: this.mine(worker) };
      case "wait":
        return this.wait(worker, Math.min(MAX_WAIT_MS, Math.max(1000, request.timeoutMs ?? MAX_WAIT_MS)));
      default:
        return { ok: false, text: `unknown desk operation ${String(request.op)}` };
    }
  }

  private check(worker: WorkerId, path: string): Omit<DeskResponse, "id"> {
    if (this.desk.holds(worker, path)) return { ok: true, allowed: true, text: "" };
    const key = this.desk.normalize(path);
    const holder = this.desk.holderOf(path);
    if (!holder) {
      return { ok: true, allowed: false, text: `Claim \`${key}\` first: call claim_file with its path and a one-line intent (what you will change), then retry this edit.` };
    }
    return {
      ok: true,
      allowed: false,
      text: `\`${key}\` is checked out by ${label(holder.worker)} (${holder.intent}). Call claim_file to join its queue, keep working on your other files, and edit it once it is handed to you.`,
    };
  }

  private claim(worker: WorkerId, path: string, intent: string): Omit<DeskResponse, "id"> {
    if (!path.trim()) return { ok: false, text: "claim_file needs a path" };
    const result = this.desk.claim(worker, path, intent);
    if (result.status === "queued") {
      return {
        ok: true,
        text: `\`${result.path}\` is with ${label(result.holder.worker)} (${result.holder.intent}); you are #${result.position} in line. Keep working on your other files — you will be told when it is handed to you, with their notes.`,
      };
    }
    const behind = result.queue.length > 0 ? ` Waiting behind you: ${queueLines(result.queue)}.` : "";
    return { ok: true, text: `\`${result.path}\` is yours. Edit it, then call handover_file with a note as soon as you are done with it.${behind}` };
  }

  private handover(worker: WorkerId, path: string, note: string): Omit<DeskResponse, "id"> {
    const result = this.desk.handover(worker, path, note);
    if (!result.ok) return { ok: false, text: result.error };
    const handover = this.desk.handovers().at(-1);
    if (result.to && handover) this.options.onHandover?.(handover);
    if (!result.to) return { ok: true, text: `\`${result.path}\` released; nobody was waiting for it.` };
    return { ok: true, text: `\`${result.path}\` handed to ${label(result.to.worker)} with your note.` };
  }

  private mine(worker: WorkerId): string {
    const waiting = this.desk.waitingFor(worker).map((entry) => `You are #${entry.position} for \`${entry.path}\` (held by ${label(entry.holder.worker)}: ${entry.holder.intent}).`);
    return [describeHeld(this.desk.heldBy(worker)), ...waiting].join("\n");
  }

  private async wait(worker: WorkerId, timeoutMs: number): Promise<Omit<DeskResponse, "id">> {
    const queuedFor = this.desk.waitingFor(worker);
    if (queuedFor.length > 0) this.handles.get(worker)?.annotate({ waitingFor: basename(queuedFor[0]!.path) });
    const result = await this.desk.wait(worker, timeoutMs);
    this.handles.get(worker)?.annotate({ waitingFor: undefined });
    if (result.refused) {
      return { ok: false, text: `Hand these over first — others are waiting for them:\n${describeHeld(result.refused)}` };
    }
    const grants = result.grants.filter((event): event is Extract<DeskEvent, { type: "granted" }> => event.type === "granted");
    if (grants.length > 0) return { ok: true, text: grants.map(grantMessage).join("\n") };
    if (queuedFor.length === 0) return { ok: true, text: "You are not waiting for any file." };
    return { ok: true, text: `Still waiting:\n${this.mine(worker)}\nIf nothing else is left, finish your report and list the dependency under Notes; files are handed over automatically when their holder finishes.` };
  }
}

/** A handover note for `next`, written from a finished worker's report. */
export function autoNote(from: WorkerId, path: string, next: Claim, changes: ReadonlyArray<{ path: string; change: string }>, completed: string): string {
  const match = changes.find((change) => change.path.replace(/\\/g, "/").endsWith(path) || path.endsWith(change.path.replace(/\\/g, "/")));
  const what = match ? `changed it: ${match.change}` : completed ? `finished; its report says: ${completed.replace(/\s+/g, " ").slice(0, 300)}` : "finished without describing its change";
  return `${label(from)} ${what} (auto-handover on finish; you asked for: ${next.intent})`;
}
