#!/usr/bin/env node
/**
 * The stdio MCP server a harness starts to reach Bot Lobby's tools. It holds
 * no logic: it connects to the Bot Lobby daemon (a local socket named in its
 * first argument), says which run it serves (the second argument, a token),
 * then passes MCP's JSON-RPC lines both ways. The daemon answers them.
 */
import { connect } from "node:net";

const [socketPath, token] = process.argv.slice(2);
if (!socketPath || !token) {
  process.stderr.write("bot-lobby mcp: usage: stdio.mjs <socket> <token>\n");
  process.exit(2);
}
const socket = connect(socketPath);
socket.on("connect", () => {
  socket.write(`${JSON.stringify({ bridge: token })}\n`);
  process.stdin.pipe(socket);
});
socket.pipe(process.stdout);
socket.on("close", () => process.exit(0));
socket.on("error", (error) => {
  process.stderr.write(`bot-lobby mcp: ${error.message}\n`);
  process.exit(1);
});
process.stdin.on("end", () => socket.end());
