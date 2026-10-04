import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { applyBaseHeaders, HttpError, sendError } from "./api/index.ts";
import { browserSession, probeProject, scanProjects, type ProjectRegistry, type ProjectRecord } from "./projects.ts";

/** Only API and preview paths are project-owned; static files stay at entry. */
export function projectRoute(path: string): { id: string; path: string } | undefined {
  const match = /^\/projects\/([a-f0-9]{32})(\/(?:api\/[^/]+|files\/preview\/[^/]+\/[^/]+))$/.exec(path);
  if (!match) return undefined;
  return { id: match[1]!, path: match[2]! };
}

export async function gateway(req: IncomingMessage, res: ServerResponse, url: URL, registry: ProjectRegistry): Promise<URL | undefined> {
  const target = projectRoute(url.pathname);
  if (!target) throw new HttpError(404, "not_found", "no such project route");
  if (/^\/api\/(auth\.login|projects\.)/.test(target.path)) throw new HttpError(403, "forbidden", "entry-only call");
  if (target.id === registry.record.id) { url.pathname = target.path; return url; }
  const record = scanProjects(registry.dir).find((r) => r.id === target.id);
  if (!record) throw new HttpError(404, "not_found", "no such running project");
  const cookie = browserSession(req.headers.cookie);
  const health = await probeProject(record, cookie);
  if (health === "unauthorized") { sendError(res, "unauthorized", "open the link Pi printed", 401); return; }
  if (health !== "healthy") throw new HttpError(503, "failed", "the project is offline or changed");
  await proxy(req, res, record, target.path + url.search, cookie);
}

function requestHeaders(req: IncomingMessage, port: number, cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` };
  for (const name of ["content-type", "content-length", "accept", "last-event-id"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function responseHeaders(res: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  const hop = String(res.headers.connection ?? "").toLowerCase().split(",").map((name) => name.trim());
  for (const name of ["content-type", "content-length", "cache-control", "x-content-type-options"]) {
    const value = res.headers[name];
    if (typeof value === "string" && !hop.includes(name)) headers[name] = value;
  }
  return headers;
}

function proxy(req: IncomingMessage, res: ServerResponse, record: ProjectRecord, path: string, cookie?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const upstream = request({ hostname: "127.0.0.1", port: record.port, path, method: req.method,
      headers: requestHeaders(req, record.port, cookie) }, (response) => {
      if (response.headers["content-type"]?.startsWith("text/event-stream")) clearTimeout(timer);
      applyBaseHeaders(res);
      res.writeHead(response.statusCode ?? 503, responseHeaders(response));
      response.pipe(res);
      response.on("end", () => { clearTimeout(timer); resolve(); });
      response.on("error", fail);
    });
    const fail = () => { clearTimeout(timer); upstream.destroy(); reject(new HttpError(503, "failed", "the project is offline")); };
    const timer = setTimeout(fail, 5000);
    upstream.on("error", fail);
    res.on("close", () => { clearTimeout(timer); upstream.destroy(); resolve(); });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  });
}
