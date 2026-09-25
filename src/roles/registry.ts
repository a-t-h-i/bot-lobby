import type { Role, RoleSpec } from "../schemas/agent.ts";
import { scoutSpec } from "./scout.ts";
import { workerSpec } from "./worker.ts";
import { reviewerSpec } from "./reviewer.ts";
import { researcherSpec } from "./researcher.ts";

export const ROLE_SPECS: Record<Role, RoleSpec> = {
  scout: scoutSpec,
  worker: workerSpec,
  reviewer: reviewerSpec,
  researcher: researcherSpec,
};

export function roleSpec(role: Role): RoleSpec {
  return ROLE_SPECS[role];
}
