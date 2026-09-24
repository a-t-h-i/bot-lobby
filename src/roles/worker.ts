import type { RoleSpec } from "../schemas/agent.ts";

/** Worker has no tool allowlist: it needs the full set to implement. */
export const workerSpec: RoleSpec = {
  role: "worker",
  promptFile: "worker.md",
  contract: [
    "### Output contract",
    "Respond with exactly these sections and nothing else:",
    "`## Completed`, `## Files Changed`, `## Verification`, `## Notes`, `## Blockers`.",
    "`## Files Changed` entries are `- \\`path\\` — change`.",
    "`## Verification` entries are `- command — result`.",
    "If blocked, `## Blockers` contains `**Blocker:**`, `**Tried:**`, and `**Need:**`.",
    "Do not narrate. Do not expand scope. Report only what you actually changed and verified.",
  ].join(" "),
};
