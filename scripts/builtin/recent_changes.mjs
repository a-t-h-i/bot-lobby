#!/usr/bin/env node
// purpose: show the latest commits that touched a file or folder (date, author, message, size), to learn why code is the way it is before changing it
// usage: node {script} <path> [--n <count>]
import { fail, parseArgs, projectRoot, sh } from "./lib/common.mjs";

const { flags, rest } = parseArgs();
const path = rest[0];
if (!path) fail("usage: recent_changes.mjs <path> [--n <count>]");
const root = projectRoot();
const n = Number(flags.n ?? 10);
const log = sh("git", ["log", `-n${n}`, "--date=short", "--format=%h %ad %an: %s", "--shortstat", "--follow", "--", path], { cwd: process.cwd() });
const fallback = log.code === 0 ? log : sh("git", ["log", `-n${n}`, "--date=short", "--format=%h %ad %an: %s", "--shortstat", "--", path], { cwd: root });
const out = fallback.out.split("\n").filter((row) => row.trim()).map((row) => (row.startsWith(" ") ? `    ${row.trim()}` : row)).join("\n");
console.log(out || `No commits touch ${path}.`);
