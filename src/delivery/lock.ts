import { constants, closeSync, fsyncSync, ftruncateSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface LockIdentity { taskId: string; projectRoot: string; configDir: string; operationId: string }
export interface LockOwner { token: string; pid: number; identity?: LockIdentity }
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
function owner(path: string): LockOwner | undefined {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    const value = JSON.parse(readFileSync(fd, "utf8")) as LockOwner;
    if (!Number.isInteger(value.pid) || value.pid <= 0 || typeof value.token !== "string" || !value.token) throw new Error("Invalid delivery lock owner.");
    return value;
  } finally { closeSync(fd); }
}
function removeOwned(path: string, token: string): void {
  if (owner(path)?.token === token) unlinkSync(path);
}
export type DeliveryLock = (() => void) & { setOperation(id: string): void };
function update(path: string, token: string, operationId: string): void {
  const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const value = JSON.parse(readFileSync(fd, "utf8")) as LockOwner;
    if (value.token !== token) throw new Error("Delivery lock ownership changed.");
    if (!value.identity) return;
    value.identity.operationId = operationId;
    const text = JSON.stringify(value);
    writeSync(fd, text, 0, "utf8"); ftruncateSync(fd, Buffer.byteLength(text)); fsyncSync(fd);
  } finally { closeSync(fd); }
}
function create(path: string, identity?: LockIdentity): DeliveryLock {
  const token = randomUUID();
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify({ token, pid: process.pid, identity })); fsyncSync(fd); }
  finally { closeSync(fd); }
  return Object.assign(() => removeOwned(path, token), { setOperation: (id: string) => update(path, token, id) });
}
function marker(path: string): void {
  const previous = owner(path);
  if (!previous) return;
  if (alive(previous.pid)) throw new Error("Delivery recovery is busy; wait and retry.");
  // A dead marker performed no publishing. Its token must still match before removal.
  removeOwned(path, previous.token);
}
/** Synchronous normal claims remain useful for callers that do not authorize recovery. */
export function acquireDeliveryLock(repository: string, identity?: LockIdentity): DeliveryLock {
  const path = join(realpathSync(repository), "dev-house-delivery-main.lock");
  if (owner(`${path}.recovery`)) throw new Error("Delivery recovery is busy; wait and retry.");
  try { const release = create(path, identity); if (owner(`${path}.recovery`)) { release(); throw new Error("Delivery recovery is busy."); } return release; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = owner(path);
    throw new Error(previous && alive(previous.pid) ? "Delivery is busy for this repository/main; wait and refresh." : "Interrupted delivery lock requires read-only recovery.");
  }
}
async function reclaim(path: string, previous: LockOwner, recover: (owner: LockOwner) => Promise<void>): Promise<void> {
  const release = create(`${path}.recovery`, previous.identity);
  try {
    const current = owner(path);
    if (current?.token !== previous.token || alive(current.pid)) throw new Error("Delivery owner changed; retry without recovery.");
    await recover(current);
    if (owner(path)?.token !== previous.token) throw new Error("Delivery owner changed during recovery.");
    removeOwned(path, previous.token);
  } finally { release(); }
}
/** Reconciliation is read-only; no request can bypass the exclusive recovery marker. */
export async function recoverDeliveryLock(repository: string, identity: LockIdentity | undefined, recover: (owner: LockOwner) => Promise<void>): Promise<DeliveryLock> {
  const path = join(realpathSync(repository), "dev-house-delivery-main.lock");
  marker(`${path}.recovery`);
  const previous = owner(path);
  if (previous && !alive(previous.pid)) await reclaim(path, previous, recover);
  return acquireDeliveryLock(repository, identity);
}
