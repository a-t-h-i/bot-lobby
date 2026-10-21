/**
 * Whether each harness is installed, and its version, for the settings page.
 * The command is looked up on PATH without running it; only the CLIs with a
 * cheap `--version` are asked for one (Antigravity's ACP server is a large
 * bundle, so it is never started just to probe it, as T3 Code's
 * `AntigravityDriver.ts` also avoids).
 */
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { HARNESS_IDS, type HarnessId, type HarnessesConfig } from "../schemas/harness.ts";
import { HARNESSES, harnessCommand, harnessModels, type HarnessModel } from "./catalog.ts";

export interface HarnessStatus {
  id: HarnessId;
  label: string;
  blurb: string;
  protocol: string;
  /** The command a run starts, as the settings leave it. */
  command: string;
  /** Where it was found; absent when it was not. */
  path?: string;
  version?: string;
  providers: ReadonlyArray<{ value: string; label: string }>;
  effort: "flag" | "variant" | "session";
  models: HarnessModel[];
}

const VERSION_TIMEOUT_MS = 4000;
const CACHE_MS = 60_000;
const VERSIONED: ReadonlySet<HarnessId> = new Set(["codex", "claude", "gemini", "opencode"]);

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The file a command runs, from PATH (with Windows' extensions) unless it is a path already. */
export function findCommand(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!command) return undefined;
  if (isAbsolute(command) || command.includes("/")) return executable(command) ? command : undefined;
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, command + extension);
      if (executable(candidate)) return candidate;
    }
  }
  return undefined;
}

const versions = new Map<string, { at: number; version?: string }>();

function readVersion(path: string): Promise<string | undefined> {
  const cached = versions.get(path);
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.version);
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (version?: string) => {
      if (settled) return;
      settled = true;
      versions.set(path, { at: Date.now(), ...(version ? { version } : {}) });
      resolve(version);
    };
    try {
      const proc = spawn(path, ["--version"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, NO_COLOR: "1" } });
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        done();
      }, VERSION_TIMEOUT_MS);
      timer.unref();
      proc.stdout?.setEncoding("utf8");
      proc.stdout?.on("data", (chunk: string) => {
        if (out.length < 2000) out += chunk;
      });
      proc.on("error", () => done());
      proc.on("close", () => {
        clearTimeout(timer);
        done(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(out)?.[0]);
      });
    } catch {
      done();
    }
  });
}

/** Every harness with what the settings page shows about it. */
export async function harnessStatuses(harnesses: HarnessesConfig): Promise<HarnessStatus[]> {
  return Promise.all(HARNESS_IDS.map(async (id) => {
    const info = HARNESSES[id];
    const settings = harnesses[id];
    const { command } = harnessCommand(id, settings);
    const path = findCommand(command);
    const version = path && VERSIONED.has(id) ? await readVersion(path) : undefined;
    return {
      id,
      label: info.label,
      blurb: info.blurb,
      protocol: info.protocol,
      command,
      ...(path ? { path } : {}),
      ...(version ? { version } : {}),
      providers: info.providers,
      effort: info.effort,
      models: harnessModels(id, settings),
    };
  }));
}
