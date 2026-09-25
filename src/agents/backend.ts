import type { DomainSpec } from "../schemas/agent.ts";

export const backendSpec: DomainSpec = {
  domain: "backend",
  promptFile: "backend.md",
  scoutFocus:
    "API, business logic, data models, persistence, authentication/authorization, integrations, and backend reliability",
  boundary:
    "Stay inside backend code. Do not modify frontend implementation; report frontend requirements to the Master.",
};
