import { test } from "node:test";
import assert from "node:assert/strict";
import { describeScene, isElement, MAX_REMOVALS, MAX_SHAPES, mergeElements, plainText, planDraw, remoteWins, sceneBounds, wrapLabel, type DrawRequest, type Scene, type SceneElement } from "../src/excalidraw/scene.ts";

/** Draw into a scene the way a room's seat does: plan, then keep what changed. */
function draw(scene: Scene, request: DrawRequest) {
  const outcome = planDraw(scene, request);
  for (const element of outcome.changed) scene.set(element.id, element);
  return outcome;
}

function at<T>(value: T | undefined): T {
  assert.ok(value !== undefined, "expected a value");
  return value;
}

test("a labelled shape is a shape with a text element bound inside it, centred", () => {
  const scene: Scene = new Map();
  const outcome = draw(scene, { shapes: [{ id: "api", type: "rectangle", text: "API gateway", x: 100, y: 50, width: 200, height: 80, fill: "green", color: "blue" }] });
  assert.deepEqual(outcome.problems, []);
  assert.deepEqual(outcome.drawn.map((entry) => [entry.name, entry.type, entry.action]), [["api", "rectangle", "created"]]);
  const shape = at(scene.get("api"));
  const label = at([...scene.values()].find((element) => element.type === "text"));
  assert.deepEqual([shape.x, shape.y, shape.width, shape.height], [100, 50, 200, 80]);
  assert.deepEqual([shape.backgroundColor, shape.strokeColor], ["#b2f2bb", "#1971c2"], "colour names become Excalidraw's palette");
  assert.deepEqual(shape.boundElements, [{ id: label.id, type: "text" }]);
  assert.equal(label.containerId, "api");
  assert.equal(label.text, "API gateway");
  assert.equal(label.originalText, "API gateway");
  assert.deepEqual([label.textAlign, label.verticalAlign], ["center", "middle"]);
  assert.ok(Math.abs(label.x + label.width / 2 - 200) < 1 && Math.abs(label.y + label.height / 2 - 90) < 1, "the label sits in the middle of the shape");
  // Complete elements: every field Excalidraw's restore would otherwise have to invent.
  for (const key of ["id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "groupIds", "frameId", "index", "roundness", "seed", "version", "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked"]) {
    assert.ok(key in shape, `the shape has ${key}`);
  }
  assert.deepEqual([shape.version, shape.isDeleted, shape.index], [1, false, null]);
  assert.ok(isElement(shape) && isElement(label));
});

test("a shape drawn without a size grows to fit its label, and long labels wrap", () => {
  const scene: Scene = new Map();
  draw(scene, {
    shapes: [
      { id: "short", type: "rectangle", text: "Web", x: 0, y: 0 },
      { id: "long", type: "rectangle", text: "The service that validates every token before anything else runs", x: 0, y: 200 },
    ],
  });
  const short = at(scene.get("short"));
  const long = at(scene.get("long"));
  assert.deepEqual([short.width, short.height], [160, 70], "the default size");
  assert.ok(long.width > 160 && long.width <= 400 && long.height > 70, "wider and taller for a long label");
  const label = at([...scene.values()].find((element) => element.containerId === "long"));
  assert.ok(String(label.text).includes("\n"), "wrapped onto several lines");
  assert.equal(label.originalText, "The service that validates every token before anything else runs", "the original text is kept whole");
  assert.ok(label.width <= long.width - 20 && label.height <= long.height, "and it fits inside");
  assert.deepEqual(wrapLabel("aaaaaaaaaaaaaaaaaaaaaaaa", 20, 60).length > 1, true, "a word longer than a line is broken");
});

test("an arrow joins two shapes: on their outlines, bound at both ends, listed on both shapes", () => {
  const scene: Scene = new Map();
  const outcome = draw(scene, {
    shapes: [
      { id: "web", type: "rectangle", x: 0, y: 0, width: 160, height: 70 },
      { id: "api", type: "rectangle", x: 300, y: 0, width: 160, height: 70 },
      { id: "go", type: "arrow", from: "web", to: "api", text: "HTTPS" },
    ],
  });
  assert.deepEqual(outcome.problems, []);
  const arrow = at(scene.get("go"));
  assert.equal(arrow.type, "arrow");
  // Level with both middles, leaving the first shape's right edge and stopping short of the second's left edge.
  assert.deepEqual([arrow.x, arrow.y], [166, 35]);
  assert.deepEqual(arrow.points, [[0, 0], [128, 0]]);
  assert.deepEqual([arrow.width, arrow.height], [128, 0]);
  const start = arrow.startBinding as Record<string, unknown>;
  const end = arrow.endBinding as Record<string, unknown>;
  assert.deepEqual([start.elementId, end.elementId], ["web", "api"]);
  // Both generations of Excalidraw's binding are present.
  assert.deepEqual([start.focus, start.gap, start.mode], [0, 6, "orbit"]);
  assert.deepEqual(start.fixedPoint, [1.0375, 0.5].map((value) => Math.min(1, value)));
  assert.equal(arrow.endArrowhead, "arrow");
  for (const id of ["web", "api"]) assert.ok(at(scene.get(id)).boundElements?.some((entry) => entry.id === "go" && entry.type === "arrow"), `${id} lists the arrow`);
  const label = at([...scene.values()].find((element) => element.containerId === "go"));
  assert.equal(label.text, "HTTPS");
  assert.ok(Math.abs(label.x + label.width / 2 - (arrow.x + 64)) < 1, "the label sits on the middle of the arrow");
  assert.ok(arrow.boundElements?.some((entry) => entry.id === label.id && entry.type === "text"));
});

test("arrows aim at the outline of ellipses and diamonds too, and slanted arrows point at the other shape's middle", () => {
  const scene: Scene = new Map();
  draw(scene, {
    shapes: [
      { id: "a", type: "ellipse", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", type: "diamond", x: 200, y: 200, width: 100, height: 100 },
      { id: "link", type: "arrow", from: "a", to: "b" },
    ],
  });
  const arrow = at(scene.get("link"));
  const endX = arrow.x + (arrow.points as number[][])[1]![0]!;
  const endY = arrow.y + (arrow.points as number[][])[1]![1]!;
  // From the ellipse's middle (50,50) toward the diamond's middle (250,250): the outline is 50px out along the diagonal.
  assert.ok(Math.abs(arrow.x - (50 + 50 * Math.SQRT1_2 + 6 * Math.SQRT1_2)) < 0.5, `starts on the ellipse: ${arrow.x}`);
  // The diamond's outline along the diagonal is 25px from its middle each way (|dx|/50 + |dy|/50 = 1).
  assert.ok(Math.abs(endX - (250 - 25 - 6 * Math.SQRT1_2)) < 0.5, `ends on the diamond: ${endX}`);
  assert.ok(Math.abs(endY - endX) < 0.001, "along the diagonal");
});

test("an arrow that cannot be drawn says why, and nothing else is lost", () => {
  const scene: Scene = new Map();
  const outcome = draw(scene, {
    shapes: [
      { id: "a", type: "rectangle", x: 0, y: 0 },
      { id: "one", type: "arrow", from: "a" },
      { id: "ghost", type: "arrow", from: "a", to: "nope" },
      { id: "self", type: "arrow", from: "a", to: "a" },
      { id: "line", type: "line", from: "a", to: "a" },
      { id: "short", type: "arrow", points: [[0, 0]] },
      { id: "cube", type: "cube" },
      { id: "untyped" },
      { id: "empty", type: "text" },
    ],
  });
  assert.deepEqual(outcome.drawn.map((entry) => entry.name), ["a"]);
  assert.equal(scene.size, 1);
  const problems = outcome.problems.join("\n");
  assert.match(problems, /one: an arrow between shapes needs both from and to/);
  assert.match(problems, /ghost: no shape with id nope/);
  assert.match(problems, /self: from and to are the same shape/);
  assert.match(problems, /line: a line does not join shapes/);
  assert.match(problems, /short: an arrow needs from and to \(shape ids\), or points/);
  assert.match(problems, /cube: cannot draw a "cube"/);
  assert.match(problems, /untyped: give it a type/);
  assert.match(problems, /empty: a text element needs its text/);
});

test("free lines and arrows take absolute points; free text keeps its words", () => {
  const scene: Scene = new Map();
  draw(scene, {
    shapes: [
      { id: "rule", type: "line", points: [[10, 20], [110, 20], [110, 90]], dashed: true, color: "gray" },
      { id: "loose", type: "arrow", points: [[300, 300], [400, 350]] },
      { id: "note", type: "text", text: "two\nlines", x: 5, y: 6, fontSize: 24, color: "violet" },
    ],
  });
  const line = at(scene.get("rule"));
  assert.deepEqual([line.x, line.y, line.width, line.height], [10, 20, 100, 70]);
  assert.deepEqual(line.points, [[0, 0], [100, 0], [100, 70]]);
  assert.deepEqual([line.strokeStyle, line.strokeColor, line.endArrowhead], ["dashed", "#868e96", null]);
  const loose = at(scene.get("loose"));
  assert.deepEqual([loose.startBinding, loose.endBinding], [null, null]);
  const note = at(scene.get("note"));
  assert.deepEqual([note.x, note.y, note.text, note.fontSize, note.strokeColor], [5, 6, "two\nlines", 24, "#6741d9"]);
  assert.equal(note.containerId, null);
});

test("shapes with no position go in free space below what is there, four to a row", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "first", type: "rectangle", x: 100, y: 100, width: 200, height: 80 }] });
  draw(scene, { shapes: Array.from({ length: 5 }, (_, index) => ({ id: `n${index}`, type: "rectangle" })) });
  const placed = Array.from({ length: 5 }, (_, index) => at(scene.get(`n${index}`)));
  // Below the first shape's bottom (180) with a gap, starting at its left edge.
  assert.ok(placed.every((shape) => shape.y >= 280 - 1e-9));
  assert.equal(placed[0]!.x, 100);
  assert.equal(placed[0]!.y, placed[3]!.y, "four in the first row");
  assert.ok(placed[4]!.y > placed[0]!.y, "the fifth starts a new row");
  assert.equal(placed[4]!.x, 100);
  const boxes = placed.slice(0, 4);
  for (let index = 1; index < boxes.length; index += 1) assert.ok(boxes[index]!.x >= boxes[index - 1]!.x + boxes[index - 1]!.width + 60 - 1e-9, "spaced apart");
  const empty: Scene = new Map();
  draw(empty, { shapes: [{ id: "only", type: "rectangle" }] });
  assert.deepEqual([at(empty.get("only")).x, at(empty.get("only")).y], [0, 0], "an empty board starts at the origin");
});

