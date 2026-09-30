import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { ExcalidrawRoom, connectFailure, proxyFor } from "../src/excalidraw/client.ts";
import { newRoomLink, parseRoomLink, seal, unseal } from "../src/excalidraw/room.ts";
import { planDraw, type SceneElement } from "../src/excalidraw/scene.ts";
import { openTab, startCollabServer, until } from "./excalidraw-server.ts";

const KEY = "AbCdEfGhIjKlMnOpQrStUv";

test("room links: the full URL, the fragment and the bare pair all read; anything else does not", () => {
  const full = parseRoomLink(`https://excalidraw.com/#room=0123456789abcdef0123,${KEY}`);
  assert.deepEqual([full?.roomId, full?.roomKey], ["0123456789abcdef0123", KEY]);
  assert.equal(full?.url, `https://excalidraw.com/#room=0123456789abcdef0123,${KEY}`);
  assert.equal(parseRoomLink(`#room=abc,${KEY}`)?.roomId, "abc");
  assert.equal(parseRoomLink(`abc,${KEY}`)?.url, `https://excalidraw.com/#room=abc,${KEY}`);
  assert.equal(parseRoomLink(`  https://draw.example.org/#room=abc,${KEY}  `)?.url, `https://draw.example.org/#room=abc,${KEY}`, "a self-hosted Excalidraw keeps its host");
  for (const bad of ["", "https://excalidraw.com/", "https://excalidraw.com/#room=abc", `https://excalidraw.com/#room=abc,short`, `https://excalidraw.com/#room=a b,${KEY}`, `ftp://x.org/#room=abc,${KEY}`, "not a link"]) {
    assert.equal(parseRoomLink(bad), undefined, `"${bad}" is not a room link`);
  }
});

test("a new room's link reads back, and no two are alike", () => {
  const first = newRoomLink();
  assert.deepEqual(parseRoomLink(first.url), first);
  assert.equal(first.roomKey.length, 22);
  assert.notEqual(newRoomLink().roomId, first.roomId);
});

test("the envelope is Excalidraw's: AES-128-GCM over the JSON, the tag after the ciphertext, a 12-byte IV", async () => {
  const sealed = await seal(KEY, { type: "SCENE_UPDATE", payload: { elements: [] } });
  assert.equal(sealed.iv.length, 12);
  // Decrypted by a second implementation, from the bare key bytes.
  const key = Buffer.from(KEY, "base64url");
  assert.equal(key.length, 16);
  const tag = sealed.data.subarray(sealed.data.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", key, sealed.iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(sealed.data.subarray(0, sealed.data.length - 16)), decipher.final()]).toString("utf8");
  assert.deepEqual(JSON.parse(plain), { type: "SCENE_UPDATE", payload: { elements: [] } });
  assert.deepEqual(await unseal(KEY, sealed.data, sealed.iv), { type: "SCENE_UPDATE", payload: { elements: [] } });
  assert.equal(await unseal("ZyXwVuTsRqPoNmLkJiHgFe", sealed.data, sealed.iv), undefined, "another key cannot open it");
  assert.equal(await unseal(KEY, sealed.data.subarray(1), sealed.iv), undefined, "a damaged message does not open");
});

function seat(url: string, link: { roomId: string; roomKey: string }, username = "Backend · bot-lobby", extra: { sceneWaitMs?: number; connectTimeoutMs?: number } = {}): ExcalidrawRoom {
  return new ExcalidrawRoom({ link, username, name: "Board", server: url, sceneWaitMs: 400, ...extra });
}

function box(id: string, text: string, x: number, y: number): SceneElement[] {
  return planDraw(new Map(), { shapes: [{ id, type: "rectangle", text, x, y }] }).changed;
}

test("a seat joining a room with a browser in it learns the board the browser has", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const tab = openTab(server.url, link, box("api", "API gateway", 100, 80));
  await tab.joined;
  const room = seat(server.url, link);
  try {
    const status = await room.ready();
    assert.equal(status.synced, true);
    assert.equal(status.peers, 1);
    assert.match(room.read(), /rectangle "API gateway" id=api at 100,80/);
    assert.match(room.read(), /In the room with you: 1 other\./);
  } finally {
    room.close();
    tab.close();
    await server.close();
  }
});

