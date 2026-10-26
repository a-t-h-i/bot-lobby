#!/usr/bin/env node
// purpose: find circular imports between the project's JS/TS and Python modules (type-only imports ignored); by default only cycles through files changed on the branch
// usage: node {script} [--all] [--base <ref>]
import { baseRef, changedFiles, importGraph, parseArgs, projectRoot } from "./lib/common.mjs";

const { flags } = parseArgs();
const root = projectRoot();
const graph = importGraph(root);
const changed = flags.all ? undefined : new Set(changedFiles(root, baseRef(root, flags.base)));

// Tarjan's strongly connected components: every module in one with more than one member sits on a cycle.
let index = 0;
const stack = [];
const on = new Set();
const idx = new Map();
const low = new Map();
const groups = [];
function connect(node) {
  // Iterative, so a deep import chain cannot overflow the stack.
  const work = [[node, 0]];
  idx.set(node, index); low.set(node, index); index += 1; stack.push(node); on.add(node);
  while (work.length) {
    const frame = work[work.length - 1];
    const [at, i] = frame;
    const next = graph.get(at) ?? [];
    if (i < next.length) {
      frame[1] += 1;
      const to = next[i];
      if (!idx.has(to)) {
        idx.set(to, index); low.set(to, index); index += 1; stack.push(to); on.add(to);
        work.push([to, 0]);
      } else if (on.has(to)) low.set(at, Math.min(low.get(at), idx.get(to)));
      continue;
    }
    work.pop();
    if (work.length) low.set(work[work.length - 1][0], Math.min(low.get(work[work.length - 1][0]), low.get(at)));
    if (low.get(at) === idx.get(at)) {
      const group = [];
      let top;
      do { top = stack.pop(); on.delete(top); group.push(top); } while (top !== at);
      if (group.length > 1 || (graph.get(at) ?? []).includes(at)) groups.push(group);
    }
  }
}
for (const node of graph.keys()) if (!idx.has(node)) connect(node);

/** One shortest loop through `start` inside its group, to show how the cycle closes. */
function loop(start, members) {
  const inside = new Set(members);
  const prev = new Map([[start, undefined]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift();
    for (const to of graph.get(at) ?? []) {
      if (!inside.has(to)) continue;
      if (to === start) {
        const path = [at];
        while (prev.get(path[0]) !== undefined) path.unshift(prev.get(path[0]));
        return [...path, start];
      }
      if (!prev.has(to)) { prev.set(to, at); queue.push(to); }
    }
  }
  return [start];
}

const shown = groups.filter((group) => !changed || group.some((file) => changed.has(file)));
if (shown.length === 0) {
  console.log(`No circular imports${changed ? " through changed files" : ""} (${graph.size} modules checked).`);
  process.exit(0);
}
console.log(`# ${shown.length} import cycle(s)${changed ? " through changed files" : ""}${changed && groups.length > shown.length ? `; ${groups.length - shown.length} more elsewhere (--all)` : ""}`);
for (const group of shown.sort((a, b) => a.length - b.length)) {
  const start = group.find((file) => changed?.has(file)) ?? group.sort()[0];
  console.log(`## ${group.length} module(s)`);
  console.log(`  ${loop(start, group).join("\n  → ")}`);
  if (group.length > 8) console.log(`  (the cycle group also holds ${group.length - loop(start, group).length + 1} more)`);
}
process.exit(1);
