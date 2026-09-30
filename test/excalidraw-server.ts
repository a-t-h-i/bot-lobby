/**
 * Test doubles for Excalidraw's collaboration server and for a browser tab in
 * a room. The server is excalidraw-room's own handlers (join-room,
 * first-in-room, new-user, room-user-change, server-broadcast) on a local
 * socket.io server; the tab does what Excalidraw's `Portal` does: join when
 * told, answer a newcomer with its whole scene, and merge the updates it gets.
 * Real sockets, real binary framing and real encryption, so the seat is tested
 * against the wire and not against itself.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { seal, unseal } from "../src/excalidraw/room.ts";
import { mergeElements, type Scene, type SceneElement } from "../src/excalidraw/scene.ts";

export interface CollabServer {
  url: string;
  /** Every room message the server relayed, by event name. */
  relayed: string[];
  close(): Promise<void>;
}

/** excalidraw-room's handlers, unchanged in behaviour. */
export async function startCollabServer(): Promise<CollabServer> {
  const http: HttpServer = createServer();
  const server = new Server(http, { transports: ["websocket", "polling"], cors: { origin: "*" }, allowEIO3: true });
  const relayed: string[] = [];
  server.on("connection", (socket) => {
    server.to(`${socket.id}`).emit("init-room");
    socket.on("join-room", async (roomId: string) => {
      await socket.join(roomId);
      const sockets = await server.in(roomId).fetchSockets();
      if (sockets.length <= 1) server.to(`${socket.id}`).emit("first-in-room");
      else socket.broadcast.to(roomId).emit("new-user", socket.id);
      server.in(roomId).emit("room-user-change", sockets.map((entry) => entry.id));
    });
    socket.on("server-broadcast", (roomId: string, data: ArrayBuffer, iv: Uint8Array) => {
      relayed.push("server-broadcast");
      socket.broadcast.to(roomId).emit("client-broadcast", data, iv);
    });
    socket.on("server-volatile-broadcast", (roomId: string, data: ArrayBuffer, iv: Uint8Array) => {
      relayed.push("server-volatile-broadcast");
      socket.volatile.broadcast.to(roomId).emit("client-broadcast", data, iv);
    });
    socket.on("disconnecting", async () => {
      for (const roomId of socket.rooms) {
        const others = (await server.in(roomId).fetchSockets()).filter((entry) => entry.id !== socket.id);
        if (others.length > 0) socket.broadcast.to(roomId).emit("room-user-change", others.map((entry) => entry.id));
      }
    });
  });
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    relayed,
    close: () =>
      new Promise((done) => {
        void server.close(() => done());
      }),
  };
}

export interface Tab {
  scene: Scene;
  socket: Socket;
  /** Messages other than scene ones (cursor and idle updates), as they came. */
  others: Array<{ type: string; payload: Record<string, unknown> }>;
  /** How many scene messages (SCENE_INIT, SCENE_UPDATE) the tab has been sent. */
  sceneMessages: number;
  /** Resolves once the tab has joined and the server answered. */
  joined: Promise<void>;
  close(): void;
}

/**
 * A browser tab in a room. `elements` is what it already has on its board;
 * `firstInRoom` is what Excalidraw does with the room's saved board when it is
 * the first one there (here: it starts from `elements`).
 */
export function openTab(url: string, room: { roomId: string; roomKey: string }, elements: readonly SceneElement[] = []): Tab {
  const scene: Scene = new Map(elements.map((element) => [element.id, element]));
  const socket = io(url, { transports: ["websocket"], forceNew: true });
  const others: Tab["others"] = [];
  const tab = { sceneMessages: 0 };
  let joinedNow!: () => void;
  const joined = new Promise<void>((done) => (joinedNow = done));
  socket.on("init-room", () => socket.emit("join-room", room.roomId));
  socket.on("first-in-room", () => joinedNow());
  socket.on("room-user-change", () => joinedNow());
  socket.on("new-user", async () => {
    // Portal: SCENE_INIT with every element (syncAll).
    const sealed = await seal(room.roomKey, { type: "SCENE_INIT", payload: { elements: [...scene.values()] } });
    socket.emit("server-broadcast", room.roomId, sealed.data, sealed.iv);
  });
  socket.on("client-broadcast", async (data: unknown, iv: unknown) => {
    const message = (await unseal(room.roomKey, data, iv)) as { type: string; payload: Record<string, unknown> } | undefined;
    if (!message) return;
    if (message.type === "SCENE_UPDATE" || message.type === "SCENE_INIT") {
      tab.sceneMessages += 1;
      mergeElements(scene, message.payload.elements as unknown[]);
    } else others.push(message);
  });
  return {
    scene,
    socket,
    others,
    joined,
    get sceneMessages() {
      return tab.sceneMessages;
    },
    close: () => void socket.close(),
  };
}

/** Poll until `check` holds (the server and sockets are asynchronous), or fail with `what`. */
export async function until(check: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 15));
  }
}
