/**
 * An Excalidraw scene as an agent works with it: the elements a room holds,
 * merged the way Excalidraw's own clients merge them, a plain-words reading of
 * them for a model, and the builders that turn a model's short description of
 * what to draw (shapes, labels, arrows between shapes) into complete
 * elements a browser accepts. Pure: no network, no clock but `Date.now`, and
 * randomness only for ids and seeds, so every rule here is tested directly.
 */
import { randomBytes } from "node:crypto";

export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  /** Excalidraw's fractional order key; null until a browser gives one. */
  index: string | null;
  roundness: { type: number; value?: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: Array<{ id: string; type: string }> | null;
  updated: number;
  link: string | null;
  locked: boolean;
  [key: string]: unknown;
}

/** Elements by id, as one room's scene keeps them (deleted ones too: a deletion is an update). */
export type Scene = Map<string, SceneElement>;

/* ---------------------------------------------------------------- merge */

/**
 * Whether a remote element replaces the local one: Excalidraw keeps the higher
 * version, and of two equal versions the one with the lower nonce, so every
 * client settles on the same element whatever order the messages came in.
 */
export function remoteWins(local: SceneElement | undefined, remote: SceneElement): boolean {
  if (!local) return true;
  if (remote.version !== local.version) return remote.version > local.version;
  return remote.versionNonce < local.versionNonce;
}

/** Ids as Excalidraw and its neighbours make them; anything with other characters in it is not shown to a model or a terminal. */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Whether a received value can be an element at all (a room is shared with strangers' software). */
export function isElement(value: unknown): value is SceneElement {
  if (!value || typeof value !== "object") return false;
  const element = value as Record<string, unknown>;
  return typeof element.id === "string" && SAFE_ID.test(element.id) && typeof element.type === "string" && /^[a-z]{1,20}$/.test(element.type) && typeof element.version === "number" && typeof element.versionNonce === "number" && Number.isFinite(element.x) && Number.isFinite(element.y);
}

/** Text from a room made safe to print: one line, no control characters (a terminal would obey them). */
export function plainText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim();
}

/** Merge received elements into a scene; the ids that changed. */
export function mergeElements(scene: Scene, received: readonly unknown[]): string[] {
  const changed: string[] = [];
  for (const value of received) {
    if (!isElement(value)) continue;
    if (!remoteWins(scene.get(value.id), value)) continue;
    scene.set(value.id, value);
    changed.push(value.id);
  }
  return changed;
}

/** The elements on show, in the order the scene holds them. */
export function visible(scene: Scene): SceneElement[] {
  return [...scene.values()].filter((element) => !element.isDeleted);
}

/* ------------------------------------------------------------ measuring */

const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
/** Excalifont's average glyph is a little over half an em wide; erring wide keeps labels inside their shapes. */
const CHAR_WIDTH = 0.6;
const LABEL_PADDING = 10;
const FONT_FAMILY = 5;

