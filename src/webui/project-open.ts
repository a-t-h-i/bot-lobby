import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { BackgroundSession, launchPi, sessionArgs } from "../lobby/sessions.ts";
import { detectProjectRoot } from "../state/project.ts";
import { HttpError } from "./api/index.ts";
import { listProjects, type ProjectRegistry } from "./projects.ts";
import { readableFolder } from "./project-folders.ts";
import type { ProjectInfo } from "./protocol.ts";

type ProjectProcess = Pick<BackgroundSession, "alive" | "stop" | "whenExited">;
type LaunchProject = (root: string) => ProjectProcess;

function launchProject(root: string): ProjectProcess {
  const name = basename(root) || root;
  const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
  const args = [...sessionArgs(name, undefined, []), "--no-approve", "--no-extensions", "--extension", extension];
  const proc = launchPi(args, root, { BOT_LOBBY_WEB_PROJECT: "1" });
  return new BackgroundSession(proc, { name, projectRoot: root, message: "/bot-lobby on" });
}

export class ProjectOpener {
  private readonly pending = new Map<string, Promise<ProjectInfo>>();
  private readonly children = new Set<ProjectProcess>();
  private closed = false;

  private readonly registry: ProjectRegistry;
  private readonly launch: LaunchProject;
  private readonly timeoutMs: number;

  constructor(registry: ProjectRegistry, launch: LaunchProject = launchProject, timeoutMs = 30_000) {
    this.registry = registry;
    this.launch = launch;
    this.timeoutMs = timeoutMs;
  }

  async open(path: string, cookie?: string): Promise<ProjectInfo> {
    const root = await readableFolder(detectProjectRoot(await readableFolder(path)));
    if (this.closed) throw new HttpError(503, "failed", "The project host is closing.");
    const pending = this.pending.get(root);
    if (pending) return pending;
    const opening = this.start(root, cookie).finally(() => this.pending.delete(root));
    this.pending.set(root, opening);
    return opening;
  }

  private async start(root: string, cookie?: string): Promise<ProjectInfo> {
    const existing = (await listProjects(this.registry, cookie)).find((project) => project.cwd === root);
    if (this.closed) throw new HttpError(503, "failed", "The project host is closing.");
    if (existing) return existing;
    if (this.children.size >= 8) throw new HttpError(409, "failed", "Eight project sessions are already open. Close a project session before opening another.");
    const child = this.launch(root);
    this.children.add(child);
    void child.whenExited().then(() => this.children.delete(child));
    try { return await this.waitForProject(root, child, cookie); }
    catch (error) { child.stop(); throw error; }
  }

  private async waitForProject(root: string, child: ProjectProcess, cookie?: string): Promise<ProjectInfo> {
    const deadline = Date.now() + this.timeoutMs;
    while (!this.closed && child.alive && Date.now() < deadline) {
      const project = (await listProjects(this.registry, cookie)).find((entry) => entry.cwd === root);
      if (project && child.alive && !this.closed) return project;
      await delay(100);
    }
    throw new HttpError(503, "failed", "The project did not start. Check that Pi and bot-lobby load successfully, then try again.");
  }

  close(): void {
    this.closed = true;
    for (const child of this.children) child.stop();
  }
}
