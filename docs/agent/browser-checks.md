# Browser checks

On-demand browser sweeps for specific features; evidence rules live in
[Browser verification and evidence](testing.md#browser-verification-and-evidence)
and [Screenshots](pr-workflow.md#screenshots).

Run each check on the production preview at the configured base path.
Emulation is not device proof: record it as emulation, with the CSS and unit
coverage for what it cannot show (safe-area insets, real devices, Android
browser chrome and font scaling, TalkBack, real touch timing; desktop
emulation also misses a coarse pointer and reduced motion), pending maintainer
device verification. Never waive it.

## Creature catalog and terminology release matrix

For a release that changes creature copy or terminology:

1. Run the focused suites (`src/test/<name>.test.ts`):

   | Surface | Tests | Must hold |
   | --- | --- | --- |
   | Catalog identity | `card-catalog`, `game-types`, `cards` | Exact names, rules, slugs; frozen entries; `Forest, Island, Mountain, Plains, Swamp` order; Mimic excludes every Echo Doppelgänger |
   | Projection and browser copy | `game-presentation`, `view-model`, `action-resolution`, `three-interface`, `three-battlefield-controls`, `tutorial` | Catalog-backed tutorial and nested Mimic prompts; inline Hand, Board and Discard pile rules; full preview rules with Intercept; Banish names the owner's discard pile; hidden hands redacted |
   | Logs and CLI | `log-presentation`, `three-native-html`, `cli-session` | Structured and legacy logs share viewer-aware catalog copy; generic draws claim no Listen In source; CLI vocabulary aligned, adding no rule or Discard pile inspection |
   | Metadata and art | `browser-metadata`, `card-art`, `card-art-assets`, `card-art-base-path`, `card-art-generator`, `service-worker` | Approved title and description; exact ASCII slugs; non-root URLs; fallback order; network-first art |
   | Persistence and P2P | `game-recording`, `adventure-persistence`, `view-model`, `action-validation`, `p2p-compatibility` | Saves and v1/v2 recordings load unchanged; persisted Adventure labels are not rendered; packets carry no display copy |

2. Classify each `git grep` hit for a legacy term as player-facing (approved
   copy), compatibility or internal (stable) or historical (`docs/history/`).
   Legacy identifiers stay by design: never assert that legacy words don't
   occur, and forbid display-based mechanical identity, not display-keyed
   grouping or cache keys.
3. Show Gravebloom Dryad, Echo Doppelgänger and the long Intercept and Banish
   instructions at narrow portrait, short landscape and 200% text.

Pass: text wraps without clipping; controls stay at least 44 CSS pixels; stage
prompts never resize card rows or cancel a drag; compact labels keep **Action
phase**, **Interception window** or **Discard pile** in their accessible
names; **Summons attempted (both players)** shows `totalCardsPlayed`,
intercepted submissions included.

## Adventure hub check

Check every state at every viewport, at 100% and 200% root font size.

- **States:** paused-run lobby; map for a new run, at a fork and after a
  committed fork; pending reward; encounter result; retry after a loss; Retry
  Saving Result (refuse the storage write); completed run; failed run.
- **Viewports:** 390×844, 320×568 (the map shows its trail at both text
  sizes), 844×390, 720×360 and 1280×800.

Pass, in each state:

- No horizontal overflow; every control is at least 44 CSS pixels each way,
  in view or reachable by scrolling, and uncovered (`elementFromPoint` skips
  `pointer-events: none`, so check the board's focusable labels by focus
  outline).
- Tab follows the hub order, and focus lands as
  [Adventure hub](three-interface.md#adventure-hub) says, staying in view
  when Pause, Reset, Back to Lobby or a node start begins scrolled.
- The announcer matches the visible status, and nearby copy agrees (e.g. the
  relic list after a last charge). A dialog opening or closing empties it; a
  status arriving with that move shows `THREE_ANNOUNCER_SETTLE_MS` later.
- The hub requests no card art from `/cards/`.

Where the map shows:

- Graph: each line end is within 1 px of its token's center, and each line
  band meets its node slots.
- Trail: the rail runs through token centers into the last token with no gap
  or overlap of 1 px or more, each piece matching its `data-trail`,
  `data-trail-in` or `data-trail-out` state. Geometry misses a piece hidden
  under a button, so a screenshot must show the rail inside each playable
  node's button up to its token, 200% text included.
- No mid-word breaks (compare each word's `Range.getClientRects()`).
- Forced colors (`page.emulateMedia({ forcedColors: 'active' })`): lines,
  stems and rail pieces use system colors, keeping widths and dashes. Failing
  that, switch the `@media (forced-colors: active)` rules to `all`, compare
  computed styles, restore them, and record a simulation; a real contrast
  theme stays pending.

## Fold4 posture check

Run for changes to the touch shells, the dock, or drag and peek behaviour,
before the Fold4 device checklist in the
[maintainer gates](https://github.com/pompomon/Cardgame/issues/163) issue.
Use Chromium touch emulation (`hasTouch`, so `(pointer: coarse)` matches).
Check each posture at 100% and 200% root font size, and each shell once with
emulated reduced motion.

| Posture | Viewport | `data-shell` |
| --- | --- | --- |
| Cover, portrait | 344×770 | `narrow` |
| Main, portrait | 690×717 | `dock` |
| Main, landscape | 829×578 | `rail` |
| Cover, landscape | 882×232 | `rail`, short |
| Phone, sideways | 844×390 | `rail`, short |

The viewports are estimates: when the gates issue's device measurements
arrive, update this table and `FOLD4_POSTURES`
(`src/test/helpers/fold4-postures.ts`) together.

Pass, in each posture:

- The root's `data-shell` and `data-shell-short` match the table.
- No horizontal overflow; headers, End Turn and the hand never overlap;
  every control is at least 44 CSS pixels each way.
- The idle dock prompt is whole, except in the short rail at 200% text,
  where it scrolls in its two-line box and the dock scrolls to End Turn.
  Longer prompts may scroll.
- Tap-select then Summon, a drag that summons, and a drag back to the hand
  that cancels all work; each release does what the highlight showed.
- Where the board scrolls, edge auto-scroll reaches the drop zone and the
  pill stays at the visible top.
- A peek opens on the side away from the finger; where neither side fits
  (a hand card on the 232 px cover screen held sideways), a held press
  stays a tap.
- Reduced motion skips the card's return animation; `data-dragging` clears
  as the return starts, so count animation frames after the release.

Then resize 344×770 to 690×717 and 690×717 to 829×578, with a card selected
and again mid-drag: the selection, dock prompt and hand page survive, and the
drag cancels without a summon.
