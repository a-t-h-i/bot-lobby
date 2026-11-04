/**
 * The Orchestrator's state for herdr's agents list. When the daemon runs in
 * a herdr terminal (`HC_TERMINAL_ID` set, stdout a TTY) it reports with OSC
 * 7501: working while a turn or a task runs, blocked while a question waits
 * on the person, done when a turn ends, idle at shutdown.
 */
import type { DaemonHost } from "./host.ts";
import { promptHub } from "../lobby/prompt-hub.ts";

type State = "working" | "blocked" | "done" | "idle";

let last: State | undefined;

function write(state: State): void {
  if (state === last) return;
  last = state;
  if (!process.env.HC_TERMINAL_ID || !process.stdout.isTTY) return;
  process.stdout.write(`\x1b]7501;state=${state}:app=bot-lobby\x1b\\`);
}

export function reportState(host: DaemonHost): void {
  let busy = false;
  const refresh = () => write(promptHub.pending().length > 0 ? "blocked" : busy ? "working" : "done");
  host.on("agent_start", () => {
    busy = true;
    refresh();
  });
  host.on("agent_settled", () => {
    busy = false;
    refresh();
  });
  host.on("session_shutdown", () => write("idle"));
  promptHub.onChange(refresh);
}
