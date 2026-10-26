/**
 * The scout a task starts with: launched when the task is created, over the
 * domains the classifier's triage names, so its findings are ready (or nearly)
 * by the time the oracle has read the request and asks for a scout. The
 * oracle's first scout call takes it; nothing else waits on it. One per task,
 * held in this process only: a restarted window simply scouts as before. The
 * runs it spent are handed to whichever action ends it, so they are accounted
 * once in the task's run log like any scout's.
 */
import type { Domain } from "../schemas/agent.ts";
import type { AgentRun } from "../schemas/findings.ts";
import type { TaskTriage } from "../schemas/task.ts";
import type { ScoutOutcome } from "./master.ts";

interface Prefetch {
  domains: Domain[];
  outcomes: Promise<ScoutOutcome[] | undefined>;
  runs: Map<string, AgentRun>;
  cancel: () => void;
}

export interface PrefetchTaken {
  /** The findings, when they cover the ask with usable reconnaissance. */
  outcomes?: ScoutOutcome[];
  /** The finished runs the prefetch spent, used or not. */
  runs: AgentRun[];
}

const prefetches = new Map<string, Prefetch>();

/** Domains at least this likely in the triage are scouted up front; QA only when it clearly takes part. */
const BUILD_DOMAIN_AT = 0.35;
const QA_DOMAIN_AT = 0.5;

/** The domains worth scouting before the oracle asks, from the triage; none without one. */
export function prefetchDomains(triage: TaskTriage | undefined): Domain[] {
  if (!triage) return [];
  const build = (["backend", "designer"] as const).filter((domain) => (triage.domains[domain] ?? 0) >= BUILD_DOMAIN_AT);
  return [...build, ...((triage.domains.qa ?? 0) >= QA_DOMAIN_AT ? ["qa" as const] : [])];
}

/**
 * Start the task's opening scout. `start` gets the signal to stop it by and the
 * callback that records its runs. One per task; false when it did not start.
 */
export function startScoutPrefetch(taskId: string, domains: Domain[], start: (signal: AbortSignal, onRun: (run: AgentRun) => void) => Promise<ScoutOutcome[]>): boolean {
  if (domains.length === 0 || prefetches.has(taskId)) return false;
  const controller = new AbortController();
  const runs = new Map<string, AgentRun>();
  const onRun = (run: AgentRun) => { if (run.status !== "running") runs.set(run.runId, run); };
  // A failed or cancelled prefetch is just a miss: the oracle's scout runs as it would have.
  const outcomes = start(controller.signal, onRun).catch(() => undefined);
  prefetches.set(taskId, { domains, outcomes, runs, cancel: () => controller.abort() });
  return true;
}

/**
 * End the task's opening scout for an ask over `domains`. When it covers them
 * all with usable findings it waits for them and returns them; otherwise it is
 * stopped at once, so the oracle's own scout (which needs the task's scout lock)
 * can start. Undefined when there was none.
 */
export async function takeScoutPrefetch(taskId: string, domains: readonly Domain[]): Promise<PrefetchTaken | undefined> {
  const prefetch = prefetches.get(taskId);
  if (!prefetch) return undefined;
  prefetches.delete(taskId);
  const covers = domains.length > 0 && domains.every((domain) => prefetch.domains.includes(domain));
  if (!covers) prefetch.cancel();
  const outcomes = await prefetch.outcomes;
  const runs = [...prefetch.runs.values()];
  const wanted = covers ? outcomes?.filter((outcome) => domains.includes(outcome.result.domain)) : undefined;
  return wanted && wanted.length === domains.length && wanted.every((outcome) => outcome.usable) ? { outcomes: wanted, runs } : { runs };
}

/** Stop a task's opening scout and wait until it has let go of the task's scout lock. */
export function stopScoutPrefetch(taskId: string): Promise<PrefetchTaken | undefined> {
  return takeScoutPrefetch(taskId, []);
}
