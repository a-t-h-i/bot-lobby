# Composer redesign — design handoff

Design reference for redesigning the web UI composer (`webui/src/app/Composer.tsx`,
`webui/src/app/composer/ComposerSurface.tsx`, composer rules in `webui/src/index.css`).
Nothing here is wired into the app; it is the spec and a working prototype.

- `composer-light.dc.html` / `composer-dark.dc.html` are the Claude Design sources
  (interactive prototypes: HTML + CSS + a small state class). Read them for exact values.
  They need the Claude Design runtime (`support.js`) to render, so open them from the
  Claude Design artifact rather than straight from disk.
- Both themes are identical except for the theme tokens below.

## The idea

The composer is one fluid "bubble". The `/` command list, `@` agent list, attach menu,
running-projects list and the folder browser are not popovers or modals. Each is a smaller
bubble that grows out of the top of the composer and merges with it into one continuous shape.
The joins are smooth (no sharp corners) and the shape resizes smoothly to fit its content.
The whole thing looks slightly raised: a keycap or water droplet on a hydrophobic surface.

## How the merged shape is built

Two ghost layers behind the real content hold copies of the menu and composer shapes:

1. `.layer.edge`: shapes grown by 1px, filtered through `#gooedge`, plus two soft drop shadows.
2. `.layer.fill`: the same shapes at normal size, filtered through `#goolit`, on top of the edge layer.
3. `.real` (z-index 1): the actual textarea, buttons and menu content.

Ghost and real menus share the CSS vars `--w` and `--h` (and the composer shares `--ch`, `--cw`,
`--cr`), so they animate in sync. Width and height are set explicitly, not by `auto`, so they can
transition. Menu width is measured from content (canvas `measureText`) and clamped 200–640px;
fixed sizes for panes: attach 300×125, projects 400×142, folder browser 540×324,
suggestions = 12 + rows × 36 tall.

SVG filters (defined once, inline):

- `#goo`: `feGaussianBlur stdDeviation=9` then `feColorMatrix` alpha `20 -10` (metaball threshold).
- `#goolit` (fill layer): goo plus a 1px top highlight and a 1px bottom shade, both offset
  diagonally (light from the top-left), blurred 0.4px, clipped to the shape.
- `#gooedge` (edge layer): goo plus a lit top-left rim and a dark bottom-right rim (offset 2/3px,
  blurred 0.8px, clipped). Because the edge layer is 1px bigger, only a 1px outline shows, and it
  shifts from light to dark around the curves.

If this is built as React, keep the same layering and share the size variables between the
ghost and real elements. Do not try to do the merge with `border-radius` and pseudo-element
fillets; that gives sharp joins.

## Tokens

| | Light | Dark |
|---|---|---|
| ground | `#FCFCFC` | `#0A0A0A` |
| fill (bubble) | `#FFFFFF` | `#1C1C1F` |
| edge (outline base) | `#D2D2DA` | `#44444B` |
| ink | `#27272A` | `#F5F5F5` |
| muted | `#6B6B75` | `#A6A6AE` |
| faint | `#A1A1AA` | `#76767E` |
| hover | `#F4F4F5` | `rgba(255,255,255,.08)` |
| well (pressed bg) | `#E4E4EA` | `rgba(0,0,0,.3)` |
| outline light / dark rim | `rgba(255,255,255,.4)` / `rgba(40,40,70,.5)` | `rgba(255,255,255,.3)` / `rgba(0,0,0,.85)` |
| accent | `#1B4ED8` | `#346BF1` |

Cast shadow is deliberately faint and wide: `0 3px 10px` and `0 14px 36px` at 3.5–4.5% black
(light) or 30% black (dark). No tight contact shadow.

## Geometry

- Composer: 106px tall (60px textarea + 46px tools row), radius 20px, full width of its column.
- Collapsed: 44px tall, 416px wide (about 26rem), radius 14px (reads as a squircle), tools hidden.
- Menu rows are 36px high with a 16px radius so they sit concentric inside the container; padding 6px.
- Embedded buttons: 28px high, radius 8px, 12px text. Attach and send buttons are 32px circles.
- Folder browser: path bar (40px, recessed well), folder list 216px with a bottom fade mask,
  footer with count, Cancel (ghost) and "Open this folder" (keycap).

## Motion

- Menu open: height 190ms, width 170ms, scale .85 to 1 from the bottom center (210ms). Menu close 110ms.
- Rows scale up from the bottom (`scale .5 to 1`, 240ms `cubic-bezier(.22,1,.36,1)`), staggered 22ms
  from the bottom row up. No spring or overshoot anywhere.
- Folder navigation slides the list 14px in from the side it was navigated to (170ms).
- Composer expand: height 360ms (20ms delay), width 340ms, radius 360ms, all `cubic-bezier(.22,1,.36,1)`.
  Collapse: 300ms/280ms ease-in-out. No overshoot.
- On expand, tools pop in one after another (attach, project chip, hints, send): scale .4 to 1 and
  rise 6px, 250ms, starting at 110ms and staggered 45ms.
- `prefers-reduced-motion`: all of the above is disabled.

## Behaviour

- **Shrink on scroll, expand on focus.** Same rules as the existing `useShrinkOnScroll` in
  `Composer.tsx` and `#app-dock[data-shrunk]` in `index.css`: scroll intent from outside the dock
  (wheel, touch, scroll keys) followed by a scroll shrinks it; it never shrinks while focus is
  inside the dock or a menu is open; focus or a press on the pill expands it. The prototype only
  models "scroll with nothing focused".
- `/` and `@` open the suggestion bubble; arrow keys move, Enter or Tab inserts, Esc dismisses.
  Inserting still writes `/plan ` or `@dev ` into the textarea.
- Paperclip toggles the attach bubble; the project chip toggles running projects; "Open folder…"
  morphs it into the folder browser (the old modal is gone). Esc closes any panel.

## Details worth keeping

- Suggestion rows show the name without the `/` or `@` symbol, with a first-letter tile instead.
- No recipient chip ("To the oracle") in the composer, and no recipient name in the placeholder.
  Placeholder: "Write a message, run a command, or ask an agent" (collapsed: "Write a message…").
- Embedded buttons look pressed in on hover and while their menu is open (inset shadow, darker
  well, light bottom lip), deeper on press.
- Send is a round keycap with a paper-plane icon: lit top edge, darker underside. Hover nudges the
  plane up-right; press sinks the key about 1.5px and scales it to .97 (50ms down, 150ms back).
  Disabled is a flat circle.
- Tooltips on attach, project and send: tiny muted label above the button, shown only after a
  500ms hover, hidden while pressing or while that button's menu is open.
- Border: outline is about 1px, deliberately thin.

## Suggested mapping

- `ComposerSurface.tsx`: becomes the layered bubble (edge layer, fill layer, real content).
- `Composer.tsx`: keep the existing logic (`useShrinkOnScroll`, suggestions, attachments, project
  switching). Replace the popover/modal presentation of suggestions, attach and project switching
  with the bubble panes, and drive their sizes through CSS vars.
- `ProjectFolderDialog.tsx` and `ProjectSwitcher.tsx`: their content moves into the projects and
  folder-browser panes; the modal shell goes away.
- `index.css`: tokens above map onto the existing `docs/web-ui/t3-migration.md` palette
  (bg, ink, muted, primary, borders); add the few new ones (fill, well, rim colours).
