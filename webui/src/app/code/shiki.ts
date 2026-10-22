/**
 * What the diff library asks of "shiki", with a short list of languages:
 * the full bundle would put some three hundred grammar and theme files in
 * `webui/dist`. Vite points "shiki" here (see `vite.config.ts`). A file in a
 * language not listed shows as plain text. The library brings its own themes.
 */
import { createBundledHighlighter, createSingletonShorthands, type BundledHighlighterOptions, type DynamicImportLanguageRegistration, type HighlighterGeneric } from "@shikijs/core"
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma"
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript"

export * from "@shikijs/core"
export { createOnigurumaEngine, createJavaScriptRegexEngine }

/** The languages a project is likely to hold, by the names the diff library gives file types. */
export const bundledLanguages: Record<string, DynamicImportLanguageRegistration> = {
  astro: () => import("@shikijs/langs/astro"),
  c: () => import("@shikijs/langs/c"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  dotenv: () => import("@shikijs/langs/dotenv"),
  fish: () => import("@shikijs/langs/fish"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  json5: () => import("@shikijs/langs/json5"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsonl: () => import("@shikijs/langs/jsonl"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  kts: () => import("@shikijs/langs/kts"),
  less: () => import("@shikijs/langs/less"),
  lua: () => import("@shikijs/langs/lua"),
  makefile: () => import("@shikijs/langs/makefile"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  prisma: () => import("@shikijs/langs/prisma"),
  properties: () => import("@shikijs/langs/properties"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  sass: () => import("@shikijs/langs/sass"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  yml: () => import("@shikijs/langs/yml"),
  zsh: () => import("@shikijs/langs/zsh"),
}

type Highlighter = HighlighterGeneric<string, string>

export const createHighlighter: (options: BundledHighlighterOptions<string, string>) => Promise<Highlighter> = createBundledHighlighter<string, string>({
  langs: bundledLanguages,
  themes: {},
  engine: () => createJavaScriptRegexEngine(),
})

export const { codeToHtml, codeToHast, codeToTokens, codeToTokensBase, codeToTokensWithThemes, getSingletonHighlighter, getLastGrammarState } = createSingletonShorthands(createHighlighter)
