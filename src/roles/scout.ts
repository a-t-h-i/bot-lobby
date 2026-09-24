import type { RoleSpec } from "../schemas/agent.ts";

/** Scout runs read-only so it can never modify implementation. */
export const scoutSpec: RoleSpec = {
  role: "scout",
  promptFile: "scout.md",
  tools: ["read", "grep", "find", "ls"],
  contract: [
    "### Output contract",
    "Respond with exactly these sections and nothing else:",
    "`## Scope`, `## Findings`, `## Relevant Files`, `## Existing Patterns`,",
    "`## Risks`, `## Recommendations`, `## Confidence`.",
    "Use `- ` bullets. `## Relevant Files` entries are `- \\`path\\` — reason`.",
    "`## Confidence` is exactly one of `High`, `Medium`, `Low`.",
    "Keep the whole response under 400 words. Report uncertainty; do not implement.",
  ].join(" "),
};
