import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The hourglass ships as a single self-contained HTML file. Its pure logic core
 * lives in `<script type="module" id="hourglass-core">`; the scene module reads
 * it from `globalThis.HourglassCore`. We extract that block and import it as a
 * data: URL so the shipped artifact stays a single file and these tests stay
 * hermetic (no browser, no network, no temp files).
 */

interface Material {
  id: string;
  label: string;
  color: number;
  gravity: number;
  drag: number;
  viscosity: number;
  cohesion: number;
  repose: number;
  wave: number;
  roughness: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  floor: number;
}

interface SimState {
  duration: number;
  material: string;
  particleCount: number;
  seed: number;
  rng: number;
  mass: number[];
  upper: number;
  flow: number;
  running: boolean;
  complete: boolean;
  time: number;
  spawn: number;
  surface: number[][];
  particles: Particle[];
}

interface SimOptions {
  duration?: unknown;
  material?: unknown;
  particleCount?: unknown;
  seed?: unknown;
}

interface HourglassModule {
  MATERIALS: Record<string, Material>;
  createSim(options?: SimOptions): SimState;
  stepSim(state: SimState, dt: number): SimState;
  flip(state: SimState): SimState;
  reset(state: SimState): SimState;
  setMaterial(state: SimState, id: string): SimState;
  remainingSeconds(state: unknown): number;
  formatClock(seconds: unknown): string;
}

const html = readFileSync(new URL("../examples/hourglass.html", import.meta.url), "utf8");
const scriptMatch = /<script type="module" id="hourglass-core">([\s\S]*?)<\/script>/.exec(html);
if (!scriptMatch?.[1]) {
  throw new Error("examples/hourglass.html must embed <script type=\"module\" id=\"hourglass-core\">");
}
const coreUrl = `data:text/javascript;base64,${Buffer.from(scriptMatch[1]).toString("base64")}`;
const core = (await import(coreUrl)) as unknown as HourglassModule;

const IDS = ["water", "sand", "goo", "coke"] as const;

/** Assert that every number reachable from `value` is finite (no NaN leaks). */
function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite, got ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteNumbers(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertFiniteNumbers(item, `${path}.${key}`);
  }
}

function stepMany(state: SimState, dt: number, count: number): void {
  for (let i = 0; i < count; i++) core.stepSim(state, dt);
}

test("MATERIALS exposes the four frozen recipe ids", () => {
  assert.deepEqual(Object.keys(core.MATERIALS).sort(), [...IDS].sort());
  for (const id of IDS) {
    const material = core.MATERIALS[id]!;
    assert.equal(material.id, id);
    assert.ok(material.label.length > 0, `${id} has a label`);
    assertFiniteNumbers(material, `MATERIALS.${id}`);
  }
});

test("formatClock is total and hits the minute/hour boundaries", () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, -0.5, undefined, null, "60", {}, [], () => 0]) {
    assert.equal(core.formatClock(bad), "0:00", `formatClock(${String(bad)})`);
  }
  assert.equal(core.formatClock(0), "0:00");
  assert.equal(core.formatClock(59.9), "0:59");
  assert.equal(core.formatClock(60), "1:00");
  assert.equal(core.formatClock(3599), "59:59");
  assert.equal(core.formatClock(3600), "1:00:00");
});

test("createSim applies defaults and clamps invalid options to finite values", () => {
  const defaults = core.createSim();
  assert.equal(defaults.duration, 60);
  assert.equal(defaults.material, "sand");
  assert.equal(defaults.particleCount, 900);
  assert.equal(defaults.mass[0], 1);
  assert.equal(defaults.mass[1], 0);
  assert.equal(core.remainingSeconds(defaults), 60);

  for (const duration of [NaN, -5, 0, 1e9, "nope", undefined]) {
    const state = core.createSim({ duration });
    assert.ok(Number.isFinite(state.duration) && state.duration > 0, `duration ${String(duration)} -> ${state.duration}`);
  }
  assert.equal(core.createSim({ duration: -5 }).duration, 1);
  assert.equal(core.createSim({ duration: 1e9 }).duration, 86400);
  assert.equal(core.createSim({ particleCount: -1 }).particleCount, 0);
  assert.equal(core.createSim({ particleCount: 1e9 }).particleCount, 4000);
  assert.equal(core.createSim({ material: "plasma" }).material, "sand");
  assert.equal(core.createSim({ material: "goo" }).material, "goo");
});