test("what a seat draws reaches the browser's board, labelled and joined by an arrow", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const tab = openTab(server.url, link, box("api", "API gateway", 100, 80));
  await tab.joined;
  const room = seat(server.url, link);
  try {
    await room.ready();
    const outcome = await room.draw({
      shapes: [
        { id: "db", type: "ellipse", text: "Database", x: 400, y: 80, fill: "blue" },
        { id: "link", type: "arrow", from: "api", to: "db", text: "SQL" },
      ],
    });
    assert.deepEqual(outcome.problems, []);
    await until(() => [...tab.scene.values()].some((element) => element.id === "link"), "the arrow to reach the tab");
    const board = [...tab.scene.values()].filter((element) => !element.isDeleted);
    // The tab's own shape and its label, the database and its label, the arrow and its label.
    assert.equal(board.length, 6);
    assert.equal(board.find((element) => element.id === "db")?.backgroundColor, "#a5d8ff");
    assert.ok(tab.scene.get("api")!.boundElements?.some((entry) => entry.id === "link" && entry.type === "arrow"));
    assert.ok(tab.scene.get("api")!.version > 1, "the shape the arrow joined was updated, so the tab takes it");
    const arrow = tab.scene.get("link")!;
    assert.deepEqual([(arrow.startBinding as { elementId: string }).elementId, (arrow.endBinding as { elementId: string }).elementId], ["api", "db"]);
    // The room sees who drew: a named collaborator.
    await until(() => tab.others.some((message) => message.type === "IDLE_STATUS"), "the seat to announce itself");
    assert.equal(tab.others.find((message) => message.type === "IDLE_STATUS")!.payload.username, "Backend · bot-lobby");
    await until(() => tab.others.some((message) => message.type === "MOUSE_LOCATION"), "a cursor where it drew");
    const cursor = tab.others.find((message) => message.type === "MOUSE_LOCATION")!.payload;
    assert.deepEqual([cursor.username, (cursor.pointer as { x: number }).x], ["Backend · bot-lobby", 100], "at the top left of what it drew");
  } finally {
    room.close();
    tab.close();
    await server.close();
  }
});

test("an update the browser makes after the seat joined is merged, and the seat's next edit wins over the old version", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const tab = openTab(server.url, link, box("api", "API gateway", 100, 80));
  await tab.joined;
  const room = seat(server.url, link);
  try {
    await room.ready();
    const moved = { ...tab.scene.get("api")!, x: 500, version: 2, versionNonce: 7 };
    const sealed = await seal(link.roomKey, { type: "SCENE_UPDATE", payload: { elements: [moved] } });
    tab.socket.emit("server-broadcast", link.roomId, sealed.data, sealed.iv);
    await until(() => room.scene.get("api")?.x === 500, "the browser's move to reach the seat");
    await room.draw({ shapes: [{ id: "api", x: 700 }] });
    await until(() => tab.scene.get("api")?.x === 700, "the seat's move to reach the browser");
    assert.equal(tab.scene.get("api")!.version, 3, "one version past the browser's own");
  } finally {
    room.close();
    tab.close();
    await server.close();
  }
});

test("a browser that joins after the seat drew gets the board from the seat", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const first = openTab(server.url, link);
  await first.joined;
  const room = seat(server.url, link);
  let late: ReturnType<typeof openTab> | undefined;
  try {
    await room.ready();
    await room.draw({ shapes: [{ id: "note", type: "text", text: "hello", x: 0, y: 0 }] });
    first.close();
    await until(() => room.status().peers === 0, "the first tab to leave");
    // A second tab joins while the seat, which has the board, is the only one there: it takes the seat's scene.
    late = openTab(server.url, link);
    await until(() => late!.scene.has("note"), "the late tab to take the seat's scene");
  } finally {
    late?.close();
    room.close();
    await server.close();
  }
});

