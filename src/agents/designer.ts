import type { DomainSpec } from "../schemas/agent.ts";

export const designerSpec: DomainSpec = {
  domain: "designer",
  promptFile: "designer.md",
  scoutFocus:
    "UI/UX and everything that runs in the browser (pages, components, client-side logic, canvas and WebGL/three.js graphics), accessibility, responsive behavior, and the existing design language",
  boundary:
    "Stay inside the frontend: everything that runs in the browser. Do not modify server-side code; report backend dependencies to the Master.",
};