test("colours are named or hex; an unknown one is said so and does not stop the drawing", () => {
  const scene: Scene = new Map();
  const outcome = draw(scene, { shapes: [{ id: "a", type: "rectangle", x: 0, y: 0, color: "#ABCDEF", fill: "mauve" }, { id: "b", type: "rectangle", x: 0, y: 200, color: "chartreuse", fill: "transparent" }] });
  assert.equal(at(scene.get("a")).strokeColor, "#abcdef");
  assert.equal(at(scene.get("a")).backgroundColor, "transparent");
  assert.equal(at(scene.get("b")).strokeColor, "#1e1e1e");
  assert.match(outcome.problems.join("\n"), /unknown fill "mauve" for a/);
  assert.match(outcome.problems.join("\n"), /unknown colour "chartreuse" for b/);
});

test("changing an element by id updates it in place, one version on, and keeps the rest as it was", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "db", type: "ellipse", text: "Postgres", x: 0, y: 0, fill: "yellow" }] });
  const before = at(scene.get("db"));
  const labelBefore = at([...scene.values()].find((element) => element.containerId === "db"));
  const outcome = draw(scene, { shapes: [{ id: "db", fill: "red", text: "Postgres 16", dashed: true }] });
  assert.deepEqual(outcome.problems, []);
  assert.deepEqual(outcome.drawn.map((entry) => [entry.id, entry.action]), [["db", "updated"]]);
  const after = at(scene.get("db"));
  assert.deepEqual([after.version, after.backgroundColor, after.strokeStyle, after.x, after.width], [before.version + 1, "#ffc9c9", "dashed", before.x, before.width]);
  assert.notEqual(after.versionNonce, before.versionNonce, "a new nonce, so every client takes the new version");
  const label = at(scene.get(labelBefore.id));
  assert.deepEqual([label.text, label.originalText, label.version], ["Postgres 16", "Postgres 16", labelBefore.version + 1]);
  assert.equal([...scene.values()].filter((element) => element.type === "text").length, 1, "the label was changed, not doubled");
  assert.deepEqual(outcome.changed.map((element) => element.id).sort(), [after.id, label.id].sort());
});