test("a seat that alone knows nothing does not hand a joining browser an empty board", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const room = seat(server.url, link, "Backend · bot-lobby", { sceneWaitMs: 200 });
  let tab: ReturnType<typeof openTab> | undefined;
  try {
    const status = await room.ready();
    assert.equal(status.peers, 0);
    assert.equal(status.synced, false);
    assert.match(room.read(), /Nobody else is in the room/);
    // The browser comes second, with the board it saved earlier.
    tab = openTab(server.url, link, box("saved", "Saved earlier", 0, 0));
    await tab.joined;
    await until(() => room.status().peers === 1, "the tab to be seen");
    // The tab was not sent an (empty) scene by the seat, so it keeps the board it came with.
    await new Promise((done) => setTimeout(done, 150));
    assert.ok(tab.scene.has("saved"));
    assert.equal(tab.scene.size, 2, "its shape and label, and nothing from the seat");
    assert.equal(tab.sceneMessages, 0, "the seat sent it no scene at all");
  } finally {
    room.close();
    tab?.close();
    await server.close();
  }
});

test("nothing is drawn while nobody else is in the room, and the reason says what to do", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const room = seat(server.url, link, "Backend · bot-lobby", { sceneWaitMs: 200 });
  try {
    await room.ready();
    const outcome = await room.draw({ shapes: [{ id: "a", type: "rectangle" }] });
    assert.equal(outcome.changed.length, 0);
    assert.match(outcome.problems.join(" "), /ask the user to open the session's link in Excalidraw/);
    assert.equal(room.elements().length, 0, "the scene keeps nothing that never went out");
    assert.equal(server.relayed.length, 0);
  } finally {
    room.close();
    await server.close();
  }
});

test("a link with the wrong key is told apart from an empty room", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const tab = openTab(server.url, link, box("api", "API gateway", 100, 80));
  await tab.joined;
  const room = seat(server.url, { roomId: link.roomId, roomKey: "ZyXwVuTsRqPoNmLkJiHgFe" });
  try {
    await room.ready();
    await until(() => room.status().undecryptable > 0, "the seat to see messages it cannot open");
    assert.match(room.read(), /key does not match/);
  } finally {
    room.close();
    tab.close();
    await server.close();
  }
});

