import type { Domain, DomainSpec } from "../schemas/agent.ts";
import { designerSpec } from "./designer.ts";
import { backendSpec } from "./backend.ts";
import { qaSpec } from "./qa.ts";

export const DOMAIN_SPECS: Record<Domain, DomainSpec> = {
  designer: designerSpec,
  backend: backendSpec,
  qa: qaSpec,
};

export function domainSpec(domain: Domain): DomainSpec {
  return DOMAIN_SPECS[domain];
}
