/**
 * Open a URL in the platform's browser: Termux, macOS, Windows or Linux.
 * Over an SSH session there is no browser to open, so nothing is attempted.
 * Detached, errors ignored, never throws: true when a browser was attempted.
 */
import { spawn } from "node:child_process";

export interface OpenDeps {
  spawn?: typeof spawn;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function launch(run: typeof spawn, command: string, args: string[]): boolean {
  try {
    const child = run(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Open `url` in the desktop browser; false when none was attempted. */
export function openBrowser(url: string, deps?: OpenDeps): boolean {
  const run = deps?.spawn ?? spawn;
  const env = deps?.env ?? process.env;
  const platform = deps?.platform ?? process.platform;
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (env.TERMUX_VERSION) return launch(run, "termux-open-url", [url]);
  if (platform === "darwin") return launch(run, "open", [url]);
  if (platform === "win32") return launch(run, "cmd", ["/c", "start", '""', url]);
  return launch(run, "xdg-open", [url]);
}