test("giving an unlabelled shape text adds a label to it", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "box", type: "rectangle", x: 0, y: 0 }] });
  draw(scene, { shapes: [{ id: "box", text: "Now named" }] });
  const label = at([...scene.values()].find((element) => element.containerId === "box"));
  assert.equal(label.text, "Now named");
  assert.ok(at(scene.get("box")).boundElements?.some((entry) => entry.id === label.id && entry.type === "text"));
});

test("moving a shape takes its label and the arrows joined to it along", () => {
  const scene: Scene = new Map();
  draw(scene, {
    shapes: [
      { id: "web", type: "rectangle", text: "Web", x: 0, y: 0, width: 160, height: 70 },
      { id: "api", type: "rectangle", text: "API", x: 300, y: 0, width: 160, height: 70 },
      { id: "go", type: "arrow", from: "web", to: "api", text: "HTTPS" },
    ],
  });
  const arrowBefore = at(scene.get("go"));
  const outcome = draw(scene, { shapes: [{ id: "api", x: 300, y: 200 }] });
  assert.deepEqual(outcome.problems, []);
  const api = at(scene.get("api"));
  assert.equal(api.y, 200);
  const label = at([...scene.values()].find((element) => element.containerId === "api"));
  assert.ok(Math.abs(label.y + label.height / 2 - 235) < 1, "the shape's label moved with it");
  const arrow = at(scene.get("go"));
  assert.equal(arrow.version, arrowBefore.version + 1, "the arrow was re-aimed");
  const end = arrow.y + (arrow.points as number[][])[1]![1]!;
  assert.ok(end > 100, `it now ends lower, at the moved shape: ${end}`);
  assert.deepEqual((arrow.startBinding as { elementId: string }).elementId, "web", "and is still bound at both ends");
  const arrowLabel = at([...scene.values()].find((element) => element.containerId === "go"));
  assert.ok(Math.abs(arrowLabel.y + arrowLabel.height / 2 - (arrow.y + (arrow.points as number[][])[1]![1]! / 2)) < 1, "the arrow's label followed it");
});

