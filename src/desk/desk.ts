/**
 * The file desk: checkout and handover of repository files between workers
 * that run in parallel, the way people share a physical document.
 *
 * A worker claims a file with a one-line intent before editing it. A free
 * file is granted at once; a held file queues the claimant behind the holder,
 * and the holder is told who is waiting and what they intend. When the holder
 * hands the file over (with a note written for the next worker's intent), or
 * finishes, the file passes to the head of the queue together with that note.
 * Reads never need a claim. Everything lives in the master process, so a
 * crashed worker can never leave a stale lock behind.
 */
import { isAbsolute, relative, resolve } from "node:path";

export type WorkerId = string;

export interface Claim {
  worker: WorkerId;
  intent: string;
}

/** One file's checkout state as a worker sees it. */
export interface FileView {
  path: string;
  holder: Claim;
  queue: Claim[];
}

export interface Handover {
  path: string;
  from: WorkerId;
  to: WorkerId;
  note: string;
  auto: boolean;
  at: number;
}

export type ClaimResult =
  | { status: "granted"; path: string; queue: Claim[] }
  | { status: "held"; path: string; queue: Claim[] }
  | { status: "queued"; path: string; holder: Claim; position: number };

export type HandoverResult =
  | { ok: true; path: string; to?: Claim; queue: Claim[] }
  | { ok: false; path: string; error: string };

/** What the desk tells workers; the session turns these into steering messages. */
export type DeskEvent =
  /** `to` holds `path` and its queue changed (someone joined or left). */
  | { type: "queue"; to: WorkerId; path: string; queue: Claim[] }
  /** `to` now holds `path`, handed over by `from` with `note`; `queue` is who waits behind it. */
  | { type: "granted"; to: WorkerId; path: string; from: WorkerId; note: string; intent: string; queue: Claim[] }
  /** `worker` joined the queue for `path` behind `holder`. */
  | { type: "queued"; worker: WorkerId; path: string; holder: WorkerId; position: number };

interface Entry {
  holder: Claim;
  queue: Claim[];
}

