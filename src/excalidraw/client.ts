/**
 * One agent's seat in an Excalidraw shared session. It joins the room the way
 * a second browser tab would: over Excalidraw's collaboration socket, sending
 * and receiving the encrypted scene messages every client in the room sends.
 * Others in the room answer a newcomer with the whole scene, so a seat learns
 * the board from whoever is there; what the agent draws goes out as an update
 * that every browser merges in place, under the agent's name.
 *
 * A seat never answers a newcomer with a scene it does not have: a browser
 * that took an empty scene from an agent would skip loading the board it saved
 * itself. And it does not draw while nobody else is in the room, because
 * nothing keeps a scene for a room but the browsers in it.
 */
import { io, type Socket } from "socket.io-client";
import { DEFAULT_SERVER, seal, unseal, type RoomLink } from "./room.ts";
import { describeScene, mergeElements, plainText, planDraw, sceneBounds, visible, type DrawOutcome, type DrawRequest, type Scene, type SceneElement } from "./scene.ts";

/** The part of a socket.io client a seat uses; tests and other transports can stand in for it. */
export type SocketLike = Pick<Socket, "on" | "emit" | "close" | "connected"> & { id?: string | undefined };

export interface RoomOptions {
  link: Pick<RoomLink, "roomId" | "roomKey">;
  /** The name other people see next to this seat's cursor. */
  username: string;
  /** The session's name in the lobby, for readings and messages. */
  name: string;
  server?: string;
  connect?: (server: string) => SocketLike;
  /** Give up on reaching the server after this long. */
  connectTimeoutMs?: number;
  /** How long to wait for a collaborator to send the scene (Excalidraw's own client waits five seconds). */
  sceneWaitMs?: number;
}

export interface RoomStatus {
  connected: boolean;
  /** Others in the room, people and agents, not counting this seat. */
  peers: number;
  /** A collaborator has sent the whole scene. */
  synced: boolean;
  elements: number;
  /** Messages that would not open: the link's key does not match the room's. */
  undecryptable: number;
  /** Names the collaborators have given themselves. */
  people: string[];
}

const CONNECT_TIMEOUT_MS = 10_000;
const SCENE_WAIT_MS = 5000;
/** The collaboration server relays at most a megabyte a message; a scene near that is not sent whole. */
const MAX_MESSAGE_CHARS = 900_000;

function defaultConnect(server: string): SocketLike {
  return io(server, { transports: ["websocket", "polling"], autoUnref: true, timeout: 8000 });
}

export function collaborationServer(env: NodeJS.ProcessEnv = process.env): string {
  return env.BOT_LOBBY_EXCALIDRAW_SERVER?.trim() || DEFAULT_SERVER;
}

export class ExcalidrawRoom {
  readonly scene: Scene = new Map();
  private readonly options: RoomOptions;
  private socket: SocketLike | undefined;
  private opening: Promise<RoomStatus> | undefined;
  private peerIds: string[] = [];
  private readonly names = new Map<string, string>();
  private synced = false;
  private undecryptable = 0;
  private closed = false;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(options: RoomOptions) {
    this.options = options;
  }

  get name(): string {
    return this.options.name;
  }

  /** Which room this seat is in; a seat is replaced when its session's link changes. */
  get linkKey(): string {
    return `${this.options.link.roomId},${this.options.link.roomKey}`;
  }

  status(): RoomStatus {
    return {
      connected: this.socket?.connected ?? false,
      peers: this.peerIds.length,
      synced: this.synced,
      elements: visible(this.scene).length,
      undecryptable: this.undecryptable,
      people: [...new Set(this.peerIds.map((id) => this.names.get(id)).filter((name): name is string => Boolean(name)))],
    };
  }

  /** Join the room (once) and wait until a collaborator has sent the scene, or the wait for it is over. */
  ready(): Promise<RoomStatus> {
    this.opening ??= this.open();
    return this.opening;
  }

  private open(): Promise<RoomStatus> {
    return new Promise((resolve, reject) => {
      // A seat that failed to connect once may try again.
      this.closed = false;
      const { roomId } = this.options.link;
      const server = this.options.server ?? collaborationServer();
      const socket = (this.options.connect ?? defaultConnect)(server);
      this.socket = socket;
      let done = false;
      let lastError = "";
      const settle = () => {
        if (done) return;
        done = true;
        resolve(this.status());
        this.announce();
      };
      this.timers.push(
        setTimeout(() => {
          if (done) return;
          done = true;
          this.opening = undefined;
          this.close();
          reject(new Error(`could not reach the Excalidraw collaboration server ${server}${lastError ? ` (${lastError})` : ""}`));
        }, this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS),
      );
      socket.on("connect_error", (error: Error) => {
        lastError = error.message;
      });
      // Every (re)connection is greeted with init-room; the seat answers by joining.
      socket.on("init-room", () => {
        socket.emit("join-room", roomId);
        this.timers.push(setTimeout(settle, this.options.sceneWaitMs ?? SCENE_WAIT_MS));
      });
      socket.on("first-in-room", () => settle());
      socket.on("room-user-change", (clients: string[]) => {
        this.peerIds = clients.filter((id) => id !== socket.id);
        for (const id of [...this.names.keys()]) if (!clients.includes(id)) this.names.delete(id);
      });
      socket.on("new-user", () => {
        // What this seat does not know, it does not claim to.
        if (this.synced || visible(this.scene).length > 0) void this.send("SCENE_INIT", [...this.scene.values()]);
      });
      socket.on("client-broadcast", (data: unknown, iv: unknown) => {
        void this.receive(data, iv).then((initial) => {
          if (initial) settle();
        });
      });
    });
  }