/** Wrap `text` to lines no wider than `maxWidth` pixels at `fontSize`, breaking words that are longer than a line. */
export function wrapLabel(text: string, fontSize: number, maxWidth: number): string[] {
  const perLine = Math.max(4, Math.floor(maxWidth / (fontSize * CHAR_WIDTH)));
  const lines: string[] = [];
  for (const paragraph of text.replace(/\t/g, "  ").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > perLine) {
        if (line) lines.push(line);
        lines.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
        line = "";
      }
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= perLine) line += ` ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function measure(lines: readonly string[], fontSize: number): { width: number; height: number } {
  const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);
  return { width: Math.ceil(longest * fontSize * CHAR_WIDTH), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) };
}

/* ------------------------------------------------------------- building */

function randomInteger(): number {
  return randomBytes(4).readUInt32BE() & 0x7fffffff;
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

/** An id like Excalidraw's own (21 url-safe characters). */
export function newId(): string {
  const random = randomBytes(21);
  let id = "";
  for (const byte of random) id += ID_ALPHABET[byte & 63];
  return id;
}

/** The colour names a model can use, as Excalidraw's palette draws them. */
const STROKES: Record<string, string> = {
  black: "#1e1e1e", gray: "#868e96", red: "#e03131", pink: "#c2255c", grape: "#9c36b5", violet: "#6741d9",
  blue: "#1971c2", cyan: "#0c8599", teal: "#099268", green: "#2f9e44", lime: "#66a80f", yellow: "#f08c00", orange: "#e8590c", white: "#ffffff",
};
const FILLS: Record<string, string> = {
  gray: "#dee2e6", red: "#ffc9c9", pink: "#fcc2d7", grape: "#eebefa", violet: "#d0bfff", blue: "#a5d8ff", cyan: "#99e9f2",
  teal: "#96f2d7", green: "#b2f2bb", lime: "#d8f5a2", yellow: "#ffec99", orange: "#ffd8a8", white: "#ffffff", black: "#1e1e1e", transparent: "transparent",
};
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function strokeColor(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase();
  return HEX.test(key) ? key : STROKES[key];
}

export function fillColor(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase();
  return HEX.test(key) ? key : FILLS[key];
}

function base(type: string, fields: Partial<SceneElement> & Pick<SceneElement, "x" | "y">): SceneElement {
  return {
    id: newId(),
    type,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    // What agents draw says so, so that agents can take back their own work and never delete the user's.
    customData: { botLobby: true },
    ...fields,
  };
}

/** The element again, one version on, so every client takes it over the one it has. */
export function bumped(element: SceneElement, changes: Partial<SceneElement> = {}): SceneElement {
  return { ...element, ...changes, version: element.version + 1, versionNonce: randomInteger(), updated: Date.now() };
}

/** A text element: free-standing, or the label of a shape or arrow (`containerId`). */
function textElement(text: string, options: { x: number; y: number; fontSize: number; color: string; containerId?: string; width?: number }): SceneElement {
  const lines = options.containerId && options.width ? wrapLabel(text, options.fontSize, options.width) : text.split("\n");
  const { width, height } = measure(lines, options.fontSize);
  return base("text", {
    x: options.x,
    y: options.y,
    width,
    height,
    strokeColor: options.color,
    text: lines.join("\n"),
    originalText: text,
    fontSize: options.fontSize,
    fontFamily: FONT_FAMILY,
    textAlign: options.containerId ? "center" : "left",
    verticalAlign: options.containerId ? "middle" : "top",
    containerId: options.containerId ?? null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    roundness: null,
  });
}

const SHAPES = ["rectangle", "ellipse", "diamond"] as const;
type ShapeType = (typeof SHAPES)[number];

export function isShapeType(type: string): type is ShapeType {
  return (SHAPES as readonly string[]).includes(type);
}

/** Room for a label inside a shape, so a shape drawn without a size fits what it says. */
function fitShape(type: ShapeType, text: string | undefined, fontSize: number): { width: number; height: number } {
  const minimum = type === "diamond" ? { width: 180, height: 100 } : type === "ellipse" ? { width: 160, height: 80 } : { width: 160, height: 70 };
  if (!text) return minimum;
  // A diamond and an ellipse have less usable room than their box, so their labels get a wider box.
  const slack = type === "rectangle" ? 1 : 1.5;
  const lines = wrapLabel(text, fontSize, 260);
  const size = measure(lines, fontSize);
  return { width: Math.max(minimum.width, Math.ceil((size.width + 2 * LABEL_PADDING + 20) * slack)), height: Math.max(minimum.height, Math.ceil((size.height + 2 * LABEL_PADDING + 20) * slack)) };
}

/* ---------------------------------------------------------------- draw */

/** What a model may ask to have drawn. Only `type` is needed of a new shape. */
export interface DrawShape {
  /** A name later shapes and arrows use; an existing element's id updates that element instead. */
  id?: string;
  type?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Arrows: the shapes they join, by id (made in this same request, or already on the board). */
  from?: string;
  to?: string;
  /** Lines and arrows between places, not shapes: absolute scene coordinates, at least two. */
  points?: ReadonlyArray<readonly [number, number]>;
  color?: string;
  fill?: string;
  fontSize?: number;
  dashed?: boolean;
}

export interface DrawRequest {
  shapes?: readonly DrawShape[];
  /** Ids of elements to delete (their labels go with them, arrows joined to them are left loose). */
  remove?: readonly string[];
}

export interface DrawOutcome {
  /** Every element to send: new, changed and deleted, each at its new version. */
  changed: SceneElement[];
  /** The ids made or updated, by the name the request gave them (or their new id). */
  drawn: Array<{ name: string; id: string; type: string; action: "created" | "updated" }>;
  removed: string[];
  /** What could not be done, in words the model can act on. */
  problems: string[];
}

/** The size and position of the free space the next unplaced shape takes: rows below what is there. */
function placement(scene: ReadonlyMap<string, SceneElement>): (width: number, height: number) => { x: number; y: number } {
  const shown = [...scene.values()].filter((element) => !element.isDeleted);
  const bounds = sceneBounds(shown);
  const left = bounds ? bounds.x1 : 0;
  let x = left;
  let y = bounds ? bounds.y2 + 100 : 0;
  let rowHeight = 0;
  let inRow = 0;
  return (width, height) => {
    if (inRow >= 4) {
      x = left;
      y += rowHeight + 60;
      rowHeight = 0;
      inRow = 0;
    }
    const at = { x, y };
    x += width + 60;
    rowHeight = Math.max(rowHeight, height);
    inRow += 1;
    return at;
  };
}

export interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The box around some elements (linear ones by their own size, which is their extent). */
export function sceneBounds(elements: readonly SceneElement[]): Bounds | undefined {
  if (elements.length === 0) return undefined;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const element of elements) {
    x1 = Math.min(x1, element.x, element.x + element.width);
    y1 = Math.min(y1, element.y, element.y + element.height);
    x2 = Math.max(x2, element.x, element.x + element.width);
    y2 = Math.max(y2, element.y, element.y + element.height);
  }
  return { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) };
}

/** Where a line from a shape's centre toward (tx, ty) leaves the shape, plus a small gap. */
function edgePoint(shape: SceneElement, tx: number, ty: number, gap: number): { x: number; y: number } {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  let dx = tx - cx;
  let dy = ty - cy;
  if (dx === 0 && dy === 0) dy = 1;
  const halfW = Math.max(1, shape.width / 2);
  const halfH = Math.max(1, shape.height / 2);
  const ax = Math.abs(dx) / halfW;
  const ay = Math.abs(dy) / halfH;
  // How many times the offset fits before the outline, for each outline.
  const reach = shape.type === "ellipse" ? 1 / Math.hypot(ax, ay) : shape.type === "diamond" ? 1 / (ax + ay) : 1 / Math.max(ax, ay);
  const length = Math.hypot(dx, dy);
  const out = reach * length + gap;
  return { x: cx + (dx / length) * out, y: cy + (dy / length) * out };
}

const GAP = 6;

type Point = { x: number; y: number };

function centre(shape: SceneElement): Point {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/** An arrow from `start` to `end`, as Excalidraw stores it: placed at its start, its points relative to it. */
function straight(start: Point, end: Point): Pick<SceneElement, "x" | "y" | "width" | "height" | "points"> {
  return { x: start.x, y: start.y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), points: [[0, 0], [end.x - start.x, end.y - start.y]] };
}

/** How an arrow's end is attached to a shape, in both generations of Excalidraw's binding, so a browser of either reads it. */
function bindingAt(shape: SceneElement, at: Point) {
  return {
    elementId: shape.id,
    focus: 0,
    gap: GAP,
    fixedPoint: [Math.min(1, Math.max(0, (at.x - shape.x) / Math.max(1, shape.width))), Math.min(1, Math.max(0, (at.y - shape.y) / Math.max(1, shape.height)))],
    mode: "orbit",
  };
}

/**
 * An arrow's geometry with each end on its shape's outline, aimed at the other
 * end: the other shape's middle, or where a loose end already is.
 */
function route(from: SceneElement | undefined, to: SceneElement | undefined, loose: { start: Point; end: Point }): Pick<SceneElement, "x" | "y" | "width" | "height" | "points" | "startBinding" | "endBinding"> {
  const aimStart = to ? centre(to) : loose.end;
  const aimEnd = from ? centre(from) : loose.start;
  const start = from ? edgePoint(from, aimStart.x, aimStart.y, GAP) : loose.start;
  const end = to ? edgePoint(to, aimEnd.x, aimEnd.y, GAP) : loose.end;
  return { ...straight(start, end), startBinding: from ? bindingAt(from, start) : null, endBinding: to ? bindingAt(to, end) : null };
}

/** One new arrow joining two shapes. */
function joinShapes(from: SceneElement, to: SceneElement): ReturnType<typeof route> {
  return route(from, to, { start: centre(from), end: centre(to) });
}

function label(container: SceneElement, text: string, fontSize: number, color: string): SceneElement {
  const width = Math.max(20, container.width - 2 * LABEL_PADDING);
  const made = textElement(text, { x: 0, y: 0, fontSize, color, containerId: container.id, width });
  return { ...made, x: container.x + (container.width - made.width) / 2, y: container.y + (container.height - made.height) / 2 };
}

/** An arrow's label sits on the middle of its path. */
function arrowMiddle(arrow: SceneElement): { x: number; y: number } {
  const points = (arrow.points as ReadonlyArray<readonly [number, number]> | undefined) ?? [[0, 0], [arrow.width, arrow.height]];
  const last = points.at(-1) ?? [0, 0];
  return { x: arrow.x + last[0] / 2, y: arrow.y + last[1] / 2 };
}

function labelOn(container: SceneElement, text: string, fontSize: number, color: string): SceneElement {
  if (container.type !== "arrow") return label(container, text, fontSize, color);
  const middle = arrowMiddle(container);
  const made = textElement(text, { x: 0, y: 0, fontSize, color, containerId: container.id, width: 180 });
  return { ...made, x: middle.x - made.width / 2, y: middle.y - made.height / 2 };
}

/** What one request may hold: a model's mistakes and a runaway loop must not become a huge broadcast. */
export const MAX_SHAPES = 100;
export const MAX_REMOVALS = 50;
const MAX_POINTS = 200;
const MAX_TEXT = 2000;
/** Excalidraw warns about elements far outside this; a model has no reason to use them. */
const COORDINATE_LIMIT = 100_000;

function within(value: unknown, low: number, high: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : undefined;
}

/** A shape with its numbers, text and points brought within bounds; undefined (with the reason) when its id cannot be used. */
function tidyShape(shape: DrawShape, problems: string[]): DrawShape | undefined {
  if (shape.id !== undefined && (typeof shape.id !== "string" || !SAFE_ID.test(shape.id))) {
    problems.push(`an id must be 1-80 letters, digits or - _ . : (got ${JSON.stringify(String(shape.id).slice(0, 30))})`);
    return undefined;
  }
  const tidy: DrawShape = { ...shape };
  const set = <K extends "x" | "y" | "width" | "height" | "fontSize">(key: K, low: number, high: number) => {
    if (shape[key] === undefined) return;
    const value = within(shape[key], low, high);
    if (value === undefined) delete tidy[key];
    else tidy[key] = value;
  };
  set("x", -COORDINATE_LIMIT, COORDINATE_LIMIT);
  set("y", -COORDINATE_LIMIT, COORDINATE_LIMIT);
  set("width", 10, 5000);
  set("height", 10, 5000);
  set("fontSize", 8, 120);
  if (typeof shape.text === "string" && shape.text.length > MAX_TEXT) tidy.text = shape.text.slice(0, MAX_TEXT);
  if (Array.isArray(shape.points)) {
    tidy.points = shape.points.slice(0, MAX_POINTS).map((point) => (Array.isArray(point) && point.length === 2 ? ([within(point[0], -COORDINATE_LIMIT, COORDINATE_LIMIT) ?? NaN, within(point[1], -COORDINATE_LIMIT, COORDINATE_LIMIT) ?? NaN] as const) : point));
  }
  return tidy;
}

/**
 * Turn a request into the elements to send. Nothing here touches the scene it
 * is given: the outcome lists every element that changed, at its next version,
 * for the caller to broadcast and merge. New shapes come first so arrows in the
 * same request can join them; an id already on the board updates that element.
 */
export function planDraw(scene: ReadonlyMap<string, SceneElement>, asked: DrawRequest): DrawOutcome {
  const outcome: DrawOutcome = { changed: [], drawn: [], removed: [], problems: [] };
  const request: DrawRequest = {
    shapes: (asked.shapes ?? []).slice(0, MAX_SHAPES).flatMap((shape) => tidyShape(shape, outcome.problems) ?? []),
    remove: (asked.remove ?? []).filter((id): id is string => typeof id === "string").slice(0, MAX_REMOVALS),
  };
  if ((asked.shapes?.length ?? 0) > MAX_SHAPES) outcome.problems.push(`only the first ${MAX_SHAPES} shapes were drawn; send the rest in another call`);
  if ((asked.remove?.length ?? 0) > MAX_REMOVALS) outcome.problems.push(`only the first ${MAX_REMOVALS} removals were made; a board is not cleared in one call`);
  const working = new Map(scene);
  const touched = new Map<string, SceneElement>();
  const put = (element: SceneElement) => {
    working.set(element.id, element);
    touched.set(element.id, element);
  };
  /** Update an element already in the working scene (bumping it once per request, however many times it is touched). */
  const revise = (element: SceneElement, changes: Partial<SceneElement>): SceneElement => {
    const current = working.get(element.id) ?? element;
    const next = touched.has(current.id) ? { ...current, ...changes } : bumped(current, changes);
    put(next);
    return next;
  };
  const place = placement(scene);
  /** List an arrow on the shape it joins, or a browser would not move it with the shape. */
  const attach = (shapeId: string, arrowId: string) => {
    const shape = working.get(shapeId);
    if (!shape || shape.isDeleted || (shape.boundElements ?? []).some((entry) => entry.id === arrowId)) return;
    revise(shape, { boundElements: [...(shape.boundElements ?? []), { id: arrowId, type: "arrow" }] });
  };
  /** The request's names for the elements it makes, so arrows can join them. */
  const names = new Map<string, string>();
  const resolve = (name: string | undefined): SceneElement | undefined => {
    if (!name) return undefined;
    const id = names.get(name) ?? name;
    const found = working.get(id);
    return found && !found.isDeleted ? found : undefined;
  };

  // Removals first: a label goes with its shape, and an arrow that joined a removed shape comes loose.
  for (const id of request.remove ?? []) {
    const target = working.get(id);
    if (!target || target.isDeleted) {
      outcome.problems.push(`nothing to remove with id ${plainText(id).slice(0, 40)}`);
      continue;
    }
    // A deletion is not one the user can undo, so agents take back only what agents drew.
    if (!(target.customData as { botLobby?: boolean } | undefined)?.botLobby) {
      outcome.problems.push(`${plainText(id).slice(0, 40)} was not drawn by an agent, so it is not yours to remove; ask the user to delete it (moving, recolouring and relabelling it are fine)`);
      continue;
    }
    revise(target, { isDeleted: true });
    outcome.removed.push(id);
    for (const bound of target.boundElements ?? []) {
      const other = working.get(bound.id);
      if (!other || other.isDeleted) continue;
      if (bound.type === "text") {
        revise(other, { isDeleted: true });
        outcome.removed.push(other.id);
      } else if (bound.type === "arrow") {
        revise(other, {
          ...(other.startBinding && (other.startBinding as { elementId?: string }).elementId === id ? { startBinding: null } : {}),
          ...(other.endBinding && (other.endBinding as { elementId?: string }).elementId === id ? { endBinding: null } : {}),
        });
      }
    }
  }

  const shapes = request.shapes ?? [];
  const isLinear = (shape: DrawShape) => shape.type === "arrow" || shape.type === "line";
  // Shapes and text first, then the arrows and lines that join them.
  for (const shape of [...shapes.filter((entry) => !isLinear(entry)), ...shapes.filter(isLinear)]) {
    const name = shape.id ?? shape.type ?? "shape";
    const existing = shape.id ? working.get(shape.id) : undefined;
    if (existing && !existing.isDeleted) updateElement(existing, shape, name);
    else if (shape.id && existing?.isDeleted) outcome.problems.push(`${shape.id} was deleted; give the new shape another id`);
    else createElement(shape, name);
  }

  function updateElement(existing: SceneElement, shape: DrawShape, name: string): void {
    const fontSize = shape.fontSize ?? (typeof existing.fontSize === "number" ? existing.fontSize : FONT_SIZE);
    const color = strokeColor(shape.color);
    const fill = fillColor(shape.fill);
    if (shape.color && !color) outcome.problems.push(`unknown colour "${shape.color}" for ${name}; use a name (red, blue, green…) or a #hex`);
    if (shape.fill && !fill) outcome.problems.push(`unknown fill "${shape.fill}" for ${name}; use a name (red, blue, green…), transparent or a #hex`);
    let next = existing;
    const moved = (shape.x !== undefined && shape.x !== existing.x) || (shape.y !== undefined && shape.y !== existing.y);
    const resized = (shape.width !== undefined && shape.width !== existing.width) || (shape.height !== undefined && shape.height !== existing.height);
    const changes: Partial<SceneElement> = {
      ...(color ? { strokeColor: color } : {}),
      ...(fill ? { backgroundColor: fill } : {}),
      ...(shape.dashed !== undefined ? { strokeStyle: shape.dashed ? "dashed" : "solid" } : {}),
    };
    if (existing.type === "text" && !existing.containerId) {
      if (shape.text !== undefined) {
        const lines = shape.text.split("\n");
        Object.assign(changes, { text: shape.text, originalText: shape.text, ...measure(lines, fontSize) });
      }
      if (shape.x !== undefined) changes.x = shape.x;
      if (shape.y !== undefined) changes.y = shape.y;
    } else if (existing.type !== "text" && !isLinear({ type: existing.type })) {
      if (shape.x !== undefined) changes.x = shape.x;
      if (shape.y !== undefined) changes.y = shape.y;
      if (shape.width !== undefined) changes.width = Math.max(10, shape.width);
      if (shape.height !== undefined) changes.height = Math.max(10, shape.height);
    } else if (existing.type !== "text" && (shape.x !== undefined || shape.y !== undefined || shape.width !== undefined || shape.height !== undefined)) {
      outcome.problems.push(`${name} is an arrow or line; delete it and draw it again to move it (arrows joined to shapes follow the shapes)`);
    }
    const touchedNow = Object.keys(changes).length > 0 || shape.text !== undefined;
    if (!touchedNow) return void outcome.problems.push(`nothing to change on ${name}`);
    next = revise(existing, changes);
    // The label follows its container: its text, its colour, and the middle of the shape.
    const bound = (next.boundElements ?? []).find((entry) => entry.type === "text");
    const labelElement = bound ? working.get(bound.id) : undefined;
    if (labelElement && !labelElement.isDeleted) {
      const text = shape.text ?? (typeof labelElement.originalText === "string" ? labelElement.originalText : "");
      const size = shape.fontSize ?? (typeof labelElement.fontSize === "number" ? labelElement.fontSize : FONT_SIZE);
      const remade = labelOn(next, text, size, color ?? (labelElement.strokeColor as string));
      revise(labelElement, { text: remade.text, originalText: remade.originalText, fontSize: size, x: remade.x, y: remade.y, width: remade.width, height: remade.height, strokeColor: remade.strokeColor });
    } else if (shape.text !== undefined && next.type !== "text") {
      const made = labelOn(next, shape.text, fontSize, color ?? next.strokeColor);
      put(made);
      next = revise(next, { boundElements: [...(next.boundElements ?? []), { id: made.id, type: "text" }] });
    }
    if (moved || resized) reroute(next);
    outcome.drawn.push({ name, id: existing.id, type: existing.type, action: "updated" });
  }

  /** Arrows joined to a shape that moved or changed size follow it; an end that is joined to nothing stays where it is. */
  function reroute(shape: SceneElement): void {
    for (const bound of shape.boundElements ?? []) {
      if (bound.type !== "arrow") continue;
      const arrow = working.get(bound.id);
      const points = arrow?.points as ReadonlyArray<readonly [number, number]> | undefined;
      // Only straight two-point arrows are re-aimed; a path someone bent in a browser is left as drawn.
      if (!arrow || arrow.isDeleted || arrow.type !== "arrow" || points?.length !== 2) continue;
      const startId = (arrow.startBinding as { elementId?: string } | null)?.elementId;
      const endId = (arrow.endBinding as { elementId?: string } | null)?.elementId;
      const from = startId ? working.get(startId) : undefined;
      const to = endId ? working.get(endId) : undefined;
      const loose = { start: { x: arrow.x, y: arrow.y }, end: { x: arrow.x + points[1]![0], y: arrow.y + points[1]![1] } };
      const next = revise(arrow, route(from && !from.isDeleted ? from : undefined, to && !to.isDeleted ? to : undefined, loose));
      const labelId = (next.boundElements ?? []).find((entry) => entry.type === "text")?.id;
      const text = labelId ? working.get(labelId) : undefined;
      if (text && !text.isDeleted) {
        const middle = arrowMiddle(next);
        revise(text, { x: middle.x - text.width / 2, y: middle.y - text.height / 2 });
      }
    }
  }

  function createElement(shape: DrawShape, name: string): void {
    const type = shape.type;
    if (!type) return void outcome.problems.push(`${name}: give it a type (rectangle, ellipse, diamond, text, arrow or line)`);
    const color = strokeColor(shape.color) ?? "#1e1e1e";
    const fill = fillColor(shape.fill) ?? "transparent";
    if (shape.color && !strokeColor(shape.color)) outcome.problems.push(`unknown colour "${shape.color}" for ${name}; drawn in black`);
    if (shape.fill && !fillColor(shape.fill)) outcome.problems.push(`unknown fill "${shape.fill}" for ${name}; drawn unfilled`);
    const fontSize = shape.fontSize ?? FONT_SIZE;
    const custom = shape.id && !working.has(shape.id) ? { id: shape.id } : {};
    const strokeStyle = shape.dashed ? "dashed" : "solid";
    let made: SceneElement | undefined;
    const extras: SceneElement[] = [];

    if (isShapeType(type)) {
      const size = fitShape(type, shape.text, fontSize);
      const width = Math.max(10, shape.width ?? size.width);
      const height = Math.max(10, shape.height ?? size.height);
      const at = shape.x !== undefined && shape.y !== undefined ? { x: shape.x, y: shape.y } : place(width, height);
      made = base(type, { ...custom, x: shape.x ?? at.x, y: shape.y ?? at.y, width, height, strokeColor: color, backgroundColor: fill, strokeStyle, roundness: type === "ellipse" ? null : { type: type === "rectangle" ? 3 : 2 } });
      if (shape.text) {
        const text = label(made, shape.text, fontSize, color);
        made = { ...made, boundElements: [{ id: text.id, type: "text" }] };
        extras.push(text);
      }
    } else if (type === "text") {
      if (!shape.text) return void outcome.problems.push(`${name}: a text element needs its text`);
      const lines = shape.text.split("\n");
      const size = measure(lines, fontSize);
      const at = shape.x !== undefined && shape.y !== undefined ? { x: shape.x, y: shape.y } : place(size.width, size.height);
      made = { ...textElement(shape.text, { x: shape.x ?? at.x, y: shape.y ?? at.y, fontSize, color }), ...custom };
    } else if (type === "arrow" || type === "line") {
      made = createLinear(type, shape, name, color, strokeStyle, custom);
      if (made && shape.text) {
        const text = labelOn(made, shape.text, fontSize, color);
        made = { ...made, boundElements: [...(made.boundElements ?? []), { id: text.id, type: "text" }] };
        extras.push(text);
      }
    } else {
      return void outcome.problems.push(`${name}: cannot draw a "${type}"; use rectangle, ellipse, diamond, text, arrow or line`);
    }
    if (!made) return;
    names.set(name, made.id);
    if (shape.id) names.set(shape.id, made.id);
    put(made);
    for (const extra of extras) put(extra);
    if (made.type === "arrow") {
      for (const key of ["startBinding", "endBinding"] as const) {
        const target = made[key] as { elementId?: string } | null;
        if (target?.elementId) attach(target.elementId, made.id);
      }
    }
    outcome.drawn.push({ name, id: made.id, type: made.type, action: "created" });
  }

  function createLinear(type: "arrow" | "line", shape: DrawShape, name: string, color: string, strokeStyle: string, custom: { id?: string }): SceneElement | undefined {
    const common = { ...custom, strokeColor: color, strokeStyle, roundness: { type: 2 }, lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: type === "arrow" ? "arrow" : null, ...(type === "arrow" ? { elbowed: false } : { polygon: false }) };
    if ((shape.from !== undefined || shape.to !== undefined) && type === "line") return void outcome.problems.push(`${name}: a line does not join shapes; use an arrow, or give points`);
    if (shape.from !== undefined || shape.to !== undefined) {
      const from = resolve(shape.from);
      const to = resolve(shape.to);
      if (!shape.from || !shape.to) return void outcome.problems.push(`${name}: an arrow between shapes needs both from and to`);
      if (!from || !to) return void outcome.problems.push(`${name}: no shape with id ${!from ? shape.from : shape.to} (draw it in the same request, or use an id from excalidraw_read)`);
      if (from.id === to.id) return void outcome.problems.push(`${name}: from and to are the same shape`);
      return base(type, { ...common, ...joinShapes(from, to) });
    }
    const points = shape.points;
    if (!points || points.length < 2 || points.some((point) => point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
      return void outcome.problems.push(`${name}: an ${type} needs from and to (shape ids), or points: [[x, y], [x, y], …] with at least two`);
    }
    const [first] = points as [readonly [number, number]];
    const relative = points.map((point) => [point[0] - first[0], point[1] - first[1]]);
    const xs = relative.map((point) => point[0]!);
    const ys = relative.map((point) => point[1]!);
    return base(type, { ...common, x: first[0], y: first[1], width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points: relative });
  }

  outcome.changed = [...touched.values()];
  return outcome;
}