test("removing a shape deletes its label and looses the arrows that joined it, each one version on", () => {
  const scene: Scene = new Map();
  draw(scene, {
    shapes: [
      { id: "a", type: "rectangle", text: "A", x: 0, y: 0 },
      { id: "b", type: "rectangle", text: "B", x: 300, y: 0 },
      { id: "go", type: "arrow", from: "a", to: "b" },
    ],
  });
  const goBefore = at(scene.get("go"));
  const outcome = draw(scene, { remove: ["b", "missing"] });
  assert.match(outcome.problems.join(), /nothing to remove with id missing/);
  assert.equal(at(scene.get("b")).isDeleted, true);
  assert.equal(at(scene.get("b")).version, 2);
  assert.equal(at([...scene.values()].find((element) => element.containerId === "b")).isDeleted, true, "its label went with it");
  const go = at(scene.get("go"));
  assert.equal(go.isDeleted, false);
  assert.deepEqual([go.startBinding && (go.startBinding as { elementId: string }).elementId, go.endBinding], ["a", null]);
  assert.equal(go.version, goBefore.version + 1);
  assert.equal(outcome.removed.length, 2, "the shape and its label");
  assert.equal(at(scene.get("a")).isDeleted, false);
  assert.equal(draw(scene, { shapes: [{ id: "b", x: 1 }] }).problems.length, 1, "a deleted id is not silently brought back");
});