test("a server that cannot be reached is reported with what was tried, and why", async () => {
  const room = new ExcalidrawRoom({ link: newRoomLink(), username: "x", name: "Board", server: "http://127.0.0.1:1", connectTimeoutMs: 1500 });
  await assert.rejects(room.ready(), /could not reach the Excalidraw collaboration server http:\/\/127\.0\.0\.1:1 \(connect ECONNREFUSED 127\.0\.0\.1:1: check the network/);
  room.close();
});

test("socket.io's bare 'websocket error' and 'xhr poll error' are turned into their causes", () => {
  const websocket = (message: string, code?: string) => Object.assign(new Error("websocket error"), { type: "TransportError", description: { message, error: { code } } });
  assert.equal(connectFailure(websocket("Unexpected server response: 403")), "the connection was refused with HTTP 403");
  assert.match(connectFailure(websocket("getaddrinfo ENOTFOUND oss-collab.excalidraw.com", "ENOTFOUND")), /^getaddrinfo ENOTFOUND oss-collab\.excalidraw\.com: the server's name did not resolve/);
  assert.match(connectFailure(websocket("unable to get local issuer certificate")), /intercepting HTTPS; NODE_EXTRA_CA_CERTS/);
  const polled = (status: number, responseText: string) => Object.assign(new Error("xhr poll error"), { type: "TransportError", description: status, context: { status, responseText } });
  assert.equal(connectFailure(polled(502, "Bad gateway")), "the connection was refused with HTTP 502");
  assert.match(connectFailure(polled(0, "Error: connect ETIMEDOUT 1.2.3.4:443\n    at TCPConnectWrap")), /^connect ETIMEDOUT 1\.2\.3\.4:443: check the network, or set HTTPS_PROXY/);
  assert.equal(connectFailure(new Error("timeout")), "timeout");
});

test("a proxy is used as the environment says, and NO_PROXY is honoured", () => {
  const server = "https://oss-collab.excalidraw.com";
  assert.equal(proxyFor(server, {}), undefined);
  assert.equal(proxyFor(server, { HTTPS_PROXY: "http://proxy.lan:3128" }), "http://proxy.lan:3128");
  assert.equal(proxyFor(server, { https_proxy: "proxy.lan:3128" }), "http://proxy.lan:3128", "a bare host:port is an HTTP proxy");
  assert.equal(proxyFor(server, { ALL_PROXY: "http://all.lan:8080" }), "http://all.lan:8080");
  assert.equal(proxyFor(server, { HTTP_PROXY: "http://plain.lan:80" }), undefined, "HTTP_PROXY is only for http:// servers");
  assert.equal(proxyFor("http://collab.lan", { HTTP_PROXY: "http://plain.lan:80" }), "http://plain.lan:80");
  for (const NO_PROXY of ["*", "excalidraw.com", ".excalidraw.com", "localhost, oss-collab.excalidraw.com:443"]) {
    assert.equal(proxyFor(server, { HTTPS_PROXY: "http://proxy.lan:3128", NO_PROXY }), undefined, `NO_PROXY=${NO_PROXY}`);
  }
  assert.equal(proxyFor(server, { HTTPS_PROXY: "http://proxy.lan:3128", NO_PROXY: "notexcalidraw.com" }), "http://proxy.lan:3128");
});

test("where a websocket is refused, the seat joins over long-polling instead", async () => {
  const server = await startCollabServer({ refuseWebsocket: true });
  const link = newRoomLink();
  const room = seat(server.url, link);
  try {
    assert.equal((await room.ready()).connected, true);
  } finally {
    room.close();
    await server.close();
  }
});

test("a seat reaches the server through the proxy the environment names", async () => {
  const server = await startCollabServer();
  // A minimal forward proxy: it only tunnels (CONNECT), and counts what it tunnelled.
  const tunnels: string[] = [];
  const proxy: HttpServer = createServer((_request, response) => response.writeHead(405).end());
  proxy.on("connect", (request, client, head) => {
    tunnels.push(request.url ?? "");
    const [host, port] = (request.url ?? "").split(":");
    const upstream = connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client).pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy, http_proxy: process.env.http_proxy };
  process.env.HTTP_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  delete process.env.http_proxy;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
  const room = seat(server.url, newRoomLink());
  try {
    assert.equal((await room.ready()).connected, true);
    assert.deepEqual([...new Set(tunnels)], [new URL(server.url).host]);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    room.close();
    await server.close();
    proxy.closeAllConnections();
    await new Promise((done) => proxy.close(done));
  }
});

test("a collaborator's name is cleaned of control characters before it is shown anywhere", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const tab = openTab(server.url, link, box("api", "API", 0, 0));
  await tab.joined;
  const room = seat(server.url, link);
  try {
    await room.ready();
    const sealed = await seal(link.roomKey, { type: "IDLE_STATUS", payload: { socketId: tab.socket.id, userState: "active", username: "Ana\u001b[2J\u0007 the tester" } });
    tab.socket.emit("server-broadcast", link.roomId, sealed.data, sealed.iv);
    await until(() => room.status().people.length > 0, "the name to arrive");
    assert.deepEqual(room.status().people, ["Ana[2J the tester"]);
    assert.match(room.read(), /In the room with you: Ana\[2J the tester\./);
  } finally {
    room.close();
    tab.close();
    await server.close();
  }
});

test("a seat whose first attempt failed can join once the server is there", async () => {
  const server = await startCollabServer();
  const link = newRoomLink();
  const room = new ExcalidrawRoom({ link, username: "x", name: "Board", server: "http://127.0.0.1:1", connectTimeoutMs: 300, sceneWaitMs: 200 });
  await assert.rejects(room.ready(), /could not reach/);
  const again = new ExcalidrawRoom({ link, username: "x", name: "Board", server: server.url, sceneWaitMs: 200 });
  try {
    assert.equal((await again.ready()).connected, true);
  } finally {
    again.close();
    room.close();
    await server.close();
  }
});
