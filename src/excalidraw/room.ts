/**
 * Excalidraw's shared-session ("live collaboration") rooms, the parts that do
 * not touch the network: reading and making room links, and the AES-GCM
 * envelope every message in a room travels in. Excalidraw's collaboration
 * server only relays opaque bytes; the key sits in the link's `#room=id,key`
 * fragment, which a browser never sends to any server, so whoever holds the
 * link can read and draw in the room and nobody else can.
 */
import { randomBytes, webcrypto } from "node:crypto";

/** Excalidraw's own collaboration server; `BOT_LOBBY_EXCALIDRAW_SERVER` points at a self-hosted one. */
export const DEFAULT_SERVER = "https://oss-collab.excalidraw.com";

/** The site a made-up room link opens on. */
export const DEFAULT_ORIGIN = "https://excalidraw.com";

const ROOM_ID = /^[a-zA-Z0-9_-]+$/;
/** A 128-bit key in base64url is exactly 22 characters. */
const ROOM_KEY = /^[a-zA-Z0-9_-]{22}$/;
const FRAGMENT = /#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/;
const IV_BYTES = 12;

export interface RoomLink {
  roomId: string;
  roomKey: string;
  /** The link as Excalidraw writes it: `https://excalidraw.com/#room=<id>,<key>`. */
  url: string;
}

/**
 * A room link as people paste it: the full URL (any Excalidraw host, so a
 * self-hosted one works), `#room=id,key`, or the bare `id,key`. Undefined when
 * it is none of those or the key is not the 22 characters Excalidraw makes.
 */
export function parseRoomLink(input: string): RoomLink | undefined {
  const text = input.trim();
  if (!text) return undefined;
  let roomId: string | undefined;
  let roomKey: string | undefined;
  let origin = DEFAULT_ORIGIN;
  const fragment = text.match(FRAGMENT);
  if (fragment) {
    [, roomId, roomKey] = fragment;
    const before = text.slice(0, fragment.index);
    if (before) {
      try {
        const parsed = new URL(before);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") origin = `${parsed.origin}${parsed.pathname === "/" ? "" : parsed.pathname}`;
        else return undefined;
      } catch {
        return undefined;
      }
    }
  } else {
    const bare = text.match(/^([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/);
    if (!bare) return undefined;
    [, roomId, roomKey] = bare;
  }
  if (!roomId || !roomKey || !ROOM_ID.test(roomId) || !ROOM_KEY.test(roomKey)) return undefined;
  return { roomId, roomKey, url: `${origin.replace(/\/$/, "")}/#room=${roomId},${roomKey}` };
}

/** A fresh room: opening its link in Excalidraw starts the session, and the room is the first thing in it. */
export function newRoomLink(origin = DEFAULT_ORIGIN): RoomLink {
  const roomId = randomBytes(10).toString("hex");
  const roomKey = randomBytes(16).toString("base64url");
  return { roomId, roomKey, url: `${origin.replace(/\/$/, "")}/#room=${roomId},${roomKey}` };
}

/** The link with its key hidden, for logs and lists. */
export function maskedLink(link: RoomLink): string {
  return `room ${link.roomId}`;
}

const keys = new Map<string, Promise<webcrypto.CryptoKey>>();

function cryptoKey(roomKey: string, usage: "encrypt" | "decrypt"): Promise<webcrypto.CryptoKey> {
  const id = `${usage}:${roomKey}`;
  let key = keys.get(id);
  if (!key) {
    key = webcrypto.subtle.importKey("jwk", { alg: "A128GCM", ext: true, k: roomKey, key_ops: ["encrypt", "decrypt"], kty: "oct" }, { name: "AES-GCM", length: 128 }, false, [usage]);
    keys.set(id, key);
    if (keys.size > 32) keys.delete(keys.keys().next().value!);
  }
  return key;
}

export interface Sealed {
  data: Buffer;
  iv: Buffer;
}

/** A message as Excalidraw sends it: the JSON of `payload`, encrypted with a fresh IV. */
export async function seal(roomKey: string, payload: unknown): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(roomKey, "encrypt"), new TextEncoder().encode(JSON.stringify(payload)));
  return { data: Buffer.from(encrypted), iv };
}

function bytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}

/** What `seal` made, opened; undefined when it is not ours to read (a wrong key, a damaged message). */
export async function unseal(roomKey: string, data: unknown, iv: unknown): Promise<unknown> {
  const body = bytes(data);
  const nonce = bytes(iv);
  if (!body || !nonce) return undefined;
  try {
    const opened = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await cryptoKey(roomKey, "decrypt"), body);
    return JSON.parse(new TextDecoder().decode(opened));
  } catch {
    return undefined;
  }
}