test("an arrow whose other end was removed still follows the shape it is joined to", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 100 }, { id: "b", type: "rectangle", x: 300, y: 0, width: 100, height: 100 }, { id: "go", type: "arrow", from: "a", to: "b" }] });
  draw(scene, { remove: ["b"] });
  const looseEnd = (arrow: SceneElement) => [arrow.x + (arrow.points as number[][])[1]![0]!, arrow.y + (arrow.points as number[][])[1]![1]!];
  const before = looseEnd(at(scene.get("go")));
  draw(scene, { shapes: [{ id: "a", x: 0, y: 500 }] });
  const go = at(scene.get("go"));
  assert.deepEqual(looseEnd(go), before, "the loose end stays where it was");
  assert.ok(go.y > 480 && go.y < 520, `and the joined end went with its shape, leaving its top edge: ${go.y}`);
});

test("a request changes nothing it was not asked to, and says when there was nothing to do", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "a", type: "rectangle", x: 0, y: 0 }] });
  const outcome = draw(scene, { shapes: [{ id: "a" }, { id: "go", type: "arrow", points: [[0, 0], [5, 5]] }] });
  assert.match(outcome.problems.join(), /nothing to change on a/);
  assert.deepEqual(outcome.changed.map((element) => element.id), [at(scene.get("go")).id]);
  assert.equal(at(scene.get("a")).version, 1);
  assert.match(draw(scene, { shapes: [{ id: "go", x: 9 }] }).problems.join(), /go is an arrow or line; delete it and draw it again to move it/);
});

test("planning a draw never touches the scene it is given", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "a", type: "rectangle", text: "A", x: 0, y: 0 }] });
  const snapshot = JSON.stringify([...scene.values()]);
  planDraw(scene, { shapes: [{ id: "a", x: 50 }, { id: "b", type: "ellipse" }], remove: ["a"] });
  assert.equal(JSON.stringify([...scene.values()]), snapshot);
});

test("merging keeps the higher version, the lower nonce on a tie, and ignores what is not an element", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "a", type: "rectangle", x: 0, y: 0 }] });
  const local = at(scene.get("a"));
  assert.deepEqual(mergeElements(scene, [{ ...local, version: 5, x: 50 }]), ["a"]);
  assert.equal(at(scene.get("a")).x, 50);
  assert.deepEqual(mergeElements(scene, [{ ...local, version: 4, x: 99 }]), [], "an older version is ignored");
  assert.equal(at(scene.get("a")).x, 50);
  const held = at(scene.get("a"));
  assert.equal(remoteWins(held, { ...held, versionNonce: held.versionNonce - 1 }), true, "equal versions: the lower nonce wins");
  assert.equal(remoteWins(held, { ...held, versionNonce: held.versionNonce + 1 }), false);
  assert.equal(remoteWins(held, { ...held }), false, "the same element changes nothing");
  assert.deepEqual(mergeElements(scene, [null, 3, "x", {}, { id: "z" }, { id: "y", type: "text", version: 1, versionNonce: 1, x: "1", y: 2 }]), []);
  assert.deepEqual(mergeElements(scene, [{ id: "new", type: "text", version: 1, versionNonce: 1, x: 1, y: 2 }]), ["new"]);
});

