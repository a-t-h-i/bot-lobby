#!/usr/bin/env node
// Throwaway spike (phase 01 part A). `node mcp-orchestrator.mjs server` is a tiny
// stdio MCP server named bot-lobby with tools ping (instant) and ask (waits ASK_MS).
// `node mcp-orchestrator.mjs claude` drives headless Claude Code against it.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
const ASK_MS = Number(process.env.ASK_MS ?? 180_000);

if (mode === "server") {
  const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const tools = [
    { name: "ping", description: "Returns pong with a secret word.", inputSchema: { type: "object", properties: {} } },
    { name: "ask", description: "Asks the user a question and waits for the answer.", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  ];
  createInterface({ input: process.stdin }).on("line", (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return;
    if (m.method === "initialize") return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "bot-lobby", version: "0" } } });
    if (m.method === "tools/list") return send({ id: m.id, result: { tools } });
    if (m.method === "tools/call") {
      if (m.params?.name === "ping") return send({ id: m.id, result: { content: [{ type: "text", text: "pong: the secret word is MARMALADE" }] } });
      if (m.params?.name === "ask") return void setTimeout(() => send({ id: m.id, result: { content: [{ type: "text", text: `The user answered after ${ASK_MS / 1000}s: blue` }] } }), ASK_MS);
    }
    send({ id: m.id, error: { code: -32601, message: "no" } });
  });
} else if (mode === "claude") {
  const self = fileURLToPath(import.meta.url);
  const cfg = `/tmp/bl-spike-mcp-${process.pid}.json`;
  writeFileSync(cfg, JSON.stringify({ mcpServers: { "bot-lobby": { command: process.execPath, args: [self, "server"], env: { ASK_MS: String(ASK_MS) }, ...(process.env.SERVER_TIMEOUT ? { timeout: Number(process.env.SERVER_TIMEOUT) } : {}) } } }));
  const [resume, ...words] = process.argv.slice(3);
  const args = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--mcp-config", cfg, "--strict-mcp-config",
    "--allowedTools", "mcp__bot-lobby__ping,mcp__bot-lobby__ask", "--tools", "", "--model", process.env.MODEL ?? "haiku"];
  if (resume && resume !== "-") args.push("--resume", resume);
  const env = { ...process.env, MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT ?? "86400000" };
  // Run as a fresh, standalone headless Claude Code (not tied to the session that runs the spike).
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || /SESSION|INGRESS|REMOTE|CCR|MESSAGING|ARTIFACT|COWORK|MEMORY|TEE_SDK|SYNC_|COORDINATOR|PROJECTS|BACKGROUND|BG_TASKS|EFFORT|AUTOCOMPACT|COMPACT/.test(k)) delete env[k];
  const child = spawn("claude", args, { env, stdio: ["pipe", "pipe", "inherit"] });
  const msg = (text) => child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
  msg(words.join(" "));
  // A4: optional steer message sent mid-turn after STEER_MS.
  if (process.env.STEER) setTimeout(() => msg(process.env.STEER), Number(process.env.STEER_MS ?? 8000));
  const t0 = Date.now();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let e; try { e = JSON.parse(line); } catch { return console.log("RAW", line); }
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    if (e.type === "system" && !["thinking_tokens","post_turn_summary"].includes(e.subtype)) console.log(s, "system", e.subtype, e.session_id ?? "", e.apiKeySource ?? "", JSON.stringify(e.mcp_servers ?? ""));
    else if (e.type === "assistant") for (const c of e.message.content) console.log(s, "assistant", c.type, c.text ?? c.name ?? "", c.input ? JSON.stringify(c.input) : "");
    else if (e.type === "user") for (const c of e.message.content ?? []) console.log(s, "tool_result", JSON.stringify(c.content).slice(0, 200));
    else if (e.type === "result") { console.log(s, "RESULT", e.subtype, e.session_id, JSON.stringify(e.result), "cost", e.total_cost_usd, JSON.stringify(e.usage?.service_tier ?? "")); child.stdin.end(); }
    else if (e.type !== "stream_event" && !(e.type === "system" )) console.log(s, e.type, line.slice(0, 300));
  });
  child.on("exit", (c) => console.log("exit", c));
}