interface Waiter {
  resolve: (grants: DeskEvent[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_INTENT = 160;
const MAX_NOTE = 1200;

function clean(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export class FileDesk {
  private readonly files = new Map<string, Entry>();
  private readonly waiters = new Map<WorkerId, Waiter>();
  private readonly pendingGrants = new Map<WorkerId, DeskEvent[]>();
  private readonly log: Handover[] = [];
  private readonly cwd: string;
  private readonly onEvent: (event: DeskEvent) => void;
  private readonly now: () => number;

  constructor(cwd: string, onEvent: (event: DeskEvent) => void = () => {}, now: () => number = Date.now) {
    this.cwd = resolve(cwd);
    this.onEvent = onEvent;
    this.now = now;
  }

  /** A stable key and display path for a file, relative to the repository root. */
  normalize(path: string): string {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(this.cwd, path);
    const rel = relative(this.cwd, absolute);
    const display = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : absolute;
    return display.replace(/\\/g, "/");
  }

  /** Claim `path` for `worker` with a short intent; grants a free file, queues behind a holder. */
  claim(worker: WorkerId, path: string, intent: string): ClaimResult {
    const key = this.normalize(path);
    const claim = { worker, intent: clean(intent || "edit", MAX_INTENT) };
    const entry = this.files.get(key);
    if (!entry) {
      this.files.set(key, { holder: claim, queue: [] });
      return { status: "granted", path: key, queue: [] };
    }
    if (entry.holder.worker === worker) {
      entry.holder = claim;
      return { status: "held", path: key, queue: [...entry.queue] };
    }
    const existing = entry.queue.findIndex((queued) => queued.worker === worker);
    if (existing >= 0) entry.queue[existing] = claim;
    else entry.queue.push(claim);
    const position = entry.queue.findIndex((queued) => queued.worker === worker) + 1;
    if (existing < 0) {
      this.onEvent({ type: "queued", worker, path: key, holder: entry.holder.worker, position });
      this.onEvent({ type: "queue", to: entry.holder.worker, path: key, queue: [...entry.queue] });
    }
    return { status: "queued", path: key, holder: entry.holder, position };
  }

  /** True when `worker` currently holds `path`. */
  holds(worker: WorkerId, path: string): boolean {
    return this.files.get(this.normalize(path))?.holder.worker === worker;
  }

  /** Who holds `path`, if anyone. */
  holderOf(path: string): Claim | undefined {
    return this.files.get(this.normalize(path))?.holder;
  }

  /** Hand `path` to whoever is next in its queue, with a note for them; free it when nobody waits. */
  handover(worker: WorkerId, path: string, note: string): HandoverResult {
    const key = this.normalize(path);
    const entry = this.files.get(key);
    if (!entry || entry.holder.worker !== worker) {
      return { ok: false, path: key, error: `you do not hold ${key}${entry ? ` (${entry.holder.worker} does)` : ""}` };
    }
    const next = this.pass(key, entry, worker, clean(note || "no note", MAX_NOTE), false);
    return { ok: true, path: key, ...(next ? { to: next } : {}), queue: [...(this.files.get(key)?.queue ?? [])] };
  }

  /**
   * Release everything `worker` holds (handing each file to its next worker
   * with `note(path, next)`) and drop it from every queue. Used when a worker
   * finishes, crashes or retries.
   */
  release(worker: WorkerId, note: (path: string, next: Claim) => string): Handover[] {
    const passed: Handover[] = [];
    for (const [key, entry] of [...this.files]) {
      const before = entry.queue.length;
      entry.queue = entry.queue.filter((queued) => queued.worker !== worker);
      if (entry.holder.worker === worker) {
        const head = entry.queue[0];
        const next = this.pass(key, entry, worker, head ? clean(note(key, head), MAX_NOTE) : "", true);
        if (next) passed.push(this.log.at(-1)!);
      } else if (entry.queue.length !== before) {
        this.onEvent({ type: "queue", to: entry.holder.worker, path: key, queue: [...entry.queue] });
      }
    }
    const waiter = this.waiters.get(worker);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(worker);
      waiter.resolve([]);
    }
    this.pendingGrants.delete(worker);
    return passed;
  }

  private pass(key: string, entry: Entry, from: WorkerId, note: string, auto: boolean): Claim | undefined {
    const next = entry.queue.shift();
    if (!next) {
      this.files.delete(key);
      return undefined;
    }
    entry.holder = next;
    this.log.push({ path: key, from, to: next.worker, note, auto, at: this.now() });
    const event: DeskEvent = { type: "granted", to: next.worker, path: key, from, note, intent: next.intent, queue: [...entry.queue] };
    this.onEvent(event);
    this.deliver(next.worker, event);
    return next;
  }

  /** Wake a worker blocked in `wait` with its grant, or keep it for its next wait. */
  private deliver(worker: WorkerId, event: DeskEvent): void {
    const waiter = this.waiters.get(worker);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(worker);
      waiter.resolve([event]);
      return;
    }
    this.pendingGrants.set(worker, [...(this.pendingGrants.get(worker) ?? []), event]);
  }

  /** Files `worker` holds that someone is waiting for; it must hand these over before it may wait. */
  owed(worker: WorkerId): FileView[] {
    return this.heldBy(worker).filter((file) => file.queue.length > 0);
  }

  heldBy(worker: WorkerId): FileView[] {
    return [...this.files].filter(([, entry]) => entry.holder.worker === worker).map(([path, entry]) => ({ path, holder: entry.holder, queue: [...entry.queue] }));
  }

  /** Files `worker` is queued for, with its position. */
  waitingFor(worker: WorkerId): Array<{ path: string; holder: Claim; position: number }> {
    return [...this.files].flatMap(([path, entry]) => {
      const index = entry.queue.findIndex((queued) => queued.worker === worker);
      return index >= 0 ? [{ path, holder: entry.holder, position: index + 1 }] : [];
    });
  }

  /**
   * Wait up to `timeoutMs` for a file to be handed to `worker`. Refuses while
   * the worker holds files others are waiting for, which breaks deadlock
   * cycles: whoever waits first hands over first.
   */
  wait(worker: WorkerId, timeoutMs: number): Promise<{ refused?: FileView[]; grants: DeskEvent[] }> {
    const owed = this.owed(worker);
    if (owed.length > 0) return Promise.resolve({ refused: owed, grants: [] });
    const pending = this.pendingGrants.get(worker);
    if (pending?.length) {
      this.pendingGrants.delete(worker);
      return Promise.resolve({ grants: pending });
    }
    if (this.waitingFor(worker).length === 0) return Promise.resolve({ grants: [] });
    return new Promise((done) => {
      const timer = setTimeout(() => {
        this.waiters.delete(worker);
        done({ grants: [] });
      }, Math.max(0, timeoutMs));
      this.waiters.set(worker, { resolve: (grants) => done({ grants }), timer });
    });
  }

  /** Every handover so far, oldest first. */
  handovers(): Handover[] {
    return [...this.log];
  }

  /** Wake every waiter; called when the batch ends. */
  close(): void {
    for (const [worker, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve([]);
      this.waiters.delete(worker);
    }
  }
}
