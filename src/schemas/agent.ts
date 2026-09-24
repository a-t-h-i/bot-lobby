/** Domain and role identities used across the orchestrator. */

export const DOMAINS = ["designer", "backend", "qa"] as const;
export type Domain = (typeof DOMAINS)[number];

export const ROLES = ["scout", "worker", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const AGENT_KINDS = ["master", ...DOMAINS] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** Tool allowlists enforce the "no modification" boundary for read-only roles. */
export const SCOUT_TOOLS = ["read", "grep", "find", "ls"] as const;
export const REVIEWER_TOOLS = ["read", "grep", "find", "ls", "bash"] as const;

export function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
