import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const webuiDir = resolve(here, "..")
const repoRoot = resolve(webuiDir, "..")
const distDir = join(webuiDir, "dist")

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

const required = [
  join(webuiDir, "index.html"),
  join(webuiDir, "vite.config.ts"),
  join(webuiDir, "components.json"),
  join(webuiDir, "tsconfig.json"),
  ...walk(join(webuiDir, "src")),
]
const optional = [
  join(repoRoot, "src/lobby/prompts.ts"),
  join(repoRoot, "src/webui/protocol.ts"),
].filter((file) => existsSync(file))

const files = [...required, ...optional]
  .sort()
  .map((file) => ({
    path: relative(repoRoot, file).split("\\").join("/"),
    sha256: sha256(file),
  }))

const hash = createHash("sha256")
  .update(files.map((file) => `${file.path}:${file.sha256}`).join("\n"))
  .digest("hex")

mkdirSync(distDir, { recursive: true })
writeFileSync(
  join(distDir, "build.json"),
  `${JSON.stringify({ hash, builtAt: new Date().toISOString(), files }, null, 2)}\n`
)
console.log(`build.json ${hash}`)
