import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = import.meta.dirname

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  html: {
    cspNonce: "__CSP_NONCE__",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: [
      // The diff library's "shiki" with a short list of languages (see the file).
      { find: /^shiki$/, replacement: resolve(root, "src/app/code/shiki.ts") },
      // Only its own Pierre themes, not the dozens of Shiki themes beside them.
      { find: /^@pierre\/theming\/themes$/, replacement: resolve(root, "src/app/code/themes.ts") },
      { find: "@", replacement: resolve(root, "src") },
      { find: "@protocol", replacement: resolve(root, "../src/webui/protocol.ts") },
      { find: "@shared", replacement: resolve(root, "../src/lobby/prompts.ts") },
      { find: "@palette", replacement: resolve(root, "../src/webui/palette-core.ts") },
    ],
  },
})
