import type { DomainSpec } from "../schemas/agent.ts";

export const backendSpec: DomainSpec = {
  domain: "backend",
  promptFile: "backend.md",
  scoutFocus:
    "server-side code: API, business logic, data models, persistence, authentication/authorization, integrations, and backend reliability",
  boundary:
    "Stay inside server-side code. Do not modify browser code (pages, components, client-side logic or graphics); report frontend requirements to the Master.",
};