  /** A received message; true when it was the scene a newcomer is waiting for. */
  private async receive(data: unknown, iv: unknown): Promise<boolean> {
    const message = (await unseal(this.options.link.roomKey, data, iv)) as { type?: string; payload?: Record<string, unknown> } | undefined;
    if (!message || typeof message !== "object") {
      this.undecryptable += 1;
      return false;
    }
    const payload = message.payload ?? {};
    switch (message.type) {
      case "SCENE_INIT":
      case "SCENE_UPDATE":
        if (Array.isArray(payload.elements)) mergeElements(this.scene, payload.elements);
        if (message.type === "SCENE_INIT") this.synced = true;
        return message.type === "SCENE_INIT";
      case "MOUSE_LOCATION":
      case "IDLE_STATUS":
        if (typeof payload.socketId === "string" && typeof payload.username === "string" && plainText(payload.username)) this.names.set(payload.socketId, plainText(payload.username).slice(0, 40));
        return false;
      default:
        return false;
    }
  }

  /** Send a scene message to the room; false when the seat is not connected. */
  private async send(type: "SCENE_INIT" | "SCENE_UPDATE" | "IDLE_STATUS" | "MOUSE_LOCATION", body: unknown): Promise<boolean> {
    const socket = this.socket;
    if (!socket?.connected || this.closed) return false;
    const payload = type === "SCENE_INIT" || type === "SCENE_UPDATE" ? { elements: body } : body;
    if (JSON.stringify(payload).length > MAX_MESSAGE_CHARS) return false;
    const sealed = await seal(this.options.link.roomKey, { type, payload });
    socket.emit("server-broadcast", this.options.link.roomId, sealed.data, sealed.iv);
    return true;
  }

  /**
   * Tell the room who this seat is (its collaborator name), and where it just
   * drew. Excalidraw sends these as volatile messages because it sends them
   * constantly; a seat says it once, so it does not let the server drop it.
   */
  private announce(near?: { x: number; y: number }): void {
    const socketId = this.socket?.id;
    if (!socketId) return;
    void this.send("IDLE_STATUS", { socketId, userState: "active", username: this.options.username });
    if (near) void this.send("MOUSE_LOCATION", { socketId, pointer: { x: near.x, y: near.y, tool: "pointer" }, button: "up", selectedElementIds: {}, username: this.options.username });
  }

  /** Why nothing may be drawn right now, or undefined when it may. */
  cannotDraw(): string | undefined {
    if (!this.socket?.connected) return "this seat is not connected to the room";
    if (this.peerIds.length === 0) return "nobody else is in the room, and only a browser keeps a room's board; ask the user to open the session's link in Excalidraw, then try again";
    return undefined;
  }

  /** Draw: the elements go out to the room and into this seat's own scene. */
  async draw(request: DrawRequest): Promise<DrawOutcome> {
    const outcome = planDraw(this.scene, request);
    if (outcome.changed.length === 0) return outcome;
    const reason = this.cannotDraw();
    if (reason) return { ...outcome, changed: [], drawn: [], removed: [], problems: [...outcome.problems, reason] };
    for (const element of outcome.changed) this.scene.set(element.id, element);
    await this.send("SCENE_UPDATE", outcome.changed);
    const around = sceneBounds(outcome.changed.filter((element) => !element.isDeleted));
    this.announce(around ? { x: around.x1, y: around.y1 } : undefined);
    return outcome;
  }

  /** The board in words, for a model, with what is known about the room around it. */
  read(): string {
    const status = this.status();
    const notes: string[] = [];
    if (!status.connected) notes.push("Not connected to the room right now; this is the board as last seen.");
    else if (status.undecryptable > 0 && status.elements === 0) notes.push("Messages in this room would not open: the session link's key does not match the room's, so it may have been copied incompletely.");
    else if (status.peers === 0) notes.push("Nobody else is in the room, so the board above is not known: ask the user to open the session's link in Excalidraw, then read again.");
    else if (!status.synced) notes.push("No collaborator has sent the whole board yet, so this may be incomplete; read again in a few seconds.");
    if (status.peers > 0) notes.push(`In the room with you: ${status.people.length > 0 ? status.people.join(", ") : `${status.peers} other${status.peers === 1 ? "" : "s"}`}.`);
    return [describeScene(this.scene, this.options.name), ...notes].join("\n");
  }

  elements(): SceneElement[] {
    return visible(this.scene);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.socket?.close();
  }
}

/** The seats an agent has open, one per session, kept for the length of its run. */
export class RoomPool {
  private readonly rooms = new Map<string, ExcalidrawRoom>();
  private readonly make: (options: RoomOptions) => ExcalidrawRoom;

  constructor(make: (options: RoomOptions) => ExcalidrawRoom = (options) => new ExcalidrawRoom(options)) {
    this.make = make;
  }

  /** The seat for a session, opened on first use; a session whose link changed gets a new seat. */
  room(key: string, options: RoomOptions): ExcalidrawRoom {
    const existing = this.rooms.get(key);
    if (existing && existing.linkKey === `${options.link.roomId},${options.link.roomKey}`) return existing;
    existing?.close();
    const room = this.make(options);
    this.rooms.set(key, room);
    return room;
  }

  closeAll(): void {
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
  }
}
