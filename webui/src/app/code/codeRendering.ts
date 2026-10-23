// Adapted from T3 Code (MIT), apps/web/src/lib/diffRendering.ts (DIFF_SURFACE_THEME_UNSAFE_CSS, resolveDiffThemeName),
// apps/web/src/components/diffs/StyledDiffCodeView.tsx (DIFF_VIEW_UNSAFE_CSS) and apps/web/src/components/files/fileSurfaceChrome.tsx
/**
 * How the code viewer's surfaces look inside the diff library's shadow root:
 * the code sits on the page's own `--code-background`, the gutter and row
 * tints are mixed from it, and additions and deletions take the theme's
 * success and destructive colours, muted. The library's file header is off;
 * the viewer draws its own.
 */

export type CodeThemeName = "pierre-light" | "pierre-dark"

export function codeThemeName(dark: boolean): CodeThemeName {
  return dark ? "pierre-dark" : "pierre-light"
}

/** Always highlight with the WASM engine: the JS regex engine can backtrack for a very long time on some grammars. */
export const PREFERRED_HIGHLIGHTER = "shiki-wasm" as const

export const CODE_SURFACE_CSS = `
:host, [data-diffs-header], [data-diff], [data-file], [data-error-wrapper], [data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--code-background) !important;
  --diffs-light-bg: var(--code-background) !important;
  --diffs-dark-bg: var(--code-background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code-background) 94%, var(--code-foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--code-background) 95%, var(--code-foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code-background) 90%, var(--code-foreground));
  --diffs-bg-addition-override: light-dark(
    color-mix(in srgb, var(--code-background) 80%, var(--diff-addition)),
    color-mix(in srgb, var(--code-background) 80%, var(--diff-addition))
  );
  --diffs-bg-addition-number-override: light-dark(
    color-mix(in srgb, var(--code-background) 76%, var(--diff-addition)),
    color-mix(in srgb, var(--code-background) 74%, var(--diff-addition))
  );
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--code-background) 78%, var(--diff-addition));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--code-background) 66%, var(--diff-addition));
  --diffs-bg-deletion-override: light-dark(
    color-mix(in srgb, var(--code-background) 82%, var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) 82%, var(--diff-deletion))
  );
  --diffs-bg-deletion-number-override: light-dark(
    color-mix(in srgb, var(--code-background) 78%, var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) 76%, var(--diff-deletion))
  );
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--code-background) 80%, var(--diff-deletion));
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--code-background) 68%, var(--diff-deletion));
  background-color: var(--diffs-bg) !important;
  color: var(--code-foreground) !important;
}

diffs-container {
  --diffs-bg: var(--code-background) !important;
  background-color: var(--code-background) !important;
  color: var(--code-foreground) !important;
}

/* Hunk separators are the way to the unchanged lines between hunks: quiet controls, forward on hover. */
:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  height: 24px !important;
  margin-block: 0 !important;
  --diffs-bg-separator: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
}
:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-separator-content] {
  color: color-mix(in srgb, var(--code-foreground) 50%, var(--code-background)) !important;
  font-family: var(--font-sans) !important;
  font-size: 11px !important;
  text-decoration: none !important;
}
:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-expand-button] {
  color: color-mix(in srgb, var(--code-foreground) 50%, var(--code-background)) !important;
}
:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  :is([data-separator-content], [data-expand-button]):hover {
  color: var(--code-foreground) !important;
  background-color: color-mix(in srgb, var(--code-background) 92%, var(--code-foreground)) !important;
}

/* In split wrap mode keep both code columns the same width, so lines do not rewrap as more mount. */
[data-diff-type="split"][data-overflow="wrap"] {
  --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
}

/* A file eases in when it mounts; appearance only. */
[data-diff], [data-file] {
  transition: opacity 200ms ease-out;
}
@starting-style {
  [data-diff], [data-file] { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  [data-diff], [data-file] { transition: none; }
}
`
