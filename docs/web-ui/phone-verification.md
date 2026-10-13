# Phone verification handoff

## Prior phone-redesign evidence (not Simplify Features verification)

These results predate Simplify Features. Rerun retained workflows and the updated checklist
on desktop Chromium and phone Chromium/WebKit at 320, 390 and 767px, light/dark; tag relevant
desktop dark checks `@theme`. Verify Git switching, removed-route fallbacks, hidden-control
isolation, reclaimed space, draft/upload preservation, reduced motion and console/CSP errors.
No new runtime result is claimed here.

- **PASS — focused Chromium light 390:** `/tmp/task-phone-focus.log` records **22/22 passed (2.3m, 2 workers)** on a fresh build: 16 carousel tests and 6 workflow tests. This supersedes the obsolete partial-failure report. No audio assertions were run.
- **FINAL PASS — master `npm run typecheck` and `npm run web:build`:** master reports both passed again after the final Tasks `min-h-11` desktop-guard fix. This source-only handoff did not execute those checks.
- **FINAL PASS — workflow smoke after the desktop-guard fix:** `/tmp/task-phone-final-smoke.log` records `phone-screens.spec.ts`, Chromium light 390, **6/6 passed (1.4m, 1 worker)**. The earlier combined 22/22 pass remains valid evidence before the tiny final fix; all 22 tests were not rerun after it.
- **PENDING — full Chromium matrix:** the earlier 132-test matrix command timed out at 420 seconds after 52 test starts with 4 workers. Earlier failures involved stale 44px sizing, landscape and fixture timing; fixes were followed by the focused 390 pass, not a full-matrix pass. Full 320/767 and dark-theme coverage remains pending. No zero-failure matrix result is claimed.
- **BLOCKED — WebKit launch:** cached Ubuntu-ABI WebKit 2336 cannot launch on Fedora 44; it needs ICU 74, jpeg8 and other runtime dependencies. The 16 earlier tests failed at launch, not at UI assertions. A supported system is required. No dependencies or host changes have been installed.
- **COMPLETED — before-layout capture only:** the master captured **110 baseline PNGs** at 768, 800, 1024, 1280 and 1440px, light/dark, across 11 screens. Full after-capture and comparison remain **PENDING**; baseline capture alone does not prove larger-screen preservation.
- **EARLIER, NOT FINAL:** 42 Lobby/tab regression passes and 31 supporting-test passes are earlier evidence, not final-source verification.
- Actual Android/iPhone and **all sound checks** remain user-owned **non-gates**. Neither was performed in this handoff.

## Verification matrix

| Engine / owner | Widths and themes | States / evidence | Status |
| --- | --- | --- | --- |
| Chromium automation | Focused light 390 (including explicit 767/768 and short-landscape cases) | `phone-carousel.spec.ts`: 120ms settling + 500ms commitment, neutral candidate through 499ms, restart/cancellation, immediate tap/keyboard selection, drag, repeated wraps both directions, semantic tablist/original digits, 767/768 draft and attachment preservation, keyboard handle, 0/1/2 tabs, Metrics route/shortcut | **PASS: 16 tests** in the fresh-build focused run; predates final Tasks sizing removal |
| Chromium automation | Focused light 390 (including short landscape) | `phone-screens.spec.ts`: all available non-Metrics tabs plus Settings (Sessions coverage belonged to the prior UI); bounded rows and essential targets; Tasks sheet/Back and Knowledge inline draft; landscape orb/dock; attachment thumbnail/navigation/Send/Stop using the real held fixture; questions/custom/multi-select; mockup expansion/Escape | **FINAL PASS: 6/6 tests (1.4m, 1 worker)** after the final desktop-guard fix; `/tmp/task-phone-final-smoke.log` |
| Chromium automation | 320, 390, 767; light + dark | Both phone files across the full configured width/theme matrix | **PENDING**: earlier 132-test attempt timed out; focused 22/22 is not a full-matrix result |
| WebKit automation | 320, 390, 767; light + dark | Same carousel and workflow contracts, including short landscape | **BLOCKED at launch**: supported runtime required; no UI assertion result |
| Larger-screen regression | 768, 800, 1024, 1280, 1440; light + dark | 110 baseline PNGs; full after-shots and comparisons; non-audio interaction regressions; preserve 768–1023 detail sheets and 1024 two-pane boundary | Baselines **COMPLETED**; full after-capture/comparison **PENDING**; 42 Lobby/tab + 31 support passes are **EARLIER, NOT FINAL** |
| User: Android Chrome / iPhone Safari | Actual devices; both themes; portrait/short landscape | `docs/web-ui/phone-device-checklist.md`: keyboard/hardware keys, safe areas, dock/orb, seams, sheets/Back, questions/mockups, attachments/drafts/Send/Stop | Not performed; **non-gating** |
| User: all sound checks | Actual devices/browsers | Unlock/mute/shared preference/prompt tones/navigation ticks/refusal and quiet programmatic motion | Not performed; **non-gating**; no audio automation |

## Remaining requirements

These remain requirements, not automatically waived by the user's request to finish up. Source implementation completion and this handoff are not full acceptance or a delivery verdict.

- Full width/theme Chromium verification and supported-system WebKit verification. The focused run does not establish full 320/767 or dark-theme coverage.
- Full ≥768px after-capture/comparison in both themes at all five baseline widths, plus final non-audio interaction checks.
- Remaining inventory screen states: sign-in, project switching, detail/action states beyond the tested Tasks sheet and Knowledge inline workflow, Settings section contents, and transient/loading/error/reconnecting states.
- Remaining specific coverage: attachment removal/upload-error and other preview surfaces; outage/recovery; confirmations beyond Stop; Thinking popup; long-question scrolling with keyboard open; landscape target-menu/header-overflow actions; reduced motion; tab removal/unmount cancellation; end-row clearance on pages without `data-row`.
- Multi-select is verified with a protocol-valid prompt supplied through existing API interception, not seeded `questions3`/`mockups` multi-select coverage. Attachment coverage verifies the real composer thumbnail and Send/Stop workflow, not an invented expanded attachment dialog.
- The engine's final QA/complete gate remains pending and decides delivery. Final master compile/build and workflow-smoke checks passed; earlier carousel and regression passes must not be relabelled as final-source evidence.

## Manual non-gates

The updated checklist is `docs/web-ui/phone-device-checklist.md`. Actual Android Chrome/iPhone Safari testing and **all sound testing** belong to the user and do not block implementation completion. Browser automation does not establish real keyboard, safe-area or audio behaviour. These non-gates do not waive the pending automated matrix, larger-screen comparisons or final QA gate.

## Run handoff

This update is source-only: no processes, runtime commands, tests, production/config changes, audio tests, dependencies, host changes or commits were made. Master's final compile/build and workflow smoke are recorded above. Remaining verification requires the full phone matrix on supported Chromium/WebKit systems and larger-screen after-captures saved separately from baselines for comparison. Existing desktop tests include audio cases: select non-audio checks only. Record actual results as PASS/PENDING/BLOCKED without inventing coverage. The engine's final QA/complete decision, not this document, determines delivery.
