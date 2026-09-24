import type { DomainSpec } from "../schemas/agent.ts";

export const designerSpec: DomainSpec = {
  domain: "designer",
  promptFile: "designer.md",
  scoutFocus:
    "UI/UX, frontend implementation, accessibility, responsive behavior, and the existing design language",
  boundary:
    "Stay inside frontend/UI. Do not modify backend implementation; report backend dependencies to the Master.",
};
