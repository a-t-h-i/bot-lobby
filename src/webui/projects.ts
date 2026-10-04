import { randomBytes } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { basename, join } from "node:path";
import { globalConfigDir } from "../state/project.ts";
import { canonicalRoot } from "../state/previews.ts";
import type { ProjectInfo } from "./protocol.ts";

export interface ProjectRecord extends ProjectInfo { pid: number; startedAt: number }
export const PROJECT_ID = /^[a-f0-9]{32}$/;
export const registryDirectory = () => join(globalConfigDir(), "web-projects");
export const projectInfo = ({ id, name, cwd, port }: ProjectInfo): ProjectInfo => ({ id, name, cwd, port });

export function livePid(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function validRecord(r: ProjectRecord): boolean {
  return !!r && PROJECT_ID.test(r.id) && typeof r.name === "string" && typeof r.cwd === "string"
    && r.cwd === canonicalRoot(r.cwd) && Number.isInteger(r.port) && r.port > 0 && r.port <= 65535
    && Number.isInteger(r.pid) && r.pid > 0 && Number.isFinite(r.startedAt) && livePid(r.pid);
}

export function scanProjects(dir: string): ProjectRecord[] {
  let names: string[];
  try { names = readdirSync(dir).sort().slice(0, 128); } catch { return []; }
  return names.flatMap((name) => readRecord(dir, name) ?? []);
}

function readRecord(dir: string, name: string): ProjectRecord | undefined {
  if (!/^[a-f0-9]{32}\.json$/.test(name)) return undefined;
  try {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 16384) return undefined;
    const record = JSON.parse(readFileSync(path, "utf8")) as ProjectRecord;
    return validRecord(record) && name === `${record.id}.json` ? record : undefined;
  } catch { return undefined; }
}

export class ProjectRegistry {
  record: ProjectRecord;
  readonly dir: string;
  constructor(dir: string, root: string, port: number) {
    this.dir = dir;
    this.record = this.make(root, port);
    this.save();
  }
  private make(root: string, port: number): ProjectRecord {
    const cwd = canonicalRoot(root);
    return { id: randomBytes(16).toString("hex"), name: basename(cwd) || cwd, cwd, port, pid: process.pid, startedAt: Date.now() };
  }
  private save(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    writeFileSync(join(this.dir, `${this.record.id}.json`), JSON.stringify(this.record), { mode: 0o600, flag: "wx" });
  }
  rebind(root: string): void {
    const cwd = canonicalRoot(root);
    const previous = this.record;
    this.close();
    this.record = cwd === previous.cwd ? { ...previous, name: basename(cwd) || cwd } : this.make(cwd, previous.port);
    this.save();
  }
  close(): void { rmSync(join(this.dir, `${this.record.id}.json`), { force: true }); }
}

/** The only browser credential we relay; never forward arbitrary cookies. */
export function browserSession(cookie?: string): string | undefined {
  return cookie?.split(";").map((s) => s.trim()).find((s) => /^bl_session=[^;\s]+$/.test(s));
}

export function probeProject(record: ProjectRecord, cookie?: string): Promise<"healthy" | "unauthorized" | "offline"> {
  return new Promise((resolve) => {
    const req = request({ hostname: "127.0.0.1", port: record.port, path: "/api/projects.self", method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 16384) { resolve("offline"); req.destroy(); } else chunks.push(chunk); });
      res.on("end", () => resolve(probeResult(res.statusCode, Buffer.concat(chunks), record)));
      res.on("error", () => resolve("offline"));
    });
    const timer = setTimeout(() => { resolve("offline"); req.destroy(); }, 1000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => resolve("offline"));
    req.end("{}");
  });
}

function probeResult(status: number | undefined, bytes: Buffer, record: ProjectRecord): "healthy" | "unauthorized" | "offline" {
  if (status === 401) return "unauthorized";
  try {
    const reply = JSON.parse(bytes.toString());
    const p = reply.result?.project;
    return status === 200 && reply.ok === true && p?.id === record.id && p.cwd === record.cwd && p.port === record.port ? "healthy" : "offline";
  } catch { return "offline"; }
}

export function selectProjects(records: ProjectRecord[], local: ProjectRecord): ProjectInfo[] {
  const grouped = new Map<string, ProjectRecord>();
  for (const r of records.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))) {
    if (!grouped.has(r.cwd)) grouped.set(r.cwd, r);
  }
  grouped.set(local.cwd, local);
  return [...grouped.values()].map(projectInfo).sort((a, b) => a.name.localeCompare(b.name) || a.cwd.localeCompare(b.cwd));
}

export async function listProjects(registry: ProjectRegistry, cookie?: string): Promise<ProjectInfo[]> {
  const records = scanProjects(registry.dir);
  const healthy = await Promise.all(records.map(async (r) => await probeProject(r, cookie) === "healthy" ? r : undefined));
  return selectProjects(healthy.filter((r): r is ProjectRecord => !!r), registry.record);
}
