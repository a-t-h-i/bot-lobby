#!/usr/bin/env node
// Installs Bot Lobby's herdr pieces into the Herdr app's home: the composer mod, the "bot-herdr"
// layout (Herdr's main layout with the composer under the panes) and its light and dark themes,
// and the composer's key (ctrl+shift+m). Then checks the mod with `herdr-app check` if it can.
//
//   node herdr/install.mjs            install (keeps your edited layout and your own keys)
//   node herdr/install.mjs --force    also replace the layout file
//   node herdr/install.mjs --switch   then switch the open window to the layout
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const appHome = process.env.HERDR_APP_HOME
  || (process.platform === "win32" && process.env.APPDATA ? join(process.env.APPDATA, "herdr-app") : null)
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "herdr-app");

if (!existsSync(appHome)) {
  console.error(`No Herdr app home at ${appHome}. Open Herdr once, or set HERDR_APP_HOME.`);
  process.exit(1);
}

// The mod is ours: replace the whole folder.
const mod = join(appHome, "mods", "bot-herdr");
rmSync(mod, { recursive: true, force: true });
mkdirSync(dirname(mod), { recursive: true });
cpSync(join(here, "mods", "bot-herdr"), mod, { recursive: true });
console.log(`mod      ${mod}`);

for (const name of ["bot-herdr-light.json", "bot-herdr-dark.json"]) {
  mkdirSync(join(appHome, "themes"), { recursive: true });
  cpSync(join(here, "themes", name), join(appHome, "themes", name));
}
console.log(`themes   ${join(appHome, "themes")}/bot-herdr-{light,dark}.json`);

const layout = join(appHome, "layouts", "bot-herdr.json");
if (!existsSync(layout) || args.has("--force")) {
  mkdirSync(dirname(layout), { recursive: true });
  cpSync(join(here, "layouts", "bot-herdr.json"), layout);
  console.log(`layout   ${layout}`);
} else {
  console.log(`layout   kept your ${layout} (--force replaces it)`);
}

// Keys: add ours, never replace one you already bound.
const keysFile = join(appHome, "keys.json");
const ours = JSON.parse(readFileSync(join(here, "keys.json"), "utf8"));
let keys = {};
if (existsSync(keysFile)) {
  try {
    keys = JSON.parse(readFileSync(keysFile, "utf8"));
  } catch {
    console.error(`keys     ${keysFile} isn't valid JSON; left alone. Add: ${JSON.stringify(ours)}`);
    keys = null;
  }
}
if (keys) {
  let added = 0;
  for (const [section, bindings] of Object.entries(ours)) {
    keys[section] ??= {};
    for (const [key, action] of Object.entries(bindings)) {
      if (keys[section][key] === undefined) {
        keys[section][key] = action;
        added++;
      } else if (keys[section][key] !== action) {
        console.log(`keys     ${key} is already ${JSON.stringify(keys[section][key])}; bind ${action} yourself`);
      }
    }
  }
  if (added) {
    writeFileSync(keysFile, JSON.stringify(keys, null, 2) + "\n");
    console.log(`keys     added ${added} to ${keysFile}`);
  }
}

const check = spawnSync("herdr-app", ["check", mod], { stdio: "inherit" });
if (check.error) console.log("check    herdr-app isn't on PATH; run: herdr-app check " + mod);
else if (check.status !== 0) process.exit(check.status ?? 1);

if (args.has("--switch")) spawnSync("herdr-app", ["do", "layout.switch", "--name", "bot-herdr"], { stdio: "inherit" });
else console.log('switch   herdr-app do layout.switch --name bot-herdr   (or ctrl+shift+l)');
