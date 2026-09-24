import type { DomainSpec } from "../schemas/agent.ts";

export const qaSpec: DomainSpec = {
  domain: "qa",
  promptFile: "qa.md",
  scoutFocus:
    "existing test strategy, quality gates, acceptance criteria, regression risk, and how the project verifies changes",
  boundary:
    "Do not silently modify production implementation; report required implementation changes to the Master.",
};
