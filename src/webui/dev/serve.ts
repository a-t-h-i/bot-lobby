/**
 * `npm run web:dev`: the real loopback server with a fixture-backed service,
 * so the page builds with no Pi. The scenario comes from `--scenario=<name>`
 * or `WEB_SCENARIO` (default `full`); the printed link carries it as
 * `?scenario=`. This is a dev CLI, so stdout is allowed here only — the
 * production server still writes nothing. Rebuild with `npm run web:build`,
 * then reload the page when `webui/dist` changes (the watcher says so).
 */
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../state/project.ts";
import { startWebServer } from "../server.ts";
import { createFixtureService } from "./fake-service.ts";
import { resolveScenario } from "./fixtures.ts";

/** `--scenario=<name>` wins, then `WEB_SCENARIO`, then the default. */
function argScenario(): string | undefined {
  const found = process.argv.slice(2).find((arg) => arg.startsWith("--scenario="));
  return found ? found.slice("--scenario=".length) : process.env.WEB_SCENARIO;
}

/** Config `lobby.web.port` (0 means any free port); an unreadable config means 0. */
function configuredPort(): number {
  try {
    return loadConfig().lobby.web.port ?? 0;
  } catch {
    return 0;
  }
}

/** The server link with the scenario in its query string. */
function withScenario(link: string, scenario: string): string {
  return link.replace("#", `?scenario=${scenario}#`);
}

/** Say when a rebuild lands, so the page gets reloaded; keep it to a line. */
function watchDist(): void {
  const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "webui", "dist");
  try {
    watch(dist, () => {
      console.log("webui/dist changed — reload the page (rebuild: npm run web:build)");
    });
  } catch {
    console.log("webui/dist is missing — build it first: npm run web:build");
  }
}

const scenario = resolveScenario(argScenario());
const service = createFixtureService(scenario);
const server = await startWebServer({ service, port: configuredPort() });
console.log(`bot-lobby mock [${scenario}]: ${withScenario(server.link, scenario)}`);
console.log("switch sets: WEB_SCENARIO=<name> npm run web:dev (or --scenario=<name>)");
watchDist();