test("a board in words: shapes with labels, arrows as from → to, free text, ids and places", () => {
  const scene: Scene = new Map();
  draw(scene, {
    shapes: [
      { id: "web", type: "rectangle", text: "Web app", x: 0, y: 0, width: 160, height: 70, fill: "blue" },
      { id: "db", type: "ellipse", text: "Postgres", x: 400, y: 0, width: 160, height: 80 },
      { id: "sql", type: "arrow", from: "web", to: "db", text: "SQL" },
      { id: "cut", type: "arrow", points: [[0, 200], [100, 200]] },
      { id: "note", type: "text", text: "Sketch v1", x: 0, y: 300 },
    ],
  });
  scene.set("scribble", { ...at(scene.get("web")), id: "scribble", type: "freedraw", boundElements: null });
  scene.set("gone", { ...at(scene.get("web")), id: "gone", isDeleted: true });
  const text = describeScene(scene, "Architecture");
  assert.match(text, /^Excalidraw session "Architecture": 6 elements, spanning x 0…560, y 0…\d+\./);
  assert.match(text, /- rectangle "Web app" id=web at 0,0 160×70 fill #a5d8ff/);
  assert.match(text, /- ellipse "Postgres" id=db at 400,0 160×80/);
  assert.match(text, /- arrow "Web app" → "Postgres" labelled "SQL" id=sql/);
  assert.match(text, /- arrow at 0,200 100×0 id=cut/);
  assert.match(text, /- text "Sketch v1" id=note at 0,300/);
  assert.match(text, /Also on the board \(drawings, not described\): 1 freedraw\./);
  assert.ok(!text.includes("gone"), "deleted elements are not on the board");
  assert.ok(!/text "Web app" id/.test(text), "a label is part of its shape, not a line of its own");
  assert.match(describeScene(new Map(), "Empty"), /the board is empty/);
});

test("a large board is listed up to a limit, and says how many it left out", () => {
  const scene: Scene = new Map();
  for (const from of [0, 65]) draw(scene, { shapes: Array.from({ length: 65 }, (_, index) => ({ id: `s${from + index}`, type: "rectangle", x: (from + index) * 10, y: 0 })) });
  const text = describeScene(scene, "Big");
  assert.equal(text.split("\n").filter((line) => line.startsWith("- ")).length, 120);
  assert.match(text, /… and 10 more elements not listed/);
});

test("bounds are the box around what is there", () => {
  assert.equal(sceneBounds([]), undefined);
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "a", type: "rectangle", x: 10, y: 20, width: 100, height: 50 }, { id: "b", type: "rectangle", x: -30, y: 200, width: 10, height: 10 }] });
  assert.deepEqual(sceneBounds([...scene.values()]), { x1: -30, y1: 20, x2: 110, y2: 210 });
});

/* ------------------------------------------------------ safety of what goes in and out */

test("agents delete only what agents drew; the user's shapes can be moved and recoloured but not deleted", () => {
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "mine", type: "rectangle", text: "Agent's", x: 0, y: 0 }] });
  // The user's own shape, as a browser makes it: no mark from an agent.
  const users = { ...at(scene.get("mine")), id: "theirs", customData: undefined, boundElements: null };
  delete users.customData;
  scene.set("theirs", users);
  assert.equal(at(scene.get("mine")).customData && (at(scene.get("mine")).customData as { botLobby?: boolean }).botLobby, true, "what an agent draws is marked");
  const refused = draw(scene, { remove: ["theirs", "mine"] });
  assert.match(refused.problems.join(), /theirs was not drawn by an agent, so it is not yours to remove; ask the user to delete it/);
  assert.equal(at(scene.get("theirs")).isDeleted, false);
  assert.equal(at(scene.get("mine")).isDeleted, true, "its own work can be taken back");
  const moved = draw(scene, { shapes: [{ id: "theirs", x: 300, fill: "red" }] });
  assert.deepEqual(moved.problems, []);
  assert.deepEqual([at(scene.get("theirs")).x, at(scene.get("theirs")).backgroundColor], [300, "#ffc9c9"]);
  // Labels an agent gave the user's shape are the agent's to remove, but the shape is not.
  const [label] = [...scene.values()].filter((element) => element.containerId === "theirs");
  assert.equal(label, undefined, "nothing was labelled here");
});

test("one request draws at most 100 shapes and removes at most 50, and says what it left", () => {
  const scene: Scene = new Map();
  const outcome = draw(scene, { shapes: Array.from({ length: MAX_SHAPES + 5 }, (_, index) => ({ id: `s${index}`, type: "rectangle" })) });
  assert.equal(outcome.drawn.length, MAX_SHAPES);
  assert.match(outcome.problems.join(), /only the first 100 shapes were drawn; send the rest in another call/);
  const ids = outcome.drawn.map((entry) => entry.id);
  const removal = draw(scene, { remove: ids });
  assert.equal(removal.removed.length, MAX_REMOVALS);
  assert.match(removal.problems.join(), /only the first 50 removals were made; a board is not cleared in one call/);
  assert.equal(visibleCount(scene), MAX_SHAPES - MAX_REMOVALS);
});

function visibleCount(scene: Scene): number {
  return [...scene.values()].filter((element) => !element.isDeleted && element.type !== "text").length;
}

