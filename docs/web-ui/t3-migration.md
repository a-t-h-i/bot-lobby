# Restyling the web UI after T3 Code

This is the plan for giving bot-lobby's web UI the look and feel of
[T3 Code](https://github.com/pingdotgg/t3code) (MIT). We port the look, not the
app: their components are read, re-written into `webui/src/` as our own code and
wired to our data layer (the topic store, `useTopic`, `useApiRead`, `call`/`act`).
Nothing from their infrastructure comes over: no Effect atoms, Zustand, TanStack
Router, Clerk, Tiptap, Mermaid or terminal. The engine in `src/` is untouched.

Research was done against T3 Code `main` (shallow clone, October 2026); every
path below is relative to their repo.

## Their design system in short

- **Ground and surfaces.** A near-white page (`zinc-25`, `#fcfcfc`) with white
  cards and popovers in light; near-black (`neutral-950`, `#0a0a0a`) with cards
  3% lifted toward white in dark. The sidebar sits on `zinc-50` with a hairline
  border and no card around the main column: the page runs edge to edge.
  (`apps/web/src/index.css`, the `:root` block from line 1087, and
  `[data-app-sidebar]` after it.)
- **Ink.** `zinc-800` text with `zinc-500` secondary in light; `neutral-100`
  and a lifted `neutral-500` in dark.
- **One accent.** A saturated blue, `oklch(0.488 0.217 264)` in light and
  `oklch(0.571 0.21 264)` in dark, with white text on it in both.
- **Lines.** Borders are `zinc-200` in light and `white / 6%` in dark; inputs
  one step stronger (`zinc-300`, `white / 8%`). Hover and selected fills are
  `zinc-100` in light and `white / 4%` in dark.
- **Type.** The system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI",
  system-ui, sans-serif`) and `ui-monospace, "SF Mono", Menlo, Consolas`.
  Body copy at `text-sm` (14px), dense UI at `text-xs`, and two extra steps
  below that (`text-2xs` 11px, `text-3xs` 10px) for metadata and key hints.
- **Radii.** `--radius: 0.625rem`, with `--control-radius: 0.5rem` for
  buttons, inputs and rows; dialogs and sheets at `rounded-2xl`; the composer
  at `rounded-3xl` (22px).
- **Shadows.** Flat. Controls carry `shadow-xs/5` plus a 1px inner highlight
  (`0 1px rgb(255 255 255 / 16%)` on filled buttons, a `before:` line of
  `black / 4%` on outline ones). Popovers and toasts use a soft drop
  (`shadow-lg/5`, `shadow-xl shadow-black/25`). The composer has its own
  pulled-in drop, `0 12px 28px -18px rgb(0 0 0 / 40%)`, and none in dark.
- **Glass.** Dialogs, dropdowns and the composer are translucent over a
  `blur(12px) saturate(1.14)` backdrop (`16px`, `1.08` in dark), via the
  `surface-glass`, `dialog-glass` and `dropdown-glass` utilities.
- **Focus.** A 2px ring in the accent, drawn inside the control
  (`focus-visible:ring-2 ring-inset ring-ring`), and `outline-ring/50` on
  everything else.
- **Motion.** Short and quiet: 150–200 ms opacity and scale (`scale-98` in and
  out for pop-ups, `scale-[0.97]` while a button is pressed) and the
  decelerating `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`. Indicator loops
  are stepped so they redraw a few frames per cycle, and everything honours
  `prefers-reduced-motion`.

## (a) Token mapping

Our variable names stay; their values change. Every screen reads these, so the
whole page follows.

| Our token | T3 Code source | Light | Dark |
| --- | --- | --- | --- |
| `--background` | `--background` | `zinc-25` `#fcfcfc` | `neutral-950` `#0a0a0a` |
| `--foreground` | `--foreground` | `zinc-800` `#27272a` | `neutral-100` `#f5f5f5` |
| `--muted-foreground` | `--muted-foreground` | `zinc-500` `#71717a` | `neutral-500` + 10% white `#818181` |
| `--card`, `--card-foreground` | `--card` | `#ffffff` | bg 97% + white `#111111` |
| `--popover` | `--popover` (glass) | `white / 92%` | `#111111 / 92%` |
| `--primary` | `--primary` | `#1b4ed8` | `#346bf1` |
| `--primary-foreground` | `--primary-foreground` | `#ffffff` | `#ffffff` |
| `--accent` | `--accent` | `zinc-100` `#f4f4f5` | `white / 4%` |
| `--secondary`, `--muted` | `--secondary`, `--muted` | `zinc-50` `#fafafa` | `white / 3%` |
| `--border` | `--border` | `zinc-200` `#e4e4e7` | `white / 6%` (solid `#1b1b1b`) |
| `--input` | `--input` | `zinc-300` `#d4d4d8` | `white / 8%` (solid `#222222`) |
| `--ring` | `--ring` | `--primary` | `--primary` |
| `--destructive` | `--error-foreground` | `red-700` `#b91c1c` | `red-400` `#f87171` |
| `--success` | `--success-foreground` | `emerald-700` `#047857` | `emerald-400` `#34d399` |
| `--warning` | `--warning-foreground` | `amber-700` `#b45309` | `amber-400` `#fbbf24` |
| `--sidebar` | `--sidebar` | `zinc-50` `#fafafa` | `--card` `#111111` |
| `--sidebar-accent` | `--sidebar-row-hover`/`-active` | `zinc-100` | `white / 8%` |
| `--you`, `--bubble` | `--message-surface` (= `--accent`) | `zinc-100` | `white / 6%` |
| `--dock` | `--chat-composer-glass-surface` | `--card` | `--card` |
| `--dock-border` | `--chat-composer-outline` | `black / 8%` | `white / 5%` |
| `--dock-shadow` | `--shadow-composer` | `0 12px 28px -18px black/40%` | none |
| `--glass-border` | `dialog-glass` border | `foreground / 10%` | `white / 8%` |
| `--glass-shadow` | `dialog-glass` shadow | `0 24px 64px -24px black/65%` | `0 24px 72px -20px black/90%` |
| `--scrim` | `dialog-backdrop` | `background / 60%` | `background / 64%` |
| `--font-sans` | `--font-sans` | system stack | same |
| `--font-mono` | `--font-mono` | `ui-monospace, SF Mono, …` | same |
| `--radius` | `--radius` | `0.625rem` | same |
| `--radius-md`/`-lg` (controls) | `--control-radius` | `0.5rem` | same |
| `--radius-2xl` (dialogs, sheets) | `rounded-2xl` | `18px` | same |
| `--radius-3xl` (composer) | `rounded-3xl` | `22px` | same |
| `--ease-calm` | `--ease-drawer` | `cubic-bezier(.32,.72,0,1)` | same |

Tokens that only we have keep their role and are re-derived from the new
palette: `--heading`, `--link`, `--code`, `--chart-*`, `--source-*` (each
agent's colour), `--tab-*` (the tab strip), `--rainbow-*` (max effort) and
`--orb` (Thinking). The "raised 2.5D" set (`--btn-face*`, `--btn-raise*`,
`--btn-gloss`, `--card-face`, `--card-raise`) is removed: their look is flat.

Inter Variable goes: T3 Code uses the system stack, which needs no font file
and no CDN, so we match it and drop `@fontsource-variable/inter`.

## Their components, and what they expect

| Area | Their file | What it reads |
| --- | --- | --- |
| Sidebar shell | `components/ui/sidebar.tsx`, `components/AppSidebarLayout.tsx` | `useSidebar` context, a Zustand width store |
| Sidebar rows | `components/ui/sidebar.tsx` (`sidebarMenuButtonVariants`) | `isActive`, size |
| Top bar | `components/WorkspacePageHeader.tsx`, `components/RightPanelTabs.tsx` | route state from TanStack Router, panel store |
| Chat thread | `components/chat/MessagesTimeline.tsx` | projected timeline rows from Effect atoms, virtualised by `@legendapp/list` |
| User message | `MessagesTimeline.tsx` `UserTimelineRow` | message, attachments, context chips |
| Assistant message | `MessagesTimeline.tsx` `AssistantTimelineRow`, `ChatMarkdown.tsx` | streamed markdown, copy and fork actions |
| Work log | `components/chat/WorkLog.tsx` | icon, label, trailing, children (pure presentational) |
| Live status | `components/chat/ComposerActivityStatus.tsx`, `live-tool-shine` utility | provider state atom |
| Composer | `components/chat/ChatComposer.tsx`, `ComposerSurface.tsx` | Tiptap editor, draft store, provider and model atoms |
| Button | `components/ui/button.tsx` | Base UI `useRender` |
| Input, textarea | `components/ui/input.tsx`, `textarea.tsx` | Base UI `Input`, `Field` |
| Select, combobox | `components/ui/select.tsx`, `combobox.tsx` | Base UI `Select`, `Combobox` |
| Dialog | `components/ui/dialog.tsx`, `dialog-styles.ts` | Base UI `Dialog` |
| Popover, tooltip | `components/ui/popover.tsx`, `tooltip.tsx` | Base UI `Popover`, `Tooltip` |
| Toast | `components/ui/toast.tsx` | Base UI `Toast` manager |
| Sheet | `components/ui/sheet.tsx` | Base UI `Dialog` |
| Switch, checkbox | `components/ui/switch.tsx`, `checkbox.tsx` | Base UI `Switch`, `Checkbox` |
| Badge, kbd | `components/ui/badge.tsx`, `kbd.tsx` | none |
| Empty states | `components/ui/empty.tsx`, `NoActiveThreadState.tsx` | none |
| Diff, file tree | `components/DiffPanel.tsx`, `components/chat/ChangedFilesTree.tsx` | `@pierre/diffs`, `@pierre/trees`, a git diff from their server |

Their primitives are built on Base UI; ours on Radix. The look lives entirely in
class names, so we restyle our Radix primitives in place and keep their props.
No primitive gains enough from a Base UI swap to be worth the churn (Radix
already gives us the focus management, portals and dismiss behaviour the specs
check), so none is swapped.

## (b) Our screens and components

| Ours | T3 Code counterpart | Treatment |
| --- | --- | --- |
| `index.css` tokens, base, utilities | `index.css` | Port tokens and the glass utilities |
| `components/ui/button.tsx` | `ui/button.tsx` | Restyle (flat, inner highlight); drop the raised look |
| `components/ui/input.tsx`, `textarea.tsx` | `ui/input.tsx`, `ui/textarea.tsx` | Restyle |
| `components/ui/popup.tsx`, `alert-dialog.tsx` | `ui/dialog.tsx`, `dialog-styles.ts` | Restyle as `dialog-glass` |
| `components/ui/tooltip.tsx` | `ui/tooltip.tsx` | Restyle |
| `components/ui/badge.tsx`, `reui/badge.tsx` | `ui/badge.tsx` | Restyle |
| `components/ui/kbd.tsx` | `ui/kbd.tsx` | Restyle |
| `components/ui/switch.tsx`, `checkbox.tsx` | `ui/switch.tsx`, `ui/checkbox.tsx` | Restyle |
| `components/ui/combobox.tsx`, `reui/select.tsx`, `reui/popover.tsx` | `ui/combobox.tsx`, `ui/select.tsx`, `ui/popover.tsx` | Restyle as `dropdown-glass` |
| `components/ui/sheet.tsx` | `ui/sheet.tsx` | Restyle |
| `components/ui/toaster.tsx` | `ui/toast.tsx` | Restyle (glass, tinted icon) |
| `components/ui/empty.tsx` | `ui/empty.tsx` | Restyle |
| `components/ui/spinner.tsx` | `ui/spinner.tsx` | Tokens only |
| `components/reui/alert.tsx`, `frame.tsx` | `ui/alert.tsx`, `alert-glass` | Restyle |
| `app/Shell.tsx` | `AppSidebarLayout.tsx`, `ui/sidebar.tsx` `SidebarInset` | Port layout: flat page edge to edge, no inset card |
| `app/Sidebar.tsx` (rail of icons) | `ui/sidebar.tsx` | Restyle with their sidebar surface and row states; no sections added |
| `app/Header.tsx` | `WorkspacePageHeader.tsx` | Restyle; centred tabs, no task name, as now |
| `app/TabStrip.tsx` | `RightPanelTabs.tsx` | Restyle only: their small accent-filled tabs; the strip's flow and keys stay |
| `tabs/lobby/Conversation.tsx`, `ChatParts.tsx` | `MessagesTimeline.tsx` rows | Port the user and assistant row look |
| `tabs/lobby/InlineActivity.tsx` | `chat/WorkLog.tsx` | Port as work-log rows (adapted file) |
| `ui/WorkingMark.tsx`, live step | `live-tool-shine`, `ComposerActivityStatus.tsx` | Restyle the live line with their shine |
| `app/Composer.tsx` | `ComposerSurface.tsx`, `ChatComposer.tsx` | Port the surface (glass, 22px, outline, drop); keep our tray and keys |
| `tabs/tasks/*` (list, board, detail, steps tracker) | sidebar rows, `ThreadDetailsPanel.tsx` | Restyle only |
| `tabs/plan/*` (conversation, sheet, panel, mockups) | `MessagesTimeline.tsx`, `ProposedPlanCard.tsx`, `RightPanelSheet.tsx` | Restyle; the conversation shares the Lobby rows |
| `tabs/quickfix/*` | none | Restyle only |
| `tabs/knowledge/*` | `ChangedFilesTree.tsx` (tree rows) | Restyle only |
| `tabs/git/*` (PRs, reviews) | `PullRequestThreadDialog.tsx`, `ThreadDetailsPrRow.tsx` | Restyle only; no diff view (see risks) |
| `tabs/excalidraw/*` | none | Restyle only |
| `tabs/metrics/*` | `ContextWindowMeter.tsx`, `usage/` | Restyle only |
| `tabs/settings/*`, `ui/EffortSlider.tsx` | `settings/` panels | Restyle only; the slider keeps its behaviour with new tokens |
| `tabs/issues/*`, `tabs/sessions/*` | none | Restyle only |
| `prompts/QuestionPopup.tsx`, `QuestionCard.tsx`, `MockupViewer.tsx` | `ComposerPendingUserInputPanel.tsx`, `ui/dialog.tsx` | Restyle |
| `app/Thinking.tsx`, `tabs/lobby/Orb.tsx`, `Thoughts.tsx` | none | Restyle only |
| `app/AltH.tsx` (key help) | `CommandPalette.tsx` look, `ui/kbd.tsx` | Restyle |
| `app/ProjectFolderDialog.tsx` | `CommandPalette.tsx` list rows | Restyle only |
| `app/PhoneTabs.tsx`, `PhoneTabCards.tsx` (carousel, sheet) | `ui/sheet.tsx`, mobile composer | Restyle only |
| `app/States.tsx`, `SignIn.tsx` | `ui/empty.tsx`, `NoActiveThreadState.tsx` | Restyle |

## (c) Order of work

1. This document, committed on its own.
2. Foundation: tokens, fonts, the glass utilities and every `components/ui`
   primitive; drop the raised button and card look; update the specs that
   asserted it.
3. Shell and Lobby: the flat page and sidebar, the header, the conversation
   rows, work-log activity and the composer surface. Screenshot at 1440 and
   390 in both themes and compare before going on.
4. Every other screen in this order: Tasks, Plan, Quick fix, Knowledge, Git,
   Excalidraw, Metrics, Settings, the question pop-up, Thinking, the key help,
   the folder picker and the phone layout.
5. The full suite, a dead-code pass, `THIRD_PARTY_NOTICES.md`, the README, and
   the merge.

## (d) Risks

- **Specs that pin the old look.** Several browser checks assert the raised
  buttons, the 12px inset surface and the warm paper. They are updated to the
  new design; none of the behaviour, keyboard or accessibility checks change.
- **Contrast.** Their `zinc-500` secondary text and the dark blue accent sit
  close to 4.5:1. The contrast spec is the referee; shades move a step where it
  fails.
- **Borders at 3:1.** `plans-themes.spec.ts:77` already fails on `main`
  because the borders are soft by design. Their borders are softer still, so it
  will keep failing; it is listed as pre-existing.
- **Tab strip.** Its pour-and-knock animation is ours and covered by specs. It
  keeps its motion and takes the new tokens rather than being replaced.
- **Glass and blur cost.** Backdrop blur on the composer and pop-ups costs
  paint time on slow machines. It falls back to the solid surface when
  `backdrop-filter` is unsupported, as theirs does.
- **Diff view.** Our API carries no diffs (Git shows PRs, reviews and their
  text), so `@pierre/diffs` and `@pierre/trees` would have nothing to render
  without a new engine field. They are not added; Git is restyled only.
- **Licence.** Files whose structure follows theirs carry a one-line
  "Adapted from T3 Code (MIT)" comment and are listed in
  `THIRD_PARTY_NOTICES.md`. Their name, logo and wordmark never appear in the UI.
