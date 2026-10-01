# Risks

**Fields:**
- **L** and **I:** likelihood and impact, each low, medium or high.
- **Mitigation:** what reduces the risk.
- **Owner:** the task that owns it.

Review this list at the end of each phase.

| Id | Risk | L | I | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| **R-01** | **The server disturbs Pi's terminal.** A stray write to stdout or stderr garbles the screen, or work on Pi's event loop makes the TUI lag | medium | high | No output from the server (spy test, ARCHITECTURE §9.5). Coalesced pushes; polling only while a page is connected. P0-02 measures responsiveness while streaming | P0-02, P2-01 |
| **R-02** | **Another website or device reaches the server** (CSRF, DNS rebinding, a guessed link) | low | high | D-12's fences, each with a test. A 256-bit secret. Loopback only. No CORS. JSON only. Host and Origin checks. Strict CSP | P2-02, P2-X |
| **R-03** | **Android pauses or kills Termux while Chrome is in front**, so the page loses Pi and anything long-running stalls (Android 12+ also limits background child processes) | high | high | P0-03 measures it and finds the settings: wake lock, battery optimisation off, split screen. The page says "Pi is not reachable" and reconnects by itself. The README documents the setup (P5-06). Background sessions are child processes, so P0-03 checks them too | P0-03, P5-06 |
| **R-04** | **Agent text runs as code in the page** (Markdown with HTML, links, images) | medium | high | D-10: marked + DOMPurify, one component sets HTML (a source-scan test), and a CSP that blocks remote images and scripts. UI checks feed hostile Markdown | P3-04 |
| **R-05** | **Questions answered twice, or lost**, when the terminal and the page both show one | medium | medium | The prompt hub: first answer wins, the other copy is withdrawn (D-13). P0-04 proves withdrawal. `editor` has no signal, so its handling is decided in P0-04. Tests with two fake surfaces | P0-04, P1-04 |
| **R-06** | **The refactor in Phase 1 changes the terminal's behaviour** | medium | high | Move, don't rewrite. Existing tests keep their assertions. Manual pass at P1-X | P1-01…P1-05, P1-X |
| **R-07** | **The two UIs drift apart** (different words, rules, sorting) | medium | medium | D-06: both use the same view models and notices. FEATURE-INVENTORY → `parity.md` per PR. P4-X walkthrough | P1-03, P4-X |
| **R-08** | **The page is slow on phones** with long feeds or long Markdown | medium | medium | Bounded feeds (400, 40, 100). The streaming reply re-renders alone. Memoised messages. Lazy highlighting and Mermaid. The P5-05 stress test on the P0-03 device | P3-04, P5-05 |
| **R-09** | **A stale `webui/dist/` is shipped** (source changed, bundle not rebuilt), because Pi installs without building | medium | medium | The `dist/` hash test fails `npm run check` (D-08). The commit rule: rebuild in the same commit | P0-01 |
| **R-10** | **Pi's extension API changes** (dialogs, `ui_prompt_*`, modes, packages) | medium | medium | PI-NOTES lists every dependency with its source line. AGENT-GUIDE §7 is the upgrade checklist. Calls into Pi stay in the service and the prompt hub | AGENT-GUIDE §7 |
| **R-11** | **Session switches break open pages** (a stale service, double subscriptions, a leaked timer) | medium | medium | `rebind(service)` detaches and reattaches. A test with a stream open across a switch (ARCHITECTURE §9.7) | P2-01 |
| **R-12** | **Port clashes and several windows** confuse users ("which link is which window?") | medium | low | The port fallback range; the window's name and session in the page header; other windows' links from presence (P4-09) | P2-01, P4-09 |
| **R-13** | **The service worker serves an old page after an update**, or caches an API answer | low | medium | The cache is versioned by build hash; the shell only; a test that API answers are never cached | P5-03 |
| **R-14** | **Scope creep:** the web grows features the terminal lacks, and parity slips | medium | low | D-14 limits "better on purpose" to W-150…W-154. Anything else goes to the user first | coordinator |
