/**
 * Effort routing: a step the classifier judges simple runs one thinking
 * level lower, and one it judges trivial runs on the cheaper model set in
 * settings (`classifier.effort.cheapModel`), so large models and high
 * thinking levels are spent where the work needs them. The configured model
 * and thinking stay the ceiling: a route only ever goes down. A routed run
 * that falls short (fails, stalls, times out, wraps up early or returns an
 * unusable report) is run again on the configured profile, and review is
 * unchanged. The Master, the oracle, the QA gate and the researcher are never
 * routed.
 */
import { THINKING_LEVELS, type ClassifierConfig, type ThinkingLevelName } from "../schemas/configuration.ts";
import type { Classifier } from "./classifier.ts";
import { score, scoreOf } from "./client.ts";
import { clip } from "./limits.ts";

export const EFFORT_LEVELS = ["trivial", "simple", "moderate", "complex"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

const LEVELS = [
  "trivial: a mechanical edit or lookup — a rename, a copy change, a one-line fix, reading one known file",
  "simple: a small change that follows an existing pattern in one or two files",
  "moderate: new logic or several files, with some judgment about the design",
  "complex: design decisions, cross-cutting or concurrent changes, security, or an unclear root cause",
];

export interface RunProfileLike {
  model?: string;
  thinking: string;
}

export interface EffortRoute extends RunProfileLike {
  level: "trivial" | "simple";
  confidence: number;
  /** The configured profile the route came down from. */
  from: RunProfileLike;
}

/** Floor for every route: thinking never goes below `low` because of the classifier. */
const FLOOR: ThinkingLevelName = "low";

function rank(level: string): number {
  return (THINKING_LEVELS as readonly string[]).indexOf(level);
}

/** One thinking level lower, never below `low`; a level already at or below it stays. */
export function stepDown(thinking: string): string {
  const index = rank(thinking);
  if (index < 0 || index <= rank(FLOOR)) return thinking;
  return THINKING_LEVELS[index - 1]!;
}

/** The lower of two thinking levels. */
function lower(a: string, b: string): string {
  return rank(a) >= 0 && rank(a) < rank(b) ? a : b;
}

export interface RouteOptions {
  /** The run's thinking is fixed (scouts): only the model may change. */
  thinkingFixed?: boolean;
  /** Clamp a thinking level to what a model supports. */
  clamp?: (model: string, thinking: string) => string;
}

/** Where a scored step goes; undefined keeps the configured profile. */
export function planRoute(level: EffortLevel, confidence: number, profile: RunProfileLike, config: Pick<ClassifierConfig, "thresholds" | "effort">, options: RouteOptions = {}): EffortRoute | undefined {
  const { simpleAt, trivialAt } = config.thresholds;
  const cheap = config.effort.cheapModel && config.effort.cheapModel !== "inherit" ? config.effort.cheapModel : undefined;
  let next: RunProfileLike | undefined;
  let routed: EffortRoute["level"] | undefined;
  if (level === "trivial" && confidence >= trivialAt && cheap && cheap !== profile.model) {
    const thinking = options.thinkingFixed ? profile.thinking : lower(profile.thinking, FLOOR);
    next = { model: cheap, thinking: options.clamp ? options.clamp(cheap, thinking) : thinking };
    routed = "trivial";
  } else if ((level === "trivial" || level === "simple") && confidence >= simpleAt && !options.thinkingFixed) {
    next = { ...(profile.model ? { model: profile.model } : {}), thinking: stepDown(profile.thinking) };
    routed = level;
  }
  if (!next || !routed || (next.model === profile.model && next.thinking === profile.thinking)) return undefined;
  return { ...next, level: routed, confidence, from: { ...(profile.model ? { model: profile.model } : {}), thinking: profile.thinking } };
}

/** How hard a step is, or undefined when the classifier is off or fails. */
export async function scoreEffort(classifier: Classifier, instruction: string, context: string | undefined, signal?: AbortSignal): Promise<{ level: EffortLevel; confidence: number } | undefined> {
  if (!classifier.enabled("effort") || !instruction.trim()) return undefined;
  const result = await classifier.ask("effort", {
    state: { step: clip(instruction, 6000), ...(context ? { task: clip(context, 3000) } : {}) },
    questions: { effort: score("How much reasoning does an experienced engineer need to do `step` well, given `task`?", LEVELS) },
  }, signal ? { signal } : {});
  const scored = scoreOf(result?.answers, "effort");
  if (!scored) return undefined;
  return { level: EFFORT_LEVELS[Math.max(0, Math.min(EFFORT_LEVELS.length - 1, scored.level))]!, confidence: scored.confidence };
}

/** `p/big · medium`, the profile a route came down from. */
export function profileLabel(profile: RunProfileLike): string {
  return `${profile.model ?? "session model"} · ${profile.thinking}`;
}

/** `trivial 0.88: p/big · medium → p/cheap · low`, for receipts and the activity log. */
export function routeLabel(route: EffortRoute): string {
  return `${route.level} ${route.confidence.toFixed(2)}: ${profileLabel(route.from)} → ${profileLabel(route)}`;
}

export interface EffortScore {
  level: EffortLevel;
  confidence: number;
}

/** Lowers the model or thinking of a step the classifier judges simple or trivial. */
export interface EffortRouter {
  /** Score a step and plan its route in one go. */
  route(instruction: string, profile: RunProfileLike, options?: { thinkingFixed?: boolean; context?: string; signal?: AbortSignal }): Promise<EffortRoute | undefined>;
  /** Score a step once (several agents may share it)… */
  score(instruction: string, options?: { context?: string; signal?: AbortSignal }): Promise<EffortScore | undefined>;
  /** …then plan each agent's route from its own profile. */
  plan(scored: EffortScore, profile: RunProfileLike, options?: { thinkingFixed?: boolean }): EffortRoute | undefined;
}

export function effortRouter(classifier: Classifier, deps: { clamp?: RouteOptions["clamp"]; log?: (text: string) => void } = {}): EffortRouter {
  const router: EffortRouter = {
    async score(instruction, options = {}) {
      if (!classifier.enabled("effort")) return undefined;
      return scoreEffort(classifier, instruction, options.context, options.signal);
    },
    plan(scored, profile, options = {}) {
      const route = planRoute(scored.level, scored.confidence, profile, classifier.config, { ...(options.thinkingFixed ? { thinkingFixed: true } : {}), ...(deps.clamp ? { clamp: deps.clamp } : {}) });
      if (route) deps.log?.(`routed ${routeLabel(route)}`);
      return route;
    },
    async route(instruction, profile, options = {}) {
      const scored = await router.score(instruction, { ...(options.context ? { context: options.context } : {}), ...(options.signal ? { signal: options.signal } : {}) });
      return scored ? router.plan(scored, profile, options.thinkingFixed ? { thinkingFixed: true } : {}) : undefined;
    },
  };
  return router;
}

/** Whether a routed run fell short and must run again on the configured profile. */
export function fellShort(run: { status: string; stalled?: boolean; wrappedUp?: boolean }, issues: readonly string[] = []): boolean {
  if (run.status === "cancelled") return false;
  return run.status !== "success" || Boolean(run.stalled) || Boolean(run.wrappedUp) || issues.length > 0;
}