test("remainingSeconds tracks the upper mass and is bounded", () => {
  const state = core.createSim({ duration: 2, particleCount: 0 });
  assert.equal(core.remainingSeconds(state), 2);
  stepMany(state, 0.1, 10); // exactly half of the 2s duration
  assert.ok(Math.abs(core.remainingSeconds(state) - 1) < 1e-6, `half -> ${core.remainingSeconds(state)}`);
  stepMany(state, 0.1, 10); // the rest
  assert.equal(core.remainingSeconds(state), 0);
  assert.equal(state.complete, true);

  assert.equal(core.remainingSeconds(null), 0);
  assert.equal(core.remainingSeconds({}), 0);
  assert.equal(core.remainingSeconds({ mass: [NaN, 2], upper: 0, duration: 60 }), 0);
  assert.equal(core.remainingSeconds({ mass: [5, -3], upper: 0, duration: 60 }), 60, "clamped to duration");
  assert.equal(core.remainingSeconds({ mass: [-5, 7], upper: 0, duration: 60 }), 0, "clamped to zero");
});

test("mass is conserved across hundreds of steps", () => {
  const state = core.createSim({ duration: 1000, particleCount: 0 });
  for (let i = 0; i < 400; i++) {
    core.stepSim(state, 0.05);
    assert.ok(Math.abs(state.mass[0]! + state.mass[1]! - 1) < 1e-6, `mass sum at step ${i}`);
  }
  assert.ok(Math.abs(core.remainingSeconds(state) - (1000 - 400 * 0.05)) < 1e-6);
});

test("a paused sim does not drain", () => {
  const state = core.createSim({ duration: 10, particleCount: 0 });
  state.running = false;
  const before = core.remainingSeconds(state);
  stepMany(state, 0.1, 100);
  assert.equal(core.remainingSeconds(state), before);
  assert.equal(state.mass[0], 1);
});

test("dt guards (0, negative, non-finite, huge) keep the state finite", () => {
  const state = core.createSim({ duration: 60, particleCount: 50 });
  for (const dt of [0, -1, NaN, Infinity, -Infinity, 1e9]) {
    core.stepSim(state, dt);
    assertFiniteNumbers(state, "state");
    assert.ok(Number.isFinite(core.remainingSeconds(state)));
  }
  // A huge dt is clamped to MAX_DT, not applied whole.
  const fresh = core.createSim({ duration: 60, particleCount: 0 });
  core.stepSim(fresh, 1e9);
  assert.ok(fresh.time <= 0.1 + 1e-9, `time ${fresh.time} must be clamped`);
});

test("flip swaps the active chamber and reverses the clock direction", () => {
  const state = core.createSim({ duration: 2, particleCount: 0 });
  stepMany(state, 0.1, 10);
  const half = core.remainingSeconds(state);
  core.flip(state);
  assert.equal(state.upper, 1);
  assert.equal(state.flow, -1);
  assert.ok(Math.abs(core.remainingSeconds(state) - half) < 1e-6, "flip preserves the remaining amount");
  assert.ok(Math.abs(core.remainingSeconds(state) - 1) < 1e-6, "half of a 2s run stays ~1s");
  core.flip(state);
  assert.equal(state.upper, 0);
  assert.equal(state.flow, 1);
});

test("flip after completion restarts from the full lower chamber", () => {
  const state = core.createSim({ duration: 1, particleCount: 0 });
  stepMany(state, 0.1, 10);
  assert.equal(state.complete, true);
  core.flip(state);
  assert.equal(state.complete, false);
  assert.equal(core.remainingSeconds(state), 1);
});

test("reset restores full mass, clock and running state", () => {
  const state = core.createSim({ duration: 3, particleCount: 100 });
  stepMany(state, 0.1, 15);
  state.running = false;
  core.reset(state);
  assert.deepEqual(state.mass, [1, 0]);
  assert.equal(state.upper, 0);
  assert.equal(state.flow, 1);
  assert.equal(state.running, true);
  assert.equal(state.complete, false);
  assert.equal(state.time, 0);
  assert.equal(core.remainingSeconds(state), 3);
  assert.equal(state.particles.length, 0);
});

test("setMaterial switches all four recipes and ignores unknown ids", () => {
  for (const id of IDS) {
    const state = core.createSim({ duration: 1, particleCount: 400, material: "sand" });
    core.setMaterial(state, id);
    assert.equal(state.material, id);
    stepMany(state, 0.1, 10);
    assertFiniteNumbers(state.surface, `${id}.surface`);
    assertFiniteNumbers(state.particles, `${id}.particles`);
    assert.ok(state.particles.length > 0, `${id} spawns particles`);
    assert.ok(Number.isFinite(core.remainingSeconds(state)));
  }
  const state = core.createSim();
  core.setMaterial(state, "plasma");
  assert.equal(state.material, "sand");
});

test("the simulation is deterministic for a fixed seed and dt sequence", () => {
  const run = (seed: number) => {
    const state = core.createSim({ duration: 1, particleCount: 900, seed });
    for (let i = 0; i < 5; i++) core.stepSim(state, 0.1);
    return state;
  };
  const a = run(1);
  const b = run(1);
  assert.ok(a.particles.length > 0, "the run produced particles");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "same seed -> identical state");

  const c = run(2);
  assert.notEqual(JSON.stringify(a.particles), JSON.stringify(c.particles), "different seed -> different particles");
  assertFiniteNumbers(c, "seed2");
});
