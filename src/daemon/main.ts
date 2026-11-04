#!/usr/bin/env -S node --experimental-strip-types
/**
 * `bot-lobby serve [--project <folder>] [--port <n>]`: Bot Lobby on its own,
 * with no pi. It owns the project's state, the master, the workflow, the HTTP
 * API and event stream the herdr mod reads, and drives the Orchestrator on an
 * installed coding agent. One daemon per project folder: a second `serve`
 * for the same folder prints the running one's port and exits.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import registerEngine from "../index.ts";
import { CONFIG_DIR_NAME } from "../host/api.ts";
import { dataRoot, detectProjectRoot, loadConfig } from "../state/project.ts";
import { currentWebServer } from "../webui/server.ts";
import { DaemonHost } from "./host.ts";
import { orchestratorDriver, pickOrchestrator } from "./harness-pick.ts";
import { log } from "./log.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { migrateData } from "./migrate.ts";
import { reportState } from "./herdr-status.ts";

interface Args {
  command: string;
  project: string;
  port?: number;
}

const USAGE = "usage: bot-lobby serve [--project <folder>] [--port <n>]";

function parseArgs(argv: string[]): Args {
  const [command = "serve", ...rest] = argv;
  const out: Args = { command, project: process.cwd() };
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index];
    if (word === "--project") out.project = resolve(rest[++index] ?? ".");
    else if (word === "--port") out.port = Number(rest[++index]);
    else if (word === "-h" || word === "--help") out.command = "help";
    else throw new Error(`unknown argument ${word}\n${USAGE}`);
  }
  return out;
}

function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "?";
  } catch {
    return "?";
  }
}

async function serve(args: Args): Promise<void> {
  process.env.BOT_LOBBY_DAEMON = "1";
  const root = detectProjectRoot(args.project, CONFIG_DIR_NAME);
  const migrated = migrateData(root);
  for (const line of migrated) log(line);
  const lock = acquireLock(root);
  if (lock.running) {
    process.stdout.write(`bot-lobby: already running for ${root} on http://127.0.0.1:${lock.running.port}\n`);
    return;
  }
  const config = loadConfig();
  if (args.port !== undefined && Number.isInteger(args.port) && args.port > 0) process.env.BOT_LOBBY_PORT = String(args.port);
  const host = new DaemonHost({
    cwd: args.project,
    sessionDir: join(dataRoot(root, CONFIG_DIR_NAME), "chats"),
    driver: () => orchestratorDriver(loadConfig(), args.project),
  });
  registerEngine(host);
  reportState(host);
  const harness = pickOrchestrator(config);
  log(`v${version()} in ${root}; orchestrator: ${harness ?? "none (install Claude Code)"}`);
  await host.start("startup");
  const server = await waitForServer();
  if (!server) {
    log("the web API did not start; see the notices above");
    releaseLock(root);
    process.exitCode = 1;
    return;
  }
  lock.write(server.port);
  process.stdout.write(`bot-lobby: http://127.0.0.1:${server.port}\n`);
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`stopping (${signal})`);
    try {
      await host.shutdown();
      await currentWebServer()?.close();
    } finally {
      releaseLock(root);
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

/** The web server starts on session_start; wait for it to listen (it reports its port). */
async function waitForServer(): Promise<{ port: number } | undefined> {
  for (let tries = 0; tries < 100; tries += 1) {
    const running = currentWebServer();
    if (running?.port) return { port: running.port };
    await new Promise((done) => setTimeout(done, 50));
  }
  return undefined;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.command === "help") return void process.stdout.write(`${USAGE}\n`);
  if (args.command === "version" || args.command === "--version") return void process.stdout.write(`bot-lobby ${version()}\n`);
  if (args.command !== "serve") {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (!existsSync(args.project)) {
    process.stderr.write(`bot-lobby: no folder ${args.project}\n`);
    process.exitCode = 2;
    return;
  }
  await serve(args);
}

void main();
