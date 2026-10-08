import { constants } from "node:fs";
import { access, opendir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { HttpError } from "./api/index.ts";
import type { FolderListing } from "./protocol.ts";

export function folderPath(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "path")) {
    throw new HttpError(400, "bad_request", "send only a folder path");
  }
  const path = (body as { path?: unknown }).path;
  if (typeof path !== "string" || path.length > 4096 || path.includes("\0") || !isAbsolute(path)) {
    throw new HttpError(400, "bad_request", "choose an absolute folder path on the bot-lobby machine");
  }
  return path;
}

function folderError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") throw new HttpError(404, "not_found", "That folder does not exist.");
  if (code === "ENOTDIR") throw new HttpError(400, "bad_request", "That path is not a folder.");
  throw new HttpError(403, "forbidden", "That folder cannot be read. Check its permissions or choose another folder.");
}

export async function readableFolder(path: string): Promise<string> {
  try {
    const root = await realpath(path);
    if (!(await stat(root)).isDirectory()) throw new HttpError(400, "bad_request", "That path is not a folder.");
    await access(root, constants.R_OK | constants.X_OK);
    return root;
  } catch (error) { return folderError(error); }
}

async function directoryLink(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

export async function browseFolders(path: string): Promise<FolderListing> {
  const root = await readableFolder(path);
  const folders: FolderListing["folders"] = [];
  let seen = 0;
  try {
    for await (const entry of await opendir(root)) {
      if (++seen > 2000) break;
      if (entry.isDirectory() || (entry.isSymbolicLink() && await directoryLink(join(root, entry.name)))) {
        folders.push({ name: entry.name, path: join(root, entry.name) });
      }
    }
  } catch (error) { return folderError(error); }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { path: root, parent: dirname(root) === root ? undefined : dirname(root), folders, truncated: seen > 2000 };
}