test("numbers, text and points are brought within bounds instead of broadcast as they came", () => {
  const scene: Scene = new Map();
  const outcome = draw(scene, {
    shapes: [
      { id: "far", type: "rectangle", x: 1e12, y: -1e12, width: 1e9, height: 0 },
      { id: "nan", type: "rectangle", x: Number.NaN, y: Number.POSITIVE_INFINITY, fontSize: 1e6, text: "x".repeat(5000) },
      { id: "path", type: "line", points: [[0, 0], [1e15, -1e15]] },
    ],
  });
  assert.deepEqual(outcome.problems, []);
  const far = at(scene.get("far"));
  assert.deepEqual([far.x, far.y, far.width, far.height], [100_000, -100_000, 5000, 10]);
  const nan = at(scene.get("nan"));
  assert.ok(Number.isFinite(nan.x) && Number.isFinite(nan.y), "a number that is not one is dropped, and the shape placed");
  const label = at([...scene.values()].find((element) => element.containerId === "nan"));
  assert.equal(label.fontSize, 120);
  assert.equal(String(label.originalText).length, 2000);
  const path = at(scene.get("path"));
  assert.deepEqual(path.points, [[0, 0], [100_000, -100_000]].map(([x, y]) => [x! - 0, y! - 0]));
  for (const element of scene.values()) for (const key of ["x", "y", "width", "height"]) assert.ok(Number.isFinite(element[key] as number), `${element.id}.${key}`);
});

test("an id must be short and plain, and a shape with a bad one is refused with the others drawn", () => {
  const scene: Scene = new Map();
  const outcome = draw(scene, { shapes: [{ id: "ok-1.a:b_c", type: "rectangle", x: 0, y: 0 }, { id: "bad id", type: "rectangle" }, { id: "\u001b[2J", type: "rectangle" }, { id: "x".repeat(81), type: "rectangle" }] });
  assert.deepEqual(outcome.drawn.map((entry) => entry.id), ["ok-1.a:b_c"]);
  assert.equal(outcome.problems.length, 3);
  assert.match(outcome.problems.join("\n"), /an id must be 1-80 letters, digits or - _ \. :/);
});

test("what strangers put in a room cannot reach a model or a terminal as anything but text", () => {
  assert.equal(plainText("a\u001b[31mred\u0007\nline\ttab\u009b\u2028end "), "a[31mred line tab end");
  const scene: Scene = new Map();
  draw(scene, { shapes: [{ id: "ok", type: "rectangle", text: "fine", x: 0, y: 0 }] });
  const hostile = { ...at(scene.get("ok")), id: "ok\u001b]0;pwned\u0007", version: 9 };
  assert.equal(isElement(hostile), false, "an id with control characters is not an element");
  assert.equal(isElement({ ...at(scene.get("ok")), type: "Rect angle" }), false);
  assert.deepEqual(mergeElements(scene, [hostile]), []);
  const label = at([...scene.values()].find((element) => element.containerId === "ok"));
  scene.set(label.id, { ...label, version: 5, originalText: "\u001b[2Jclear\u001b[31m screen", text: "x" });
  scene.set("named", { ...at(scene.get("ok")), id: "named", type: "frame", name: "Frame \u001b[1mbold", boundElements: null });
  const text = describeScene(scene, "Board");
  assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text), "no control character reaches the reading");
  assert.match(text, /rectangle "\[2Jclear\[31m screen"/);
  assert.match(text, /frame "Frame \[1mbold"/);
});

test("a reading is held to a size, however long the ids and labels", () => {
  const scene: Scene = new Map();
  const id = (index: number) => `${"i".repeat(75)}${String(index).padStart(5, "0")}`;
  for (const from of [0, 50]) draw(scene, { shapes: Array.from({ length: 50 }, (_, index) => ({ id: id(from + index), type: "text", text: "long words ".repeat(20), x: (from + index) * 10, y: 0 })) });
  const text = describeScene(scene, "Wordy");
  assert.ok(text.length < 17_500, `held to its size: ${text.length}`);
  const listed = text.split("\n").filter((line) => line.startsWith("- ")).length;
  assert.ok(listed > 40 && listed < 100, `some are listed: ${listed}`);
  assert.match(text, new RegExp(`… and ${100 - listed} more elements not listed`));
});
