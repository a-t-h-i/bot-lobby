/**
 * Serve the built page with the fake service, for working on the page
 * without Pi or a model (`npm run serve`). Prints the link to open.
 */
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startLobbyServer } from "./server.ts";
import { FakeService } from "./service.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await startLobbyServer({
  service: new FakeService(),
  secret: randomBytes(32),
  staticDir: join(root, "dist"),
  port: Number(process.env.PORT ?? 0),
});
console.log(`bot-lobby web (fake oracle): ${server.link}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void server.close().then(() => process.exit(0)));
