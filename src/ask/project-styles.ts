/**
 * A mockup in the project's own clothes. An `htmlPreview` can name the
 * project's stylesheets (`stylesheets: ["src/index.css"]`); before the
 * question is asked their rules are read and put in front of the mockup's own
 * CSS, so the mockup wears the project's real tokens, fonts stacks and
 * component classes instead of an approximation of them. Tailwind v4 sources
 * are made readable for a browser on the way: `@theme` blocks become `:root`
 * (their variables are the design tokens) and build-time directives
 * (`@import`, `@plugin`, `@apply`, …) are dropped. Paths outside the project,
 * files that are not CSS and anything past the size cap are refused.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { MAX_PREVIEW_CSS } from "./types.ts";

/** How many stylesheets one mockup may name. */
export const MAX_STYLESHEETS = 6;

/** The browser-readable rules of one project stylesheet. */
export function browserCss(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@theme(\s+(inline|static|reference))*\s*\{/g, ":root {")
    .replace(/@(import|plugin|source|config|reference|custom-variant|tailwind)\b[^;{]*;/g, "")
    .replace(/@apply\b[^;}]*;?/g, "")
    .replace(/url\([^)]*\)/g, "none")
    .replace(/image-set\([^;]*\)/g, "none")
    // The preview refuses a whole stylesheet that holds a backslash (escaped class names, CSS escapes), so those rules go.
    .replace(/[^{}]*\{[^{}]*\}/g, (rule) => (rule.includes("\\") ? "" : rule))
    .replace(/^[^{}\n]*\\[^{}\n]*;\s*$/gm, "")
    .replace(/(expression|behavior|-moz-binding)[^;}]*;?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Read the named stylesheets from the project; throws with a reason the model can act on. */
export function projectStyles(root: string, paths: readonly string[]): string {
  if (paths.length > MAX_STYLESHEETS) throw new Error(`name at most ${MAX_STYLESHEETS} stylesheets`);
  const base = realpathSync(root);
  const parts: string[] = [];
  for (const path of paths) {
    if (![".css", ".pcss"].includes(extname(path).toLowerCase())) throw new Error(`${path} is not a .css file`);
    let file: string;
    try {
      file = realpathSync(resolve(base, path));
    } catch {
      throw new Error(`${path} does not exist in the project`);
    }
    const inside = relative(base, file);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`${path} is outside the project`);
    if (!statSync(file).isFile()) throw new Error(`${path} is not a file`);
    parts.push(`/* ${inside} */\n${browserCss(readFileSync(file, "utf8"))}`);
  }
  return parts.join("\n");
}

/** The mockup's CSS with the project's stylesheets in front; throws when the whole would not fit. */
export function withProjectStyles(root: string, preview: { html: string; css?: string; stylesheets?: string[] }): { html: string; css?: string } {
  const { stylesheets, ...rest } = preview;
  if (!stylesheets?.length) return rest;
  const css = [projectStyles(root, stylesheets), rest.css ?? ""].filter(Boolean).join("\n");
  if (css.length > MAX_PREVIEW_CSS) throw new Error(`the stylesheets and the mockup's CSS come to ${css.length} characters, over the ${MAX_PREVIEW_CSS} a mockup can carry: name the file with the design tokens and the components the mockup uses, not the whole build`);
  return { ...rest, css };
}
