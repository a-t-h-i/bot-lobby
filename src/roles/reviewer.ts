import type { RoleSpec } from "../schemas/agent.ts";

/** Reviewer gets bash to run tests/static analysis, but must not modify code. */
export const reviewerSpec: RoleSpec = {
  role: "reviewer",
  promptFile: "reviewer.md",
  tools: ["read", "grep", "find", "ls", "bash"],
  contract: [
    "### Output contract",
    "Begin with `## Verdict` followed by exactly one of `PASS`, `CHANGES_REQUIRED`,",
    "or `BLOCKED`. Then `## Findings`, `## Verification`, `## Required Changes`,",
    "`## Optional Improvements`. Findings entries are `- [severity] text — \\`path:line\\``.",
    "Verification entries are `- command — result`.",
    "You must not modify implementation files. Report required changes instead.",
  ].join(" "),
};