/* ------------------------------------------------------------- reading */

function quoted(text: string): string {
  const flat = plainText(text);
  return `"${flat.length > 80 ? `${flat.slice(0, 79)}…` : flat}"`;
}

function where(element: SceneElement): string {
  return `at ${Math.round(element.x)},${Math.round(element.y)}${element.width || element.height ? ` ${Math.round(element.width)}×${Math.round(element.height)}` : ""}`;
}

/** The label a shape or arrow carries, from its bound text element. */
function labelOf(element: SceneElement, scene: ReadonlyMap<string, SceneElement>): string {
  const bound = (element.boundElements ?? []).find((entry) => entry.type === "text");
  const text = bound ? scene.get(bound.id) : undefined;
  return text && !text.isDeleted && typeof text.originalText === "string" ? text.originalText : typeof text?.text === "string" && !text.isDeleted ? text.text : "";
}

/** How many elements one reading lists before it says how many more there are. */
const READ_LIMIT = 120;
const READ_CHARS = 16_000;

/**
 * A scene in words: shapes with their labels, arrows as `from → to`, free
 * text, and a count of what is only drawing (freehand, images). Ids are there
 * so the reader can move, recolour or delete what it names.
 */
export function describeScene(scene: ReadonlyMap<string, SceneElement>, name: string): string {
  const shown = [...scene.values()].filter((element) => !element.isDeleted);
  const bounds = sceneBounds(shown);
  // A label is part of its shape, not one more thing on the board.
  const things = shown.filter((element) => !(element.type === "text" && element.containerId)).length;
  const head = `Excalidraw session "${name}": ${shown.length === 0 ? "the board is empty" : `${things} element${things === 1 ? "" : "s"}, spanning x ${bounds!.x1}…${bounds!.x2}, y ${bounds!.y1}…${bounds!.y2}`}.`;
  const lines: string[] = [];
  const other = new Map<string, number>();
  for (const element of shown) {
    if (element.type === "text" && element.containerId) continue;
    if (element.type === "text") lines.push(`text ${quoted(String(element.originalText ?? element.text ?? ""))} id=${element.id} ${where(element)}`);
    else if (isShapeType(element.type)) {
      const text = labelOf(element, scene);
      lines.push(`${element.type} ${text ? `${quoted(text)} ` : ""}id=${element.id} ${where(element)}${element.backgroundColor && element.backgroundColor !== "transparent" ? ` fill ${element.backgroundColor}` : ""}`);
    } else if (element.type === "arrow" || element.type === "line") {
      const ends = ["startBinding", "endBinding"].map((key) => {
        const binding = element[key] as { elementId?: string } | null;
        const target = binding?.elementId ? scene.get(binding.elementId) : undefined;
        if (!target || target.isDeleted) return undefined;
        return labelOf(target, scene) || `${target.type} ${target.id}`;
      });
      const text = labelOf(element, scene);
      const route = ends[0] || ends[1] ? `${ends[0] ? quoted(ends[0]) : "(loose end)"} ${element.type === "arrow" ? "→" : "—"} ${ends[1] ? quoted(ends[1]) : "(loose end)"}` : where(element);
      lines.push(`${element.type} ${route}${text ? ` labelled ${quoted(text)}` : ""} id=${element.id}`);
    } else if (element.type === "frame" || element.type === "magicframe") lines.push(`frame${element.name ? ` ${quoted(String(element.name))}` : ""} id=${element.id} ${where(element)}`);
    else other.set(element.type, (other.get(element.type) ?? 0) + 1);
  }
  // The most a reading holds: a line count, and a size (long labels can make a few lines a lot of text).
  let size = 0;
  const kept = lines.slice(0, READ_LIMIT).filter((line) => (size += line.length + 3) <= READ_CHARS);
  const listed = kept.map((line) => `- ${line}`);
  const more = lines.length > kept.length ? [`… and ${lines.length - kept.length} more elements not listed`] : [];
  const drawn = [...other].map(([type, count]) => `${count} ${type}${count === 1 ? "" : type.endsWith("s") ? "" : "s"}`);
  const rest = drawn.length > 0 ? [`Also on the board (drawings, not described): ${drawn.join(", ")}.`] : [];
  return [head, ...listed, ...more, ...rest].join("\n");
}
