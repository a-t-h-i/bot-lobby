# Third-party notices

## T3 Code

The web UI's look (colours, radii, shadows, control and dialog styles, the
sidebar rail, the chat rows, the work log, the composer (its surface, footer controls and send button), the select
fields and drop-down lists, the loading and status animations and the
built-in colour themes), and the third-party harness support (the model
manifest, CLI flags, prompt injection and ACP handling behind Settings >
Harnesses), is adapted from T3 Code,
https://github.com/pingdotgg/t3code. No T3 Code package is a
dependency; the styles and markup below were ported into this repository and
rewired to bot-lobby's own data layer. Each adapted file starts with a comment
naming the file it came from.

| Our file | Adapted from (T3 Code) |
| --- | --- |
| `webui/src/index.css` | `apps/web/src/index.css`, `components/ui/button.tsx`, `components/chat/MessagesTimeline.tsx`, `components/chat/WorkLog.tsx`, `components/chat/TimelineSystemDivider.tsx` |
| `webui/src/components/ui/button.tsx` | `apps/web/src/components/ui/button.tsx` |
| `webui/src/components/ui/input.tsx` | `apps/web/src/components/ui/input.tsx` |
| `webui/src/components/ui/textarea.tsx` | `apps/web/src/components/ui/textarea.tsx` |
| `webui/src/components/ui/tooltip.tsx` | `apps/web/src/components/ui/tooltip.tsx` |
| `webui/src/components/ui/kbd.tsx` | `apps/web/src/components/ui/kbd.tsx` |
| `webui/src/components/ui/checkbox.tsx` | `apps/web/src/components/ui/checkbox.tsx` |
| `webui/src/components/ui/switch.tsx` | `apps/web/src/components/ui/switch.tsx` |
| `webui/src/components/ui/popup.tsx` | `apps/web/src/components/ui/dialog.tsx`, `dialog-styles.ts` |
| `webui/src/components/ui/alert-dialog.tsx` | `apps/web/src/components/ui/alert-dialog.tsx` |
| `webui/src/components/ui/sheet.tsx` | `apps/web/src/components/ui/sheet.tsx` |
| `webui/src/components/ui/toaster.tsx` | `apps/web/src/components/ui/toast.tsx` |
| `webui/src/components/ui/combobox.tsx` | `apps/web/src/components/ui/combobox.tsx` |
| `webui/src/components/ui/empty.tsx` | `apps/web/src/components/ui/empty.tsx` |
| `webui/src/components/ui/skeleton.tsx` | `apps/web/src/components/ui/skeleton.tsx` |
| `webui/src/components/reui/frame.tsx` | `apps/web/src/components/settings/settingsLayout.tsx` (one flat card per section) |
| `webui/src/components/reui/badge.tsx` | `apps/web/src/components/ui/badge.tsx` |
| `webui/src/components/reui/select.tsx` | `apps/web/src/components/ui/select.tsx` |
| `webui/src/components/reui/popover.tsx` | `apps/web/src/components/ui/popover.tsx` |
| `webui/src/app/Sidebar.tsx` | `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/ui/sidebar.tsx` |
| `webui/src/app/Composer.tsx` | `apps/web/src/components/chat/ComposerSurface.tsx`, `ChatComposer.tsx`, `ComposerPrimaryActions.tsx`, `ComposerControl.tsx` |
| `webui/src/app/TerminalDrawer.tsx` | `apps/web/src/components/ThreadTerminalDrawer.tsx` (the drawer, its floating toolbar and terminal list) |
| `webui/src/tabs/lobby/InlineActivity.tsx` | `apps/web/src/components/chat/WorkLog.tsx` |
| `src/webui/palette-core.ts` (the built-in themes) | `packages/shared/src/themePalettes.ts` (Blossom is their T3 Chat theme, renamed) |
| `src/harness/model-manifest.json` (copied as is) | `apps/server/src/provider/model-manifest.json` |
| `src/harness/catalog.ts` | `apps/server/src/provider/ClaudeModelCatalog.ts` (effort descriptors and maps), `CodexProvider.ts` (effort levels), `antigravityAuthSupport.ts` (`buildAntigravityAcpSpawnInput`) |
| `src/harness/cli-args.ts` | `packages/shared/src/cliArgs.ts` (`tokenizeCliArgs`) |
| `src/harness/instructions.ts` | `packages/provider-core/src/server/runtimeInstructions.ts`, `orchestrationInstructions.ts` (`t3AcpPromptWithInstructions`) |
| `src/harness/codex.ts` | `apps/server/src/textGeneration/CodexTextGeneration.ts`, `apps/server/src/provider/codexLaunchArgs.ts` |
| `src/harness/claude.ts` | `apps/server/src/textGeneration/ClaudeTextGeneration.ts`, `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` (auto-compact window) |
| `src/harness/acp.ts` | `apps/server/src/provider/acp/AntigravityProtocol.ts` (permission answers), `packages/provider-acp/src/server/sessionConfig.ts` (session option categories) |
| `src/schemas/harness.ts`, `webui/src/tabs/settings/HarnessesGroup.tsx` | `packages/contracts/src/settings.ts` (provider settings fields), `apps/web/src/components/settings/ProviderInstanceCard.tsx` |

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Typefaces

The web UI bundles the Latin subset of these variable fonts (from the
fontsource packages, `@fontsource-variable/*`) as files in `webui/dist/assets`,
so the Typeface setting works offline. Each is under the SIL Open Font
License 1.1 (https://openfontlicense.org): Inter (The Inter Project Authors),
Geist and Geist Mono (Vercel), IBM Plex Sans (IBM Corp.), Manrope (The
Manrope Project Authors), JetBrains Mono (The JetBrains Mono Project
Authors), DM Sans (The DM Sans Project Authors), Plus Jakarta Sans (The Plus
Jakarta Sans Project Authors), Figtree (The Figtree Project Authors), Outfit
(The Outfit Project Authors), Nunito (The Nunito Project Authors), Space
Grotesk (The Space Grotesk Project Authors), Source Sans 3 and Source Code Pro
(Adobe), Fira Code (The Fira Code Project Authors) and Roboto Mono (The Roboto
Mono Project Authors).
