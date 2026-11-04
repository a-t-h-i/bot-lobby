// Spike A6: one Agent SDK turn; print the rate-limit / billing signals it reports.
import { query } from "@anthropic-ai/claude-agent-sdk";
const env = { ...process.env };
for (const k of Object.keys(env)) if (k === "CLAUDECODE" || /SESSION|INGRESS|REMOTE|CCR|MESSAGING|ARTIFACT|COWORK|MEMORY|TEE_SDK|SYNC_|COORDINATOR|PROJECTS/.test(k)) delete env[k];
const q = query({ prompt: "Say hi in two words.", options: { model: "haiku", env, tools: [], persistSession: false } });
for await (const m of q) {
  if (m.type === "system" && m.subtype === "init") console.log("init apiKeySource", m.apiKeySource);
  else if (m.type === "rate_limit_event") console.log("rate_limit", JSON.stringify(m.rate_limit_info));
  else if (m.type === "assistant") console.log("text", m.message.content.map((c) => c.text ?? "").join(""));
  else if (m.type === "result") console.log("result", m.subtype, m.is_error, JSON.stringify(m.result));
}
