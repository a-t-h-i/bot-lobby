/**
 * Which planning seats run this round. Every seat is a full pi run that
 * re-reads the repository, so one classifier call asks, per seat, whether the
 * idea (round 1) or the user's latest answers touch anything only that seat
 * would decide or check. A seat that was READY needs stronger evidence to come
 * back. Any seat the classifier did not answer for sits, so a partial answer
 * never silences a domain.
 */
import type { ClassifierThresholds } from "../schemas/configuration.ts";
import type { Classifier } from "./classifier.ts";
import { noul, yesOf, type Answer, type SystemOneRequest } from "./client.ts";
import { clip, clipTail } from "./limits.ts";

export interface SeatCandidate {
  member: string;
  /** DEV, DESIGN, QA, RESEARCH. */
  label: string;
  /** What the seat owns, in plain words. */
  owns: string;
  /** How the seat left the last round it sat. */
  lastStatus?: "ready" | "open";
  notes?: readonly string[];
}

export interface SeatInput {
  round: number;
  /** The idea as first described (and the source issue, if any). */
  idea: string;
  /** The user's newest message: answers, comments, a new direction. */
  latest: string;
  draft?: string;
  candidates: readonly SeatCandidate[];
}

export interface SeatDecision {
  /** Members that sit this round. */
  seat: Set<string>;
  /** The probability each candidate was judged needed. */
  probabilities: Map<string, number>;
  ms: number;
}

function questionKey(member: string): string {
  return `seat_${member}`;
}

export function seatRequest(input: SeatInput): SystemOneRequest {
  const seats: Record<string, { owns: string; last_round: string; notes: string[] }> = {};
  for (const candidate of input.candidates) {
    seats[candidate.label] = {
      owns: candidate.owns,
      last_round: candidate.lastStatus === "ready" ? "READY: nothing open for this seat" : candidate.lastStatus === "open" ? "OPEN: had questions" : "has not sat yet",
      notes: (candidate.notes ?? []).slice(0, 6).map((note) => clip(note, 300)),
    };
  }
  const first = input.round <= 1;
  const questions = Object.fromEntries(input.candidates.map((candidate) => [
    questionKey(candidate.member),
    noul(
      first
        ? `Does \`idea\` involve anything that the ${candidate.label} seat (\`seats.${candidate.label}.owns\`) must decide or check before the plan can be built?`
        : `Given \`idea\` and the \`draft\` plan, does the user's \`latest\` message raise or leave open anything that only the ${candidate.label} seat (\`seats.${candidate.label}.owns\`) would ask about or check?`,
      `Yes: there is a decision, constraint or risk in the ${candidate.label} seat's domain that is not settled yet.`,
      `No: nothing in it touches the ${candidate.label} seat's domain, or everything there is already settled.`,
    ),
  ]));
  return {
    state: {
      idea: clip(input.idea, 3000),
      latest: first ? "" : clipTail(input.latest, 3000),
      draft: clip(input.draft ?? "", 5000),
      seats,
    },
    questions,
  };
}

/** Seat each candidate at `seatAt`, or `reseatReadyAt` when it was READY; unanswered candidates sit. */
export function decideSeats(answers: Record<string, Answer> | undefined, input: SeatInput, thresholds: Pick<ClassifierThresholds, "seatAt" | "reseatReadyAt">): Omit<SeatDecision, "ms"> {
  const seat = new Set<string>();
  const probabilities = new Map<string, number>();
  for (const candidate of input.candidates) {
    const probability = yesOf(answers, questionKey(candidate.member));
    if (probability === undefined) {
      seat.add(candidate.member);
      continue;
    }
    probabilities.set(candidate.member, probability);
    const bar = candidate.lastStatus === "ready" ? thresholds.reseatReadyAt : thresholds.seatAt;
    if (probability >= bar) seat.add(candidate.member);
  }
  return { seat, probabilities };
}

/** One call for every candidate seat; undefined when the classifier is off or fails. */
export async function chooseSeats(classifier: Classifier, input: SeatInput, signal?: AbortSignal): Promise<SeatDecision | undefined> {
  if (input.candidates.length === 0) return undefined;
  const result = await classifier.ask("seats", seatRequest(input), signal ? { signal } : {});
  if (!result) return undefined;
  return { ...decideSeats(result.answers, input, classifier.config.thresholds), ms: result.ms };
}
