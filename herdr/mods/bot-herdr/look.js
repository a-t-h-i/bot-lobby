// Bot Lobby's composer look (webui/src/index.css, the `.bubble` tokens; docs/web-ui/composer-design),
// in GPUI terms. Colours are the web app's Claude palette, resolved to hex, light and dark.

export const LIGHT = {
  ground: "#faf9f5",
  fill: "#ffffff",
  edge: "#e3e0d7",
  edgeDark: "#d6d2c6", // the slightly darker bottom lip of the bevel
  rim: "#ffffff", // the lit top edge
  ink: "#141413",
  muted: "#73726c",
  faint: "#918f8a",
  hover: "#f4f3ef",
  well: "#ebe9e2",
  kbd: "#efeeea",
  accent: "#c96442",
  accentInk: "#ffffff",
  accentLip: "#a9512f",
  stop: "#9e3d3a",
  stopHover: "#a8302c",
  danger: "#b91c1c",
};

export const DARK = {
  ground: "#262624",
  fill: "#30302e",
  edge: "#4a4a47",
  edgeDark: "#1d1d1b",
  rim: "#3c3c3a",
  ink: "#faf9f5",
  muted: "#bbb9b2",
  faint: "#8c8a84",
  hover: "#3f3f3d",
  well: "#222220",
  kbd: "#3a3a38",
  accent: "#d97757",
  accentInk: "#ffffff",
  accentLip: "#b85a3c",
  stop: "#c45e5a",
  stopHover: "#cf4f4a",
  danger: "#f87171",
};

/** Sizes in px at zoom 1 (herdr scales them). After the user's radii: outer 12, controls 10, nested 8. */
export const SIZE = {
  maxWidth: 720, // the chat column (46rem at the web app's 90% scale), a little wider for terminals
  gutter: 24, // room either side of the composer in its block
  foot: 14, // from the composer's foot to the block's
  radius: 12,
  control: 10,
  nested: 8,
  textTop: 14,
  textX: 16,
  minRows: 2,
  maxRows: 12,
  tools: 46,
  iconButton: 32,
  chip: 28,
  row: 30,
  rowsShown: 8,
  menuPad: 4,
  fillet: 12,
};

export const MOTION = {
  menuHeight: { duration: 190, easing: "ease-out" },
  menuWidth: { duration: 170, easing: "ease-out" },
  menuClose: { duration: 110, easing: "ease-in" },
  rowStagger: 22,
  row: { duration: 240, easing: "ease-out" },
  tool: { duration: 160, easing: "ease-out" },
};

export const ICON = (name) => `mods/bot-herdr/icons/${name}.svg`;

/** A row's or chip's colour: lobby commands the accent, agents their program's tile. */
export function tint(c, row) {
  if (row?.color) return row.color;
  if (row?.tag === "start") return c.muted;
  return c.accent;
}

/** Rough text width at a size, for sizing the suggestion bubble the way the web app measured it. */
export function textWidth(s, size) {
  let w = 0;
  for (const ch of s) w += /[mwMW@]/.test(ch) ? 0.82 : /[il.,:;'|!]/.test(ch) ? 0.3 : /[A-Z]/.test(ch) ? 0.66 : 0.55;
  return w * size;
}
