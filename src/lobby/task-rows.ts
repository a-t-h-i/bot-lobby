/** The shapes of the Tasks tab's rows, shared by the web API and the page's words. */

import type { TimingProjection } from "../state/phase-timing.ts";
import type { Delivery } from "../delivery/types.ts";

export type TaskSection = "mine" | "others" | "pending" | "recent" | "archived";

/** How a row is ticked off: still to do (a plan, or a task under way), completed, or abandoned. */
export type CheckState = "open" | "done" | "dropped";

export interface TaskRow {
  timing?: TimingProjection;
  delivery?: Pick<Delivery, "status" | "reviewId">;
  /** A task on the list, a saved plan, or a task in the archive. */
  kind: "task" | "plan" | "archived";
  id: string;
  title: string;
  section: TaskSection;
  /** Task state, or `pending` for a saved plan. */
  status: string;
  paused?: boolean;
  check: CheckState;
  /** Plan steps done, once the task has a plan. */
  progress?: { done: number; total: number };
  /** Who drives it, for tasks other sessions own. */
  owner?: string;
  /** How long ago it finished (finished tasks), was saved (plans) or was archived, as `3h`. */
  age?: string;
  /** The GitHub issue a plan came from. */
  issue?: number;
  /** Auto mode is on: the oracle drives it without asking. */
  auto?: boolean;
}
