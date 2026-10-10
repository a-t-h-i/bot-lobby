import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createDeskClient } from "../desk/ipc.ts";
import { AGENT_ENV, DELEGATION_ENV, DELEGATE_TOOL, MAX_CHILDREN, type AgentPolicy } from "../execution/delegation.ts";
import { loadConfig } from "../state/project.ts";
import { isSubagentProcess } from "./quiet.ts";

export function allowedAgentTool(policy: AgentPolicy, name: string, readOnlyHint?: boolean, hidden = false): boolean {
  if (hidden) return false;
  if (name.startsWith("mcp__")) return policy.mcpTools.includes(name) && (!policy.readOnly || readOnlyHint === true);
  if (name === DELEGATE_TOOL && policy.depth > 1) return false;
  return policy.tools.includes(name);
}

/** Enforce the same permissions on direct, discovered and codemode-nested calls. */
export function registerAgentPermissions(pi: ExtensionAPI): void {
  const raw = process.env[AGENT_ENV];
  let policy: AgentPolicy | undefined;
  if (raw) {
    try { policy = JSON.parse(raw) as AgentPolicy; }
    catch { throw new Error("Invalid bot-lobby agent policy."); }
    if (!Array.isArray(policy?.tools) || !Array.isArray(policy?.mcpTools) || typeof policy.readOnly !== "boolean" || ![1, 2].includes(policy.depth)) throw new Error("Invalid bot-lobby agent policy.");
  }
  pi.on("tool_call", (event) => {
    const info = pi.getAllTools().find((tool) => tool.name === event.toolName);
    if (!info) return { block: true, reason: `Unknown tool ${event.toolName}.` };
    if (["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(event.toolName)) {
      const server = (event.input as { server?: unknown }).server;
      const grants = policy?.mcpTools ?? loadConfig().master.mcpTools ?? [];
      if (typeof server === "string" && grants.some((tool) => tool.startsWith(`mcp__${server.replace(/[^A-Za-z0-9_]/g, "_")}__`)) && info?.exposure !== "hidden") return;
      return { block: true, reason: "Specify an MCP server with an explicit tool grant to read its resources." };
    }
    if (policy) {
      if (allowedAgentTool(policy, event.toolName, info?.annotations?.readOnlyHint, info?.exposure === "hidden")) return;
      return { block: true, reason: `This agent is not granted ${event.toolName}.` };
    }
    if (event.toolName.startsWith("mcp__")) {
      if ((loadConfig().master.mcpTools ?? []).includes(event.toolName) && info?.exposure !== "hidden") return;
      return { block: true, reason: `Grant ${event.toolName} to the master in bot-lobby settings first.` };
    }
    if (event.parentToolCallId && !pi.getActiveTools().includes(event.toolName)) return { block: true, reason: `${event.toolName} is not active for this agent.` };
  });
}

export function registerDelegation(pi: ExtensionAPI): void {
  if (!isSubagentProcess() || !process.env[DELEGATION_ENV]) return;
  const target = JSON.parse(process.env[DELEGATION_ENV]!) as { address: string; token: string; timeoutMs: number };
  const client = createDeskClient(target.address, target.token);
  pi.on("session_shutdown", () => client.close());
  pi.registerTool({
    name: DELEGATE_TOOL,
    label: "Delegate subtasks",
    description: "Split substantial, separable work among at most five children total. Supply complete briefs with goals, files, contracts, constraints and done criteria. Wait for their reports, integrate changes and verify the whole task yourself. Children cannot delegate further.",
    parameters: Type.Object({ briefs: Type.Array(Type.String({ minLength: 1, maxLength: 32_000 }), { minItems: 1, maxItems: MAX_CHILDREN }) }),
    executionMode: "sequential",
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      const cancel = () => { void client.request({ op: "cancel_delegate" }); };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const answer = await client.request({ op: "delegate", briefs: params.briefs }, target.timeoutMs + 10_000);
        if (!answer.ok) throw new Error(answer.text);
        const children = JSON.parse(answer.text) as Array<{ runId: string; status: string; report: string; reportPath?: string; error?: string }>;
        return { content: [{ type: "text", text: children.map((child) => `Child ${child.runId}: ${child.status}\n${child.report}${child.reportPath ? `\nFull report: ${child.reportPath}` : ""}${child.error ? `\nError: ${child.error}` : ""}`).join("\n\n") }], details: { children } };
      } finally { signal?.removeEventListener("abort", cancel); }
    },
  });
}
