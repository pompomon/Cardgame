# Rich Phaser renderer verification

## Automated acceptance evidence

| Acceptance target | Evidence |
| --- | --- |
| Unchanged retained sync creates no cards | `src/test/phaser-card-view-registry.test.ts` synchronizes an unchanged view 100 times and asserts stable outer views and no extra face renders. |
| Pointer movement creates no display objects | `src/test/phaser-drag-controller.test.ts` and `src/test/phaser-drop-zone-view.test.ts` each exercise 1,000 pointer updates while asserting a single drag proxy or no new feedback objects. |
| Theme/profile changes do not accumulate large textures | `src/test/phaser-board-background.test.ts` switches theme/tier 25 times and asserts one resident image and 24 evictions. |
| Lifecycle cleanup is repeatable | `src/test/phaser-renderer-lifecycle.test.ts` covers 20 mount/unmount cycles; `src/test/phaser-cardgame-scene-lifecycle.test.ts` covers 20 restart cycles. Both assert retained owners and global listeners are released. |
| Base path and offline asset fallback remain safe | `src/test/phaser-board-assets-base-path.test.ts` runs a non-root Vite build. Manifest and loader fallback/error suppression coverage is in `src/test/phaser-asset-manifest.test.ts` and `src/test/phaser-texture-loader.test.ts`. |

The automated suite verifies object, listener, texture, and action-submission
boundaries. It does not produce browser frame-time traces, so runtime frame
budgets must be checked during the manual matrix below.

## Manual smoke matrix

Run the following on a production build before release. Record the browser,
device/emulation profile, and pass/fail result in the pull request.

| Environment | Settings and actions | Expected result |
| --- | --- | --- |
| Chromium desktop | Mouse input; high then balanced quality; play, invalid-drop, resize, renderer switch | One action per valid drag; invalid drag returns safely; no duplicate controls, overlays, or listeners after resize/switch. |
| Firefox or WebKit desktop | Mouse input; resize and renderer switching | Board, hand, header, menu, and accessibility controls remain usable through resize and switching. |
| 390×844 mobile emulation | Touch input; balanced then low quality; portrait → landscape → portrait | Touch threshold preserves taps; drag is responsive; controls stay within safe areas; layout restores without duplicates. |
| High-DPR mobile emulation | Low and balanced quality; reduced motion enabled | DPR policy is capped; ambience/effects are reduced or disabled as selected; no visual work continues while hidden. |
| Offline reload | Service worker enabled; reload with cached board and sprite assets | Gameplay starts with loaded assets or procedural fallback and does not retry a failed URL indefinitely. |
| Non-root deployment | Build with `VITE_BASE_PATH=/regression-base/` | Board backgrounds, sprites, and card art resolve below the configured base path. |

## Performance budgets

Measure 120 seconds of active hand dragging, battlefield updates, and resize
on each desktop and mobile profile. The desktop p95 frame time budget is
16.7 ms; the mobile budget is 33.3 ms. Treat any missed budget as a release
blocker unless its follow-up issue and approval are recorded in the pull
request.
