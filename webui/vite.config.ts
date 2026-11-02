import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = import.meta.dirname
const src = resolve(root, "src")

/*
 * The root font size (index.css) sets the scale of the whole UI. Every px
 * size in our own CSS, Tailwind's arbitrary values included, becomes rem
 * here so it follows that scale too. 15px is the root size the px values
 * were drawn against (93.75%), so nothing moves until the root changes.
 * Hairlines (2px and under) stay px so they keep crisp. Media query
 * thresholds are not declarations and stay px. Rules for touch screens
 * (pointer: coarse) keep their px: they guard tap and input sizes.
 * Registered properties (@property) keep theirs too: a browser drops the
 * whole rule if its initial-value is in rem, and the property then jumps
 * instead of animating (the bays' --wL/--wT widths did).
 */
const PX_BASE = 15
const pxToRem = () => ({
  postcssPlugin: "bot-lobby-px-to-rem",
  Declaration(decl: { value: string; source?: { input?: { file?: string } }; parent?: unknown }) {
    if (!decl.value.includes("px")) return
    const file = decl.source?.input?.file ?? ""
    if (!file.startsWith(src)) return
    for (let node = decl.parent as { type?: string; name?: string; params?: string; parent?: unknown } | undefined; node; node = node.parent as typeof node) {
      if (node.type === "atrule" && node.name === "media" && /pointer:\s*coarse/.test(node.params ?? "")) return
      if (node.type === "atrule" && node.name === "property") return
    }
    // Inline images (url(...)) keep their own units.
    decl.value = decl.value.split(/(url\([^)]*\))/).map((part) => part.startsWith("url(") ? part : part.replace(/(^|[^\w.-])(-?\d*\.?\d+)px\b/g, (match, lead: string, num: string) => {
      const n = Number(num)
      if (Math.abs(n) <= 2) return match
      return `${lead}${Number((n / PX_BASE).toFixed(5))}rem`
    })).join("")
  },
})

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  css: {
    postcss: { plugins: [pxToRem()] },
  },
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
